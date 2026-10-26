#!/usr/bin/env node
/**
 * Connect Paddle Billing to SASU Invoice. Needs in .env.local:
 *   PADDLE_API_KEY            (Developer tools → Authentication → API keys)
 *   VITE_PADDLE_CLIENT_TOKEN  (same page → client-side tokens; live_… or test_…)
 * The environment (live / sandbox) is detected from the key.
 *
 *   node scripts/setup-paddle.mjs
 *
 * Creates (or reuses) the Pro ($12/mo) and Business ($29/mo) products and
 * prices, the webhook ("notification destination") to the billing-webhook
 * function, links the plans to the prices in the database, and pushes the
 * secrets to Supabase. Idempotent; never prints keys or secrets.
 *
 * One setting can't be done by API: Paddle → Checkout → Checkout settings →
 * Default payment link = https://sasuinvoice.netlify.app/pay.html
 */
import { die, log, readEnv, runSupabaseSetup, setEnv, sql, warn } from './lib-env.mjs';

const env = readEnv();
const key = env.PADDLE_API_KEY ?? process.env.PADDLE_API_KEY;
const clientToken = env.VITE_PADDLE_CLIENT_TOKEN ?? '';
if (!key) die('Add PADDLE_API_KEY=… to .env.local (Paddle → Developer tools → Authentication).');
if (!/^(live|test)_/.test(clientToken))
  die('Add VITE_PADDLE_CLIENT_TOKEN=live_… (or test_…) to .env.local.');
if (!env.SUPABASE_PROJECT_REF) die('Run scripts/setup-supabase.sh first.');

const live = !/_sdbx_/.test(key);
if (live !== clientToken.startsWith('live_'))
  die('PADDLE_API_KEY and VITE_PADDLE_CLIENT_TOKEN are from different environments.');
const base = live ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';
log(`Paddle ${live ? 'LIVE (real payments)' : 'sandbox'} account.`);

const api = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Paddle-Version': '1',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      `Paddle ${method} ${path}: ${res.status} ${json.error?.detail ?? json.error?.code ?? ''}`.trim(),
    );
  return json.data;
};

// 1. Products and prices (matched by custom_data.sasu_plan) ------------------------------
const PLANS = [
  { code: 'pro', name: 'SASU Invoice Pro', amount: '1200' },
  { code: 'business', name: 'SASU Invoice Business', amount: '2900' },
];
const products = await api('GET', '/products?status=active&per_page=200');
const priceIds = {};
for (const plan of PLANS) {
  let product = products.find((p) => p.custom_data?.sasu_plan === plan.code);
  if (!product) {
    log(`Creating product ${plan.name}…`);
    const body = { name: plan.name, custom_data: { sasu_plan: plan.code } };
    product = await api('POST', '/products', { ...body, tax_category: 'saas' }).catch(() =>
      api('POST', '/products', { ...body, tax_category: 'standard' }),
    );
  }
  const prices = await api('GET', `/prices?product_id=${product.id}&status=active&per_page=50`);
  let price = prices.find(
    (p) =>
      p.unit_price?.amount === plan.amount &&
      p.unit_price?.currency_code === 'USD' &&
      p.billing_cycle?.interval === 'month',
  );
  if (!price) {
    log(`Creating ${plan.name} price ($${Number(plan.amount) / 100}/month)…`);
    price = await api('POST', '/prices', {
      product_id: product.id,
      description: 'Monthly',
      unit_price: { amount: plan.amount, currency_code: 'USD' },
      billing_cycle: { interval: 'month', frequency: 1 },
      // One subscription per workspace: no quantity stepper at checkout.
      quantity: { minimum: 1, maximum: 1 },
      custom_data: { sasu_plan: plan.code },
    });
  }
  priceIds[plan.code] = price.id;
}

// 2. Webhook ------------------------------------------------------------------------------------
const destination = `https://${env.SUPABASE_PROJECT_REF}.supabase.co/functions/v1/billing-webhook`;
const events = [
  'subscription.created',
  'subscription.updated',
  'subscription.activated',
  'subscription.canceled',
  'subscription.past_due',
  'subscription.paused',
  'subscription.resumed',
  'subscription.trialing',
  'transaction.completed',
  'transaction.payment_failed',
];
const settings = await api('GET', '/notification-settings');
let hook = settings.find((s) => s.destination === destination);
if (!hook) {
  log('Creating the billing webhook…');
  hook = await api('POST', '/notification-settings', {
    description: 'SASU Invoice billing-webhook',
    destination,
    type: 'url',
    api_version: 1,
    subscribed_events: events,
    traffic_source: 'all',
  });
} else if (hook.traffic_source !== 'all') {
  // "all" = real events plus Paddle's webhook simulator, used to test without payments.
  hook = await api('PATCH', `/notification-settings/${hook.id}`, { traffic_source: 'all' });
}
if (!hook.endpoint_secret_key) die('Paddle did not return the webhook secret.');
setEnv('PADDLE_WEBHOOK_SECRET', hook.endpoint_secret_key);
setEnv('PADDLE_ENVIRONMENT', live ? 'live' : 'sandbox');
setEnv('VITE_PADDLE_ENV', live ? 'live' : 'sandbox');

// 3. Link plans → prices in the database ----------------------------------------------------------
for (const [code, id] of Object.entries(priceIds)) {
  if (!/^pri_[a-z0-9]+$/.test(id)) die(`Unexpected price id for ${code}.`);
  sql(
    `update public.plans set provider = 'paddle', provider_price_id = '${id}' where code = '${code}'`,
  );
}
log(`Plans linked: pro → ${priceIds.pro}, business → ${priceIds.business}.`);

// 4. Secrets → Supabase, redeploy ------------------------------------------------------------------
log('Pushing secrets to Supabase and redeploying functions…');
runSupabaseSetup();

warn('One manual step: Paddle → Checkout → Checkout settings → Default payment link =');
console.log(
  '    https://sasuinvoice.netlify.app/pay.html   (and approve the domain if Paddle asks)',
);
if (live) warn('Live checkout works once Paddle has approved your account and that domain.');
log('Paddle connected.');
