// Instagram Reels via the Instagram Graph API.
//
// Three-step dance, and all three matter: create a media container pointing at a
// public video URL, poll until Meta has finished transcoding, then publish. Skipping
// the poll is the single most common cause of "publish returned an error for no
// reason" — the container simply was not ready yet.
//
// Needs an Instagram Business or Creator account linked to a Facebook Page, and a
// long-lived page access token. See docs/SETUP.md.

import { required, optional } from '../lib/env.js';
import { requestJson } from '../lib/http.js';
import { publicUrlFor } from '../lib/hosting.js';
import { logger } from '../lib/log.js';

const log = logger('publish:instagram');
const API = `https://graph.facebook.com/${optional('META_API_VERSION', 'v21.0')}`;

export const platform = 'instagram';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function publish(item, spec) {
  const userId = required('INSTAGRAM_USER_ID');
  const token = required('INSTAGRAM_ACCESS_TOKEN');
  const videoUrl = await publicUrlFor(item.media.videoPath);

  const caption = composeCaption(item, spec);

  const container = await requestJson(`${API}/${userId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'REELS',
      video_url: videoUrl,
      caption,
      share_to_feed: spec.shareToFeed,
      access_token: token,
    }),
  });

  if (!container?.id) throw new Error(`Instagram container creation failed: ${JSON.stringify(container).slice(0, 300)}`);
  log.info('container created', { id: item.id, containerId: container.id });

  await waitForContainer(container.id, token);

  const published = await requestJson(`${API}/${userId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: container.id, access_token: token }),
  });

  if (!published?.id) throw new Error(`Instagram publish failed: ${JSON.stringify(published).slice(0, 300)}`);

  const url = `https://www.instagram.com/reel/${published.id}/`;
  log.info('published', { id: item.id, mediaId: published.id });
  return { platform, remoteId: published.id, url, publishedAt: new Date().toISOString() };
}

// Meta transcodes asynchronously; 5 minutes is generous for a sub-60-second clip.
async function waitForContainer(containerId, token, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  let delay = 5_000;

  while (Date.now() < deadline) {
    const status = await requestJson(
      `${API}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`,
    );
    if (status?.status_code === 'FINISHED') return;
    if (status?.status_code === 'ERROR') {
      throw new Error(`Instagram rejected the video: ${status.status ?? 'no detail given'}`);
    }
    log.debug('waiting for transcode', { containerId, status: status?.status_code });
    await sleep(delay);
    delay = Math.min(delay * 1.5, 20_000);
  }
  throw new Error(`Instagram container ${containerId} never reached FINISHED within ${timeoutMs / 1000}s`);
}

function composeCaption(item, spec) {
  const { caption, hashtags } = item.captions.instagram;
  const link = item.source?.affiliateUrl || item.source?.url;
  const tags = hashtags.slice(0, spec.maxHashtags).join(' ');
  // Instagram captions are not clickable, so the link goes in as plain text for
  // people who want to type it, with the bio as the real route.
  const parts = [caption, link ? `Link: ${link}` : null, tags].filter(Boolean);
  return parts.join('\n\n').slice(0, spec.captionMaxChars);
}
