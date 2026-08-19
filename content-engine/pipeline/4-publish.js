#!/usr/bin/env node
// Stage 4 — PUBLISH. Ready video out to every enabled platform.
//
// Two properties this stage must have, because it is the only irreversible one:
//
//   1. Never double-post. Each platform result is written back to the item as soon as
//      it lands, so a re-run after a partial failure resumes on the platforms that
//      have not published yet and skips the ones that have.
//
//   2. Never exceed the channel's own cadence. The queue can hold forty videos; that
//      is not a reason to post forty times. The limits in channel.config.json are
//      enforced here, not left to the scheduler.

import { publisherFor } from '../publishers/index.js';
import { loadChannel, loadPlatforms, enabledPlatforms } from '../lib/config.js';
import { listItems, saveItem, advance, fail } from '../lib/store.js';
import { isDryRun } from '../lib/env.js';
import { logger, summary } from '../lib/log.js';

const log = logger('4-publish');

/** How many posts already went out today, and when the most recent one was. */
async function recentActivity() {
  const published = await listItems('published');
  const today = new Date().toISOString().slice(0, 10);
  let todayCount = 0;
  let latest = 0;

  for (const item of published) {
    for (const result of Object.values(item.publish ?? {})) {
      if (!result?.publishedAt) continue;
      const at = Date.parse(result.publishedAt);
      if (Number.isFinite(at)) latest = Math.max(latest, at);
      if (result.publishedAt.slice(0, 10) === today) {
        todayCount += 1;
        break; // one item published to three platforms is one post, not three
      }
    }
  }
  return { todayCount, latest };
}

async function main() {
  const [channel, platformSpecs, active] = await Promise.all([
    loadChannel(),
    loadPlatforms(),
    enabledPlatforms(),
  ]);
  const cadence = channel.cadence ?? {};
  const { todayCount, latest } = await recentActivity();

  const maxPerDay = cadence.postsPerDay ?? 2;
  if (todayCount >= maxPerDay) {
    log.info('daily cadence reached', { todayCount, maxPerDay });
    await summary(`### Publish\nDaily limit reached (${todayCount}/${maxPerDay}). Nothing posted.\n`);
    return;
  }

  const minGapMs = (cadence.minMinutesBetweenPosts ?? 0) * 60_000;
  const sinceLast = Date.now() - latest;
  if (latest && sinceLast < minGapMs) {
    const waitMin = Math.ceil((minGapMs - sinceLast) / 60_000);
    log.info('too soon since last post', { waitMin });
    await summary(`### Publish\nToo soon since last post — ${waitMin} min to go.\n`);
    return;
  }

  const queue = await listItems('ready');
  if (queue.length === 0) {
    log.info('nothing ready to publish');
    await summary('### Publish\nNothing ready.\n');
    return;
  }

  // Oldest first: a video that has been waiting is more likely to go stale.
  const item = queue.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const results = [];
  const errors = [];

  for (const platform of active) {
    if (item.publish?.[platform]?.remoteId) {
      log.info('already published, skipping', { id: item.id, platform });
      continue;
    }

    try {
      if (isDryRun()) {
        log.info('DRY_RUN — would publish', { id: item.id, platform });
        results.push(`${platform} (dry run)`);
        continue;
      }

      const publisher = publisherFor(platform);
      const result = await publisher.publish(item, platformSpecs[platform]);

      // Persist immediately. If the next platform throws, this one stays recorded.
      item.publish = { ...(item.publish ?? {}), [platform]: result };
      item.history.push({ at: result.publishedAt, event: `published:${platform}`, detail: result.url });
      await saveItem(item);

      results.push(`${platform} → ${result.url}`);
    } catch (error) {
      log.error('publish failed', { id: item.id, platform, error: error.message });
      errors.push(`${platform}: ${error.message}`);
    }
  }

  if (results.length === 0 && errors.length > 0) {
    await fail(item, 'all platforms failed', new Error(errors.join(' | ')));
    await summary(`### Publish\n:x: ${item.title}\n\n${errors.map((e) => `- ${e}`).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }

  if (errors.length > 0) {
    // Partial success is still success — the item advances, and the platforms that
    // failed are retried on the next run because their result slot is still empty.
    item.partialErrors = errors;
    log.warn('partial publish', { id: item.id, errors });
  }

  if (!isDryRun()) await advance(item, 'published', results.join('; '));

  await summary(
    `### Publish\n**${item.title}**\n\n${results.map((r) => `- ${r}`).join('\n')}\n` +
      (errors.length ? `\nRetrying next run:\n${errors.map((e) => `- ${e}`).join('\n')}\n` : ''),
  );
}

main().catch((error) => {
  log.error('stage failed', { error: error.message });
  console.error(error);
  process.exit(1);
});
