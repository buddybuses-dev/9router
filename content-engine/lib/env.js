// Environment access with explicit failure. Never let a missing credential turn into
// a silent no-op that looks like "the pipeline ran fine and produced nothing".

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

let loaded = false;

// Minimal .env loader so local runs on station D behave like Actions runs.
// Actions injects secrets as real env vars, so this is a no-op there.
export function loadDotEnv(dir = process.cwd()) {
  if (loaded) return;
  loaded = true;
  const file = resolve(dir, '.env');
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function required(name) {
  loadDotEnv();
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Set it as a GitHub Actions secret, or in .env for local runs — see docs/SETUP.md.`,
    );
  }
  return value;
}

export function optional(name, fallback = undefined) {
  loadDotEnv();
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export function flag(name, fallback = false) {
  const value = optional(name);
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

// True when the run must not touch any external service. Every publisher and
// every paid API call checks this, so a dry run is safe to trigger from anywhere.
export function isDryRun() {
  return flag('DRY_RUN', false);
}
