// fetch with bounded retry. Upstream APIs (YouTube, Meta, TikTok, Whop) all rate
// limit, and a 429 mid-pipeline should cost a pause, not a lost content item.

import { logger } from './log.js';

const log = logger('http');
const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function request(url, options = {}) {
  const { retries = 4, retryBaseMs = 1000, timeoutMs = 60_000, ...init } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (response.ok) return response;

      if (!RETRYABLE.has(response.status) || attempt === retries) {
        const body = await response.text().catch(() => '');
        throw new HttpError(response.status, url, body);
      }

      // Honour Retry-After when the server sends one; it is more accurate than backoff.
      const retryAfter = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : retryBaseMs * 2 ** attempt;
      log.warn('retrying', { url: redact(url), status: response.status, attempt: attempt + 1, waitMs });
      await sleep(waitMs);
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof HttpError) throw error;
      lastError = error;
      if (attempt === retries) break;
      const waitMs = retryBaseMs * 2 ** attempt;
      log.warn('network error, retrying', { url: redact(url), error: error.message, attempt: attempt + 1, waitMs });
      await sleep(waitMs);
    }
  }
  throw lastError ?? new Error(`Request to ${redact(url)} failed after ${retries + 1} attempts`);
}

export async function requestJson(url, options = {}) {
  const response = await request(url, options);
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${redact(url)} but got: ${text.slice(0, 300)}`);
  }
}

export class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} from ${redact(url)}: ${String(body).slice(0, 500)}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = redact(url);
    this.body = body;
  }
}

// Access tokens routinely ride in query strings; keep them out of the logs.
function redact(url) {
  try {
    const parsed = new URL(url);
    for (const key of ['access_token', 'key', 'token', 'client_secret']) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, 'REDACTED');
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
