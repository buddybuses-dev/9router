// TikTok Content Posting API.
//
// FILE_UPLOAD is used rather than PULL_FROM_URL on purpose: PULL_FROM_URL requires a
// domain verified in the TikTok developer console, which is one more thing to keep
// alive. Uploading the bytes directly works from any runner with no DNS involved.
//
// TikTok access tokens expire in 24h, so the refresh token is the credential stored
// as a secret and exchanged on every run.

import { readFile } from 'node:fs/promises';
import { required, optional } from '../lib/env.js';
import { request, requestJson } from '../lib/http.js';
import { logger } from '../lib/log.js';

const log = logger('publish:tiktok');
const API = 'https://open.tiktokapis.com/v2';

export const platform = 'tiktok';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function accessToken() {
  const payload = await requestJson(`${API}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: required('TIKTOK_CLIENT_KEY'),
      client_secret: required('TIKTOK_CLIENT_SECRET'),
      grant_type: 'refresh_token',
      refresh_token: required('TIKTOK_REFRESH_TOKEN'),
    }),
  });
  if (!payload?.access_token) {
    throw new Error(`TikTok token refresh failed: ${JSON.stringify(payload).slice(0, 300)}`);
  }
  return payload.access_token;
}

export async function publish(item, spec) {
  const token = await accessToken();
  const video = await readFile(item.media.videoPath);

  // A single chunk keeps this simple and is well within TikTok's limits for a
  // sub-60-second vertical clip.
  const init = await requestJson(`${API}/post/publish/video/init/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      post_info: {
        title: composeCaption(item, spec),
        privacy_level: spec.privacyLevel,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        brand_content_toggle: spec.disclosureBrandedContent,
        brand_organic_toggle: spec.disclosureCommercialContent,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: video.length,
        chunk_size: video.length,
        total_chunk_count: 1,
      },
    }),
  });

  const publishId = init?.data?.publish_id;
  const uploadUrl = init?.data?.upload_url;
  if (!publishId || !uploadUrl) {
    throw new Error(`TikTok init failed: ${JSON.stringify(init).slice(0, 400)}`);
  }

  await request(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(video.length),
      'Content-Range': `bytes 0-${video.length - 1}/${video.length}`,
    },
    body: video,
    timeoutMs: 900_000,
    retries: 1,
  });
  log.info('bytes uploaded', { id: item.id, publishId, bytes: video.length });

  const status = await waitForPublish(publishId, token);
  const remoteId = status?.publicaly_available_post_id?.[0] ?? publishId;

  log.info('published', { id: item.id, publishId, status: status?.status });
  return {
    platform,
    remoteId: String(remoteId),
    url: `https://www.tiktok.com/@${optional('TIKTOK_HANDLE', 'me')}/video/${remoteId}`,
    publishedAt: new Date().toISOString(),
  };
}

async function waitForPublish(publishId, token, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  let delay = 5_000;

  while (Date.now() < deadline) {
    const payload = await requestJson(`${API}/post/publish/status/fetch/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ publish_id: publishId }),
    });

    const status = payload?.data?.status;
    if (status === 'PUBLISH_COMPLETE') return payload.data;
    if (status === 'FAILED') {
      throw new Error(`TikTok publish failed: ${payload?.data?.fail_reason ?? 'no reason given'}`);
    }
    log.debug('waiting for publish', { publishId, status });
    await sleep(delay);
    delay = Math.min(delay * 1.5, 20_000);
  }
  throw new Error(`TikTok publish ${publishId} did not complete within ${timeoutMs / 1000}s`);
}

function composeCaption(item, spec) {
  const { caption, hashtags } = item.captions.tiktok;
  const tags = hashtags.slice(0, spec.maxHashtags).join(' ');
  return [caption, tags].filter(Boolean).join('\n\n').slice(0, spec.captionMaxChars);
}
