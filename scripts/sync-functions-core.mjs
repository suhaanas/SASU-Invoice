#!/usr/bin/env node
/**
 * Copies the pure invoice core (validation + totals) into the Edge Functions
 * tree, so the server validates and computes totals with exactly the code the
 * editor uses. Supabase only bundles files under supabase/functions/.
 *
 *   node scripts/sync-functions-core.mjs          write the copies
 *   node scripts/sync-functions-core.mjs --check  fail if they are stale (CI)
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const FILES = ['money.ts', 'dates.ts', 'state.ts', 'calc.ts', 'validate.ts', 'emails.ts', 'recurrence.ts'];
const outDir = resolve(root, 'supabase/functions/_shared/core');
const HEADER = '// GENERATED from src/core by scripts/sync-functions-core.mjs. Do not edit.\n';
const check = process.argv.includes('--check');

let stale = [];
if (!check) mkdirSync(outDir, { recursive: true });
for (const file of FILES) {
  // Supabase's server-side bundler ignores import maps, so pin npm specifiers.
  const expected =
    HEADER +
    readFileSync(resolve(root, 'src/core', file), 'utf8').replace(/from 'zod';/g, "from 'npm:zod@4.6.5';");
  const target = resolve(outDir, file);
  if (check) {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== expected) stale.push(file);
  } else {
    writeFileSync(target, expected);
  }
}

if (stale.length > 0) {
  console.error(`Edge Function core is stale: ${stale.join(', ')}. Run: npm run functions:sync`);
  process.exit(1);
}
console.log(
  check ? 'Edge Function core is up to date.' : `Synced ${FILES.length} files to ${outDir}`,
);
