#!/usr/bin/env node
/**
 * Connect Resend (live) to SASU Invoice. Needs RESEND_API_KEY in .env.local;
 * optional RESEND_DOMAIN (e.g. mail.yourcompany.com) for sending to clients.
 *
 *   node scripts/setup-resend.mjs
 *
 * - Domain: creates it in Resend if needed, prints the DNS records to add,
 *   and asks Resend to verify. Until it's verified, mail is sent from
 *   onboarding@resend.dev, which Resend only delivers to the account owner.
 * - Webhook: creates (or reuses) the delivery webhook to the email-webhook
 *   function and stores its signing secret as RESEND_WEBHOOK_SECRET.
 * - Pushes the secrets to Supabase and redeploys the functions.
 * Idempotent; never prints keys or secrets.
 */
import { die, log, readEnv, runSupabaseSetup, setEnv, warn } from './lib-env.mjs';

const env = readEnv();
const key = env.RESEND_API_KEY ?? process.env.RESEND_API_KEY;
if (!key) die('Add RESEND_API_KEY=re_… to .env.local (resend.com → API Keys, full access).');
if (!env.SUPABASE_PROJECT_REF) die('Run scripts/setup-supabase.sh first.');

const api = async (method, path, body) => {
  const res = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${method} ${path}: ${res.status} ${json.message ?? ''}`.trim());
  return json;
};

// 1. Domain -------------------------------------------------------------------------
const domainName = (env.RESEND_DOMAIN ?? '').trim().toLowerCase();
let from = 'SASU Invoice <onboarding@resend.dev>';
if (domainName) {
  const { data: domains = [] } = await api('GET', '/domains');
  let domain = domains.find((d) => d.name === domainName);
  if (!domain) {
    log(`Adding domain ${domainName} to Resend…`);
    domain = await api('POST', '/domains', { name: domainName, region: 'eu-west-1' });
  }
  const detail = await api('GET', `/domains/${domain.id}`);
  if (detail.status === 'verified') {
    from = `SASU Invoice <invoices@${domainName}>`;
    log(`Domain ${domainName} is verified.`);
  } else {
    warn(`Domain ${domainName} is "${detail.status}". Add these DNS records at your registrar, then re-run:`);
    for (const r of detail.records ?? []) {
      console.log(`    ${r.type.padEnd(5)} ${r.name.padEnd(40)} ${r.value}${r.priority ? ` (priority ${r.priority})` : ''}`);
    }
    console.log(`    TXT   _dmarc.${domainName.padEnd(33)} v=DMARC1; p=none;`);
    await api('POST', `/domains/${domain.id}/verify`).catch(() => {});
  }
} else {
  warn('No RESEND_DOMAIN set: using onboarding@resend.dev (delivers only to your Resend account email).');
}
setEnv('EMAIL_FROM_ADDRESS', from.replace(/^.*<|>$/g, ''));

// 2. Webhook --------------------------------------------------------------------------
const endpoint = `https://${env.SUPABASE_PROJECT_REF}.supabase.co/functions/v1/email-webhook`;
const events = ['email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained', 'email.failed'];
const { data: hooks = [] } = await api('GET', '/webhooks');
let hook = hooks.find((h) => h.endpoint === endpoint);
if (!hook) {
  log('Creating the delivery webhook…');
  hook = await api('POST', '/webhooks', { endpoint, events });
}
const secret = hook.signing_secret ?? (await api('GET', `/webhooks/${hook.id}`)).signing_secret;
if (!secret) die('Resend did not return the webhook signing secret.');
setEnv('RESEND_WEBHOOK_SECRET', secret);
log('Webhook connected; signing secret saved to .env.local.');

// 3. Secrets → Supabase, redeploy -------------------------------------------------------
log('Pushing secrets to Supabase and redeploying functions…');
runSupabaseSetup();
log(`Resend connected. Sending from ${from.replace(/^.*</, '').replace('>', '')}.`);
