/**
 * Tiny helpers for setup scripts: read .env.local and update single keys in
 * it (file kept at mode 600). Values are never printed.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const ENV_FILE = '.env.local';

export function readEnv() {
  const env = {};
  if (!existsSync(ENV_FILE)) return env;
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  return env;
}

export function setEnv(key, value) {
  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8').split('\n') : [];
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.splice(lines.at(-1) === '' ? lines.length - 1 : lines.length, 0, `${key}=${value}`);
  writeFileSync(ENV_FILE, lines.join('\n').replace(/\n*$/, '\n'));
  chmodSync(ENV_FILE, 0o600);
}

export const log = (msg) => console.log(`\x1b[1m▸ ${msg}\x1b[0m`);
export const warn = (msg) => console.log(`\x1b[33m! ${msg}\x1b[0m`);
export function die(msg) {
  console.error(`\x1b[31m✖ ${msg}\x1b[0m`);
  process.exit(1);
}

/** Run SQL on the linked Supabase project through the CLI (management API). */
export function sql(query) {
  return execFileSync('supabase', ['db', 'query', '--linked', query, '-o', 'json'], { encoding: 'utf8' });
}

/** Push secrets and redeploy functions (idempotent). */
export function runSupabaseSetup() {
  execFileSync('bash', ['scripts/setup-supabase.sh'], { stdio: ['ignore', 'inherit', 'inherit'] });
}
