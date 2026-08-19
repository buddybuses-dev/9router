// The queue is the database. Every content item is one JSON file under queue/<stage>/,
// and moving between stages is a file move that git records. That gives the pipeline a
// full audit trail for free, survives runner restarts, and needs no external service —
// which is what makes a 24/7 GitHub Actions pipeline cheap to operate.

import { readdir, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export const STAGES = {
  brief: '01-brief',
  script: '02-script',
  render: '03-render',
  ready: '04-ready',
  published: '05-published',
  failed: '99-failed',
};

export const STAGE_ORDER = ['brief', 'script', 'render', 'ready', 'published'];

const ROOT = resolve(process.env.CONTENT_ENGINE_ROOT || process.cwd());
const QUEUE = join(ROOT, 'queue');

function stageDir(stage) {
  const dir = STAGES[stage];
  if (!dir) throw new Error(`Unknown stage "${stage}". Valid: ${Object.keys(STAGES).join(', ')}`);
  return join(QUEUE, dir);
}

// NFKD splits accented letters into a base letter plus a combining mark, so stripping
// every mark leaves plain ASCII behind. The two Norwegian vowels that NFKD does not
// decompose at all get folded by hand.
export function slugify(text, maxLength = 48) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '') || 'item';
}

export function newItemId(title) {
  const date = new Date().toISOString().slice(0, 10);
  return `${date}-${slugify(title, 32)}-${randomBytes(3).toString('hex')}`;
}

export function createItem({ title, source, brief }) {
  const now = new Date().toISOString();
  return {
    id: newItemId(title),
    title,
    createdAt: now,
    updatedAt: now,
    stage: 'brief',
    attempts: {},
    source: source ?? {},
    brief: brief ?? {},
    script: null,
    captions: {},
    media: null,
    publish: {},
    stats: {},
    history: [{ at: now, event: 'created', detail: source?.type ?? 'manual' }],
  };
}

export async function listItems(stage) {
  const dir = stageDir(stage);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const items = [];
  for (const file of files) {
    const raw = await readFile(join(dir, file), 'utf8');
    try {
      items.push(JSON.parse(raw));
    } catch (error) {
      throw new Error(`Corrupt queue item ${stage}/${file}: ${error.message}`);
    }
  }
  return items;
}

export async function countItems(stage) {
  const dir = stageDir(stage);
  if (!existsSync(dir)) return 0;
  return (await readdir(dir)).filter((f) => f.endsWith('.json')).length;
}

export async function saveItem(item) {
  const dir = stageDir(item.stage);
  await mkdir(dir, { recursive: true });
  item.updatedAt = new Date().toISOString();
  await writeFile(join(dir, `${item.id}.json`), `${JSON.stringify(item, null, 2)}\n`, 'utf8');
  return item;
}

export async function advance(item, toStage, detail = '') {
  const fromStage = item.stage;
  if (fromStage === toStage) return saveItem(item);

  const fromPath = join(stageDir(fromStage), `${item.id}.json`);
  item.stage = toStage;
  item.history.push({ at: new Date().toISOString(), event: `${fromStage} -> ${toStage}`, detail });
  await saveItem(item);
  if (existsSync(fromPath)) {
    const { unlink } = await import('node:fs/promises');
    await unlink(fromPath);
  }
  return item;
}

// A failure is never silent and never destructive: the item keeps everything it has
// earned so far and lands in 99-failed with the reason attached, ready for triage.
export async function fail(item, reason, error) {
  item.error = {
    at: new Date().toISOString(),
    stage: item.stage,
    reason,
    message: error?.message ?? String(error ?? ''),
  };
  item.attempts[item.stage] = (item.attempts[item.stage] ?? 0) + 1;
  return advance(item, 'failed', reason);
}

// Retry pulls an item out of 99-failed and puts it back where it stopped.
export async function retry(item) {
  const target = item.error?.stage && STAGES[item.error.stage] ? item.error.stage : 'brief';
  delete item.error;
  return advance(item, target, 'manual retry');
}

export async function moveFile(item, toStage) {
  const from = join(stageDir(item.stage), `${item.id}.json`);
  const to = join(stageDir(toStage), `${item.id}.json`);
  await mkdir(stageDir(toStage), { recursive: true });
  await rename(from, to);
}

export function queueRoot() {
  return QUEUE;
}

export function projectRoot() {
  return ROOT;
}
