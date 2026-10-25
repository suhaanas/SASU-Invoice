#!/usr/bin/env node
/**
 * Production build guard.
 *   - Always: refuses server secrets named VITE_* (they would be bundled).
 *   - With REQUIRE_CLOUD=1 (set in Netlify once the cloud workspace goes
 *     live): fails if the Supabase/Paddle configuration is missing or wrong,
 *     so a deploy can't silently ship with accounts switched off.
 * Without REQUIRE_CLOUD the site builds as the local-only editor, as before.
 *
 *   node scripts/check-env.mjs
 */
const required = {
  VITE_SUPABASE_URL: (v) =>
    /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(v) || 'must be https://<ref>.supabase.co',
  VITE_SUPABASE_ANON_KEY: (v) => v.length > 20 || 'looks too short',
};
const optional = {
  VITE_PADDLE_CLIENT_TOKEN: (v) =>
    /^(test|live)_[A-Za-z0-9]+$/.test(v) || 'must start with test_ or live_',
  VITE_PADDLE_ENV: (v) => ['sandbox', 'live'].includes(v) || 'must be sandbox or live',
};

const problems = [];
const requireCloud = process.env.REQUIRE_CLOUD === '1';
for (const [name, check] of Object.entries(requireCloud ? required : {})) {
  const value = process.env[name];
  if (!value) problems.push(`${name} is not set`);
  else if (check(value) !== true) problems.push(`${name} ${check(value)}`);
}
for (const [name, check] of Object.entries(optional)) {
  const value = process.env[name];
  if (value && check(value) !== true) problems.push(`${name} ${check(value)}`);
}
if (
  process.env.VITE_PADDLE_ENV === 'live' &&
  process.env.VITE_PADDLE_CLIENT_TOKEN?.startsWith('test_')
) {
  problems.push('VITE_PADDLE_ENV is live but VITE_PADDLE_CLIENT_TOKEN is a test token');
}
for (const name of Object.keys(process.env)) {
  if (name.startsWith('VITE_') && /SERVICE_ROLE|SECRET|PRIVATE|API_KEY/.test(name)) {
    problems.push(
      `${name} would be bundled into the browser; server secrets must not start with VITE_`,
    );
  }
}

if (problems.length) {
  console.error('Environment check failed:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log(
  requireCloud
    ? 'Environment check passed (cloud required).'
    : 'Environment check passed (cloud not required; set REQUIRE_CLOUD=1 to enforce).',
);
