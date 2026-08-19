#!/usr/bin/env node
// Stage 5 — MEASURE. Pull performance back onto the items that produced it.
//
// This closes the loop: config/whop.sources.json decides what gets made, and these
// numbers are the only honest input for changing that decision. Stats are written
// onto the published items and committed, so the history is queryable with git alone.

import { listItems, saveItem } from '../lib/store.js';
import { enabledPlatforms } from '../lib/config.js';
import { required, optional } from '../lib/env.js';
import { requestJson } from '../lib/http.js';
import { logger, summary } from '../lib/log.js';

const log = logger('5-stats');
const META_API = `https://graph.facebook.com/${optional('META_API_VERSION', 'v21.0')}`;

async function youtubeStats(videoIds) {
  if (videoIds.length === 0) return {};
  const token = await youtubeToken();
  const payload = await requestJson(
    `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoIds.join(',')}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const out = {};
  for (const video of payload?.items ?? []) {
    out[video.id] = {
      views: Number(video.statistics.viewCount ?? 0),
      likes: Number(video.statistics.likeCount ?? 0),
      comments: Number(video.statistics.commentCount ?? 0),
    };
  }
  return out;
}

async function youtubeToken() {
  const payload = await requestJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: required('YOUTUBE_CLIENT_ID'),
      client_secret: required('YOUTUBE_CLIENT_SECRET'),
      refresh_token: required('YOUTUBE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  return payload.access_token;
}

async function instagramStats(mediaId) {
  const token = required('INSTAGRAM_ACCESS_TOKEN');
  const payload = await requestJson(
    `${META_API}/${mediaId}/insights?metric=views,likes,comments,shares,saved&access_token=${encodeURIComponent(token)}`,
  );
  const out = {};
  for (const metric of payload?.data ?? []) {
    out[metric.name] = metric.values?.[0]?.value ?? 0;
  }
  return out;
}

async function main() {
  const active = await enabledPlatforms();
  const items = await listItems('published');
  if (items.length === 0) {
    await summary('### Stats\nNothing published yet.\n');
    return;
  }

  // Batch the YouTube lookup — one request for every video beats one per video.
  const ytIds = items.map((i) => i.publish?.youtube?.remoteId).filter(Boolean);
  let ytStats = {};
  if (active.includes('youtube') && ytIds.length) {
    try {
      ytStats = await youtubeStats(ytIds.slice(0, 50));
    } catch (error) {
      log.warn('youtube stats unavailable', { error: error.message });
    }
  }

  const rows = [];
  for (const item of items) {
    const collected = { collectedAt: new Date().toISOString() };

    const ytId = item.publish?.youtube?.remoteId;
    if (ytId && ytStats[ytId]) collected.youtube = ytStats[ytId];

    const igId = item.publish?.instagram?.remoteId;
    if (active.includes('instagram') && igId) {
      try {
        collected.instagram = await instagramStats(igId);
      } catch (error) {
        log.warn('instagram insights unavailable', { id: item.id, error: error.message });
      }
    }

    if (Object.keys(collected).length > 1) {
      item.stats = collected;
      await saveItem(item);
      rows.push({
        title: item.title,
        youtube: collected.youtube?.views ?? '-',
        instagram: collected.instagram?.views ?? '-',
      });
    }
  }

  rows.sort((a, b) => (Number(b.youtube) || 0) - (Number(a.youtube) || 0));
  const table = [
    '| Video | YouTube views | Instagram views |',
    '| --- | ---: | ---: |',
    ...rows.slice(0, 20).map((r) => `| ${r.title} | ${r.youtube} | ${r.instagram} |`),
  ].join('\n');

  log.info('stats collected', { items: rows.length });
  await summary(`### Stats\n\n${table}\n`);
}

main().catch((error) => {
  log.error('stage failed', { error: error.message });
  console.error(error);
  process.exit(1);
});
