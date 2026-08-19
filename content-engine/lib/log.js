// Structured, greppable logging. One line per event so GitHub Actions logs stay readable.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;

function emit(level, scope, message, extra) {
  if (LEVELS[level] < threshold) return;
  const parts = [new Date().toISOString(), level.toUpperCase().padEnd(5), `[${scope}]`, message];
  if (extra && Object.keys(extra).length) parts.push(JSON.stringify(extra));
  const line = parts.join(' ');
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export function logger(scope) {
  return {
    debug: (m, e) => emit('debug', scope, m, e),
    info: (m, e) => emit('info', scope, m, e),
    warn: (m, e) => emit('warn', scope, m, e),
    error: (m, e) => emit('error', scope, m, e),
  };
}

// GitHub Actions job summary — renders as markdown on the workflow run page.
export async function summary(markdown) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return;
  const { appendFile } = await import('node:fs/promises');
  await appendFile(target, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8');
}
