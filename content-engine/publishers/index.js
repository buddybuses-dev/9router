import * as youtube from './youtube.js';
import * as instagram from './instagram.js';
import * as tiktok from './tiktok.js';

export const PUBLISHERS = { youtube, instagram, tiktok };

export function publisherFor(platform) {
  const publisher = PUBLISHERS[platform];
  if (!publisher) throw new Error(`No publisher for platform "${platform}"`);
  return publisher;
}
