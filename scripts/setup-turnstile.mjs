#!/usr/bin/env node
/**
 * Switch on the Cloudflare Turnstile bot check for sign-up, sign-in and
 * password reset. Needs in .env.local (Cloudflare dashboard → Turnstile → Add
 * widget, hostname sasuinvoice.netlify.app, mode "Managed"):
 *   VITE_TURNSTILE_SITE_KEY   (public, bundled into the site)
 *   TURNSTILE_SECRET          (server-side, read by Supabase Auth)
 *
 *   node scripts/setup-turnstile.mjs
 *
 * Adds [auth.captcha] to supabase/config.toml (the secret stays in .env.local,
 * read through env()), pushes the auth settings, and sets the site key for
 * Netlify's production build. Redeploy the site afterwards. Never prints the secret.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { die, log, readEnv } from './lib-env.mjs';

const CONFIG = 'supabase/config.toml';
const env = readEnv();
const ref = env.SUPABASE_PROJECT_REF;
if (!ref) die('Run scripts/setup-supabase.sh first.');
if (!env.VITE_TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET)
  die('Add VITE_TURNSTILE_SITE_KEY and TURNSTILE_SECRET to .env.local (Cloudflare → Turnstile).');
if (!/^[0-9A-Za-z_-]{10,}$/.test(env.VITE_TURNSTILE_SITE_KEY))
  die('VITE_TURNSTILE_SITE_KEY looks wrong.');

// 1. Captcha section in config.toml -----------------------------------------------------------
const config = readFileSync(CONFIG, 'utf8');
if (!config.includes('[auth.captcha]')) {
  const section = [
    '',
    '# Bot check on sign-up, sign-in and password reset (scripts/setup-turnstile.mjs).',
    '[auth.captcha]',
    'enabled = true',
    'provider = "turnstile"',
    'secret = "env(TURNSTILE_SECRET)"',
    '',
  ].join('\n');
  writeFileSync(CONFIG, config.replace(/\n\[auth\.rate_limit\]/, `${section}\n[auth.rate_limit]`));
  log('Added the Turnstile captcha to supabase/config.toml.');
}

// 2. Push auth settings -------------------------------------------------------------------------
log('Pushing auth settings to Supabase…');
execFileSync('supabase', ['config', 'push', '--project-ref', ref, '--yes'], {
  stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, ...env },
});

// 3. Site key for the production build ------------------------------------------------------------
execFileSync(
  'netlify',
  ['env:set', 'VITE_TURNSTILE_SITE_KEY', env.VITE_TURNSTILE_SITE_KEY, '--context', 'production'],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);
log('Turnstile is on for Supabase Auth. Rebuild and redeploy the site so the widget appears.');
