// Instagram's Graph API will not accept a file upload — it fetches the video from a
// public URL you provide. So the video needs a public home for a few minutes.
//
// Rather than add an S3 bucket and a bill, this uses GitHub Releases: the runner
// already holds a token with write access to its own repo, release assets are served
// from a public CDN URL, and every published video keeps a permanent, versioned
// artifact next to the commit that produced it.
//
// Set PUBLIC_MEDIA_BASE_URL instead if you already host media somewhere.

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { optional, required } from './env.js';
import { request, requestJson } from './http.js';
import { logger } from './log.js';

const log = logger('hosting');
const RELEASE_TAG = 'media';

export async function publicUrlFor(filePath) {
  const base = optional('PUBLIC_MEDIA_BASE_URL');
  if (base) {
    const url = `${base.replace(/\/$/, '')}/${basename(filePath)}`;
    log.info('using configured public media base', { url });
    return url;
  }
  return uploadToRelease(filePath);
}

function repoSlug() {
  const slug = optional('GITHUB_REPOSITORY');
  if (!slug) {
    throw new Error(
      'Cannot host media publicly: set PUBLIC_MEDIA_BASE_URL, or run inside GitHub Actions ' +
        'where GITHUB_REPOSITORY and GITHUB_TOKEN are available.',
    );
  }
  return slug;
}

async function ghJson(url, options = {}) {
  const token = required('GITHUB_TOKEN');
  return requestJson(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers ?? {}),
    },
  });
}

async function ensureRelease(slug) {
  const existing = await ghJson(`https://api.github.com/repos/${slug}/releases/tags/${RELEASE_TAG}`)
    .catch((error) => {
      if (error.status === 404) return null;
      throw error;
    });
  if (existing) return existing;

  log.info('creating media release', { tag: RELEASE_TAG });
  return ghJson(`https://api.github.com/repos/${slug}/releases`, {
    method: 'POST',
    body: JSON.stringify({
      tag_name: RELEASE_TAG,
      name: 'Rendered media',
      body: 'Video assets published by the content pipeline. Managed automatically.',
      prerelease: true,
    }),
  });
}

async function uploadToRelease(filePath) {
  const slug = repoSlug();
  const token = required('GITHUB_TOKEN');
  const release = await ensureRelease(slug);
  const name = basename(filePath);

  // Replace an asset of the same name so re-runs stay idempotent.
  const clash = (release.assets ?? []).find((asset) => asset.name === name);
  if (clash) {
    log.info('replacing existing asset', { name });
    await ghJson(`https://api.github.com/repos/${slug}/releases/assets/${clash.id}`, { method: 'DELETE' });
  }

  const body = await readFile(filePath);
  const uploadUrl = release.upload_url.replace(/\{.*\}$/, `?name=${encodeURIComponent(name)}`);
  const asset = await requestJson(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'video/mp4',
      'Content-Length': String(body.length),
    },
    body,
    timeoutMs: 900_000,
    retries: 1,
  });

  if (!asset?.browser_download_url) throw new Error('GitHub release upload returned no download URL');
  log.info('hosted media', { url: asset.browser_download_url, bytes: body.length });
  return asset.browser_download_url;
}
