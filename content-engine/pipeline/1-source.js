#!/usr/bin/env node
// Stage 1 — SOURCE. Turn vetted Whop products into content briefs.
//
// Idempotent by design: a product already somewhere in the queue is never briefed
// twice, so this can run every few hours without the queue filling with duplicates.

import { collect } from '../sources/whop.js';
import { loadChannel, loadWhopSources } from '../lib/config.js';
import { createItem, saveItem, listItems, countItems, STAGE_ORDER } from '../lib/store.js';
import { logger, summary } from '../lib/log.js';

const log = logger('1-source');

async function existingProductIds() {
  const ids = new Set();
  for (const stage of [...STAGE_ORDER, 'failed']) {
    for (const item of await listItems(stage)) {
      if (item.source?.productId) ids.add(item.source.productId);
    }
  }
  return ids;
}

async function main() {
  const [channel, sources] = await Promise.all([loadChannel(), loadWhopSources()]);
  const maxNew = sources.discovery?.maxNewItemsPerRun ?? 5;
  const maxDepth = channel.cadence?.maxQueueDepth ?? 40;

  const pending = (await countItems('brief')) + (await countItems('script')) + (await countItems('render'));
  if (pending >= maxDepth) {
    log.info('queue at capacity, sourcing nothing', { pending, maxDepth });
    await summary(`### Source\nQueue at capacity (${pending}/${maxDepth}) — no new briefs.\n`);
    return;
  }

  const products = await collect(sources);
  if (products.length === 0) {
    log.warn('no products returned — add entries to config/whop.sources.json manualProducts');
    await summary('### Source\n:warning: No products available. Populate `config/whop.sources.json`.\n');
    return;
  }

  const seen = await existingProductIds();
  const fresh = products.filter((p) => !seen.has(p.productId)).slice(0, Math.min(maxNew, maxDepth - pending));

  for (const product of fresh) {
    const item = createItem({
      title: product.name,
      source: product,
      brief: {
        angleNotes: product.angleNotes,
        priceLabel: product.priceLabel,
        category: product.category,
      },
    });
    await saveItem(item);
    log.info('briefed', { id: item.id, product: product.name });
  }

  log.info('done', { candidates: products.length, created: fresh.length, skippedAsSeen: products.length - fresh.length });
  await summary(
    `### Source\n- Candidates: ${products.length}\n- New briefs: ${fresh.length}\n- Already in pipeline: ${products.length - fresh.length}\n`,
  );
}

main().catch((error) => {
  log.error('stage failed', { error: error.message });
  console.error(error);
  process.exit(1);
});
