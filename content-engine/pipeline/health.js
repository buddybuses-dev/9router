#!/usr/bin/env node
// Health check. Answers one question honestly: is the pipeline actually going to
// publish something in the next 24 hours, or has it quietly stalled?
//
// A stalled 24/7 pipeline that reports nothing is worse than one that is obviously
// broken, so this exits non-zero when the channel is about to go dark.

import { countItems, listItems, STAGE_ORDER } from '../lib/store.js';
import { loadChannel, enabledPlatforms } from '../lib/config.js';
import { optional } from '../lib/env.js';
import { logger, summary } from '../lib/log.js';

const log = logger('health');

const CREDENTIALS = {
  youtube: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'],
  instagram: ['INSTAGRAM_USER_ID', 'INSTAGRAM_ACCESS_TOKEN'],
  tiktok: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REFRESH_TOKEN'],
};

async function main() {
  const [channel, active] = await Promise.all([loadChannel(), enabledPlatforms()]);
  const problems = [];
  const notes = [];

  const depth = {};
  for (const stage of [...STAGE_ORDER, 'failed']) depth[stage] = await countItems(stage);

  const readyToShip = depth.ready;
  const daysOfRunway = readyToShip / (channel.cadence?.postsPerDay ?? 2);
  if (readyToShip === 0) {
    problems.push('No videos are ready to publish — the channel will go dark on the next scheduled slot.');
  } else if (daysOfRunway < 2) {
    notes.push(`Only ${daysOfRunway.toFixed(1)} days of runway in 04-ready.`);
  }

  if (!optional('ANTHROPIC_API_KEY')) problems.push('ANTHROPIC_API_KEY is not set — no scripts can be written.');

  for (const platform of active) {
    const missing = (CREDENTIALS[platform] ?? []).filter((key) => !optional(key));
    if (missing.length) problems.push(`${platform} is enabled but missing: ${missing.join(', ')}`);
  }

  if (depth.failed > 0) {
    const failed = await listItems('failed');
    notes.push(`${depth.failed} item(s) in triage: ${failed.slice(0, 5).map((i) => `${i.id} (${i.error?.reason})`).join(', ')}`);
  }

  const lines = [
    '### Pipeline health',
    '',
    '| Stage | Items |',
    '| --- | ---: |',
    ...[...STAGE_ORDER, 'failed'].map((s) => `| ${s} | ${depth[s]} |`),
    '',
    problems.length ? `**Blocking:**\n${problems.map((p) => `- :x: ${p}`).join('\n')}` : ':white_check_mark: No blocking problems.',
    notes.length ? `\n**Notes:**\n${notes.map((n) => `- ${n}`).join('\n')}` : '',
  ].join('\n');

  console.log(lines);
  await summary(lines);

  for (const problem of problems) log.error(problem);
  if (problems.length) process.exit(1);
}

main().catch((error) => {
  log.error('health check crashed', { error: error.message });
  console.error(error);
  process.exit(1);
});
