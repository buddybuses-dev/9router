// YouTube Data API v3 — resumable upload.
//
// Auth is a long-lived refresh token exchanged for an access token on every run.
// That is the only OAuth shape that survives in a headless scheduled job; see
// docs/SETUP.md for how to mint it once by hand.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { required } from '../lib/env.js';
import { request, requestJson } from '../lib/http.js';
import { logger } from '../lib/log.js';

const log = logger('publish:youtube');

export const platform = 'youtube';

async function accessToken() {
  const body = new URLSearchParams({
    client_id: required('YOUTUBE_CLIENT_ID'),
    client_secret: required('YOUTUBE_CLIENT_SECRET'),
    refresh_token: required('YOUTUBE_REFRESH_TOKEN'),
    grant_type: 'refresh_token',
  });

  const payload = await requestJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!payload?.access_token) throw new Error('YouTube token exchange returned no access_token');
  return payload.access_token;
}

export async function publish(item, spec) {
  const token = await accessToken();
  const caption = item.captions.youtube;
  const filePath = item.media.videoPath;
  const { size } = await stat(filePath);

  // Shorts are classified by the video's own aspect ratio and length, not by a flag.
  // The #Shorts hashtag in the title is the one lever we control.
  const title = ensureHashtags(caption.title, spec.requiredHashtags, spec.titleMaxChars);

  const metadata = {
    snippet: {
      title,
      description: buildDescription(item, caption.description),
      tags: caption.tags.slice(0, spec.maxTags),
      categoryId: spec.categoryId,
    },
    status: {
      privacyStatus: spec.privacyStatus,
      selfDeclaredMadeForKids: spec.madeForKids,
    },
  };

  // Step 1 — open a resumable session.
  const initResponse = await request(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Length': String(size),
        'X-Upload-Content-Type': 'video/*',
      },
      body: JSON.stringify(metadata),
    },
  );

  const uploadUrl = initResponse.headers.get('location');
  if (!uploadUrl) throw new Error('YouTube did not return a resumable upload URL');

  // Step 2 — stream the file. Node needs duplex:'half' to send a stream body.
  const uploaded = await requestJson(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/*', 'Content-Length': String(size) },
    body: createReadStream(filePath),
    duplex: 'half',
    timeoutMs: 900_000,
    retries: 1,
  });

  if (!uploaded?.id) throw new Error(`YouTube upload returned no video id: ${JSON.stringify(uploaded).slice(0, 300)}`);

  const url = `https://www.youtube.com/watch?v=${uploaded.id}`;
  log.info('published', { id: item.id, videoId: uploaded.id, url });
  return { platform, remoteId: uploaded.id, url, publishedAt: new Date().toISOString() };
}

function ensureHashtags(title, required = [], maxChars = 100) {
  let result = title;
  for (const tag of required) {
    if (result.toLowerCase().includes(tag.toLowerCase())) continue;
    if (result.length + tag.length + 1 <= maxChars) result = `${result} ${tag}`;
  }
  return result.slice(0, maxChars);
}

function buildDescription(item, description) {
  const link = item.source?.affiliateUrl || item.source?.url;
  return link ? `${description}\n\n${link}` : description;
}
