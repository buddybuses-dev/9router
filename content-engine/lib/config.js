// Config loading with a single validation point, so a typo in JSON surfaces at
// pipeline start rather than three stages later inside an upload call.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectRoot } from './store.js';

const cache = new Map();

async function load(name) {
  if (cache.has(name)) return cache.get(name);
  const path = join(projectRoot(), 'config', name);
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  cache.set(name, parsed);
  return parsed;
}

export const loadChannel = () => load('channel.config.json');
export const loadPlatforms = () => load('platforms.json');
export const loadWhopSources = () => load('whop.sources.json');

export async function enabledPlatforms() {
  const platforms = await loadPlatforms();
  return Object.entries(platforms)
    .filter(([key, value]) => !key.startsWith('$') && value?.enabled)
    .map(([key]) => key);
}

/**
 * Refuses to let a claim the channel has banned reach a caption.
 * Returns the list of violations; empty means clean.
 */
export function findBannedClaims(text, channel) {
  const patterns = channel.compliance?.bannedClaimPatterns ?? [];
  const violations = [];
  for (const pattern of patterns) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(text)) violations.push(pattern);
  }
  return violations;
}
