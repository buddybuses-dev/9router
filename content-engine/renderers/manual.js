// Manual renderer — the default, and the one that matches how the videos actually
// get made today: you cut them in Crayo / Descript / OpenCut on station D and drop
// the export into media/inbox/.
//
// The pipeline's job here is not to render but to wait patiently and correctly: it
// claims a file named after the item, verifies it, and moves on. Items with no file
// yet stay in 03-render untouched, so this is safe to run on a schedule forever.

import { access, stat, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { constants } from 'node:fs';
import { projectRoot } from '../lib/store.js';
import { logger } from '../lib/log.js';

const log = logger('render:manual');
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v'];

export const name = 'manual';

export async function render(item) {
  const inbox = join(projectRoot(), 'media', 'inbox');
  const outDir = join(projectRoot(), 'media', 'out');

  for (const ext of VIDEO_EXTENSIONS) {
    const candidate = join(inbox, `${item.id}${ext}`);
    try {
      await access(candidate, constants.R_OK);
    } catch {
      continue;
    }

    const info = await stat(candidate);
    if (info.size < 100_000) {
      throw new Error(`${candidate} is only ${info.size} bytes — looks like a truncated export`);
    }

    await mkdir(outDir, { recursive: true });
    const destination = join(outDir, `${item.id}${ext}`);
    await rename(candidate, destination);
    log.info('claimed manual export', { id: item.id, destination, bytes: info.size });

    return { videoPath: destination, renderer: name, bytes: info.size };
  }

  // Not an error — the editor simply has not exported it yet.
  return null;
}

export function waitingHint(item) {
  return `Drop the export as media/inbox/${item.id}.mp4`;
}
