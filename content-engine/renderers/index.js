// Renderer registry. RENDERER picks the strategy; every renderer returns either a
// media descriptor or null (meaning "not ready yet, leave the item where it is").

import * as manual from './manual.js';
import * as ffmpeg from './ffmpeg.js';
import { optional } from '../lib/env.js';

const RENDERERS = { manual, ffmpeg };

export function activeRenderer() {
  const key = optional('RENDERER', 'manual');
  const renderer = RENDERERS[key];
  if (!renderer) {
    throw new Error(`Unknown RENDERER "${key}". Available: ${Object.keys(RENDERERS).join(', ')}`);
  }
  return renderer;
}
