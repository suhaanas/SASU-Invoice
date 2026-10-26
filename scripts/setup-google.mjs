#!/usr/bin/env node
/**
 * Switch on "Continue with Google". Needs in .env.local (Google Cloud console →
 * APIs & Services → Credentials → OAuth client ID, type "Web application"):
 *   GOOGLE_CLIENT_ID      (…apps.googleusercontent.com)
 *   GOOGLE_CLIENT_SECRET
 *
 *   node scripts/setup-google.mjs
 *
 * Adds the Google provider to supabase/config.toml (both values stay in
 * .env.local and are read through env()), pushes the auth settings and checks
 * that Supabase reports Google as enabled. The sign-in pages show the Google
 * button by themselves once it is. Idempotent; never prints the secret.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { die, log, readEnv, warn } from './lib-env.mjs';

const CONFIG = 'supabase/config.toml';
const env = readEnv();
const ref = env.SUPABASE_PROJECT_REF;
if (!ref) die('Run scripts/setup-supabase.sh first.');

const callback = `https://${ref}.supabase.co/auth/v1/callback`;
const explainClient = (todo = true) => {
  console.log(
    '    In Google Cloud → APIs & Services → Credentials → Create OAuth client ID (Web application):',
  );
  console.log('      Authorised JavaScript origins:  https://sasuinvoice.netlify.app');
  console.log(`      Authorised redirect URIs:       ${callback}`);
  if (todo)
    console.log('    Then add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local and re-run.');
};
if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
  warn('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not in .env.local yet.');
  explainClient();
  process.exit(1);
}
if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(env.GOOGLE_CLIENT_ID))
  die('GOOGLE_CLIENT_ID should end in .apps.googleusercontent.com.');

// 1. Provider section in config.toml -------------------------------------------------------
const config = readFileSync(CONFIG, 'utf8');
if (!config.includes('[auth.external.google]')) {
  const section = [
    '',
    '# Google sign-in. Values come from .env.local (scripts/setup-google.mjs).',
    '[auth.external.google]',
    'enabled = true',
    'client_id = "env(GOOGLE_CLIENT_ID)"',
    'secret = "env(GOOGLE_CLIENT_SECRET)"',
    'skip_nonce_check = false',
    '',
  ].join('\n');
  writeFileSync(CONFIG, config.replace(/\n\[auth\.rate_limit\]/, `${section}\n[auth.rate_limit]`));
  log('Added the Google provider to supabase/config.toml.');
}

// 2. Push auth settings ----------------------------------------------------------------------
log('Pushing auth settings to Supabase…');
execFileSync('supabase', ['config', 'push', '--project-ref', ref, '--yes'], {
  stdio: ['ignore', 'ignore', 'inherit'],
  env: {
    ...process.env,
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
  },
});

// 3. Check ---------------------------------------------------------------------------------------
// Auth settings take a few seconds to apply.
let settings = {};
for (let attempt = 0; attempt < 10 && settings.external?.google !== true; attempt++) {
  if (attempt) await new Promise((r) => setTimeout(r, 3000));
  const res = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY },
  });
  settings = await res.json().catch(() => ({}));
}
if (settings.external?.google !== true) die('Supabase does not report Google as enabled yet.');
log('Google sign-in is on. The OAuth client must have these settings:');
explainClient(false);
