#!/usr/bin/env node
// Stage 3 — RENDER. Script to finished vertical video.
//
// A null return from the renderer means "not ready", not "broken": with the manual
// renderer that is the normal state while you are still editing. Only a thrown error
// sends an item to triage.

import { activeRenderer } from '../renderers/index.js';
import { listItems, advance, fail } from '../lib/store.js';
import { isDryRun, optional } from '../lib/env.js';
import { logger, summary } from '../lib/log.js';

const log = logger('3-render');

async function main() {
  const renderer = activeRenderer();
  const batchSize = Number(optional('RENDER_BATCH_SIZE', '3'));
  const items = (await listItems('render')).slice(0, batchSize);

  if (items.length === 0) {
    log.info('nothing to render');
    await summary('### Render\nNothing waiting.\n');
    return;
  }

  let rendered = 0;
  let waiting = 0;
  let failed = 0;

  for (const item of items) {
    try {
      if (isDryRun()) {
        log.info('DRY_RUN — would render', { id: item.id, renderer: renderer.name });
        continue;
      }

      const media = await renderer.render(item);
      if (!media) {
        waiting += 1;
        log.info('waiting on media', { id: item.id, hint: renderer.waitingHint(item) });
        continue;
      }

      item.media = { ...media, renderedAt: new Date().toISOString() };
      await advance(item, 'ready', `rendered by ${renderer.name}`);
      rendered += 1;
      log.info('rendered', { id: item.id, videoPath: media.videoPath });
    } catch (error) {
      log.error('render failed', { id: item.id, error: error.message });
      await fail(item, 'render error', error);
      failed += 1;
    }
  }

  await summary(
    `### Render (${renderer.name})\n- Rendered: ${rendered}\n- Waiting on media: ${waiting}\n- Failed: ${failed}\n`,
  );
}

main().catch((error) => {
  log.error('stage failed', { error: error.message });
  console.error(error);
  process.exit(1);
});
