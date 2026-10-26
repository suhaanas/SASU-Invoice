#!/usr/bin/env node
/**
 * Live smoke test against a real Supabase project (staging!). Uses the same
 * public endpoints as the browser, with two throwaway users created through
 * the admin API (pre-confirmed, so no emails are sent), and removes everything
 * it created at the end.
 *
 *   node --env-file=.env.local scripts/live-smoke.mjs
 *
 * Needs VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 * Never point it at production.
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey)
  throw new Error('Missing Supabase env (use --env-file=.env.local)');
if (/prod/i.test(process.env.SUPABASE_PROJECT_NAME ?? ''))
  throw new Error('Refusing to run against production');

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const results = [];
let failures = 0;
const check = (ok, label, detail = '') => {
  results.push(`${ok ? '✓' : '✗'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const stamp = Date.now();
const users = [];
const orgs = [];

async function makeUser(name) {
  const email = `smoke+${name}-${stamp}@example.com`;
  const password = `Smoke-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  users.push(data.user.id);
  const client = createClient(url, anonKey, opts);
  const { error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { client, id: data.user.id };
}

function invoiceDoc(number, issued) {
  return {
    version: 2,
    id: randomUUID(),
    docType: 'invoice',
    ref: null,
    business: {
      name: 'Smoke Studio',
      address: '',
      email: 'hi@example.com',
      phone: '',
      website: '',
      taxId: '',
      legal: { form: '', capital: '', regNumber: '', regPlace: '' },
    },
    client: {
      name: 'Jane',
      company: 'Acme Smoke Ltd',
      address: '',
      email: 'jane@example.com',
      phone: '',
      taxId: '',
      regNumber: '',
      deliveryAddress: '',
    },
    meta: {
      number,
      currency: 'GBP',
      locale: 'en-GB',
      issueDate: '2026-10-01',
      dueTerm: 'net30',
      dueDate: '2026-10-31',
      poNumber: '',
      status: issued ? 'Unpaid' : 'Draft',
      supplyDate: '',
      supplySameAsIssue: true,
      validUntil: '',
      operation: '',
      issuedAt: issued ? Date.now() : null,
    },
    items: [
      { id: 'l1', desc: 'Design', qty: 2, unit: '', rate: 600, taxRate: null, vatCategory: 'S' },
    ],
    totals: {
      discountType: 'percent',
      discountValue: 0,
      taxRate: 20,
      taxLabel: 'VAT',
      shipping: 0,
      amountPaid: 0,
    },
    notes: { paymentTerms: '', notes: '', bankDetails: '', footer: '', legalMentions: [] },
    payment: { method: 'none', beneficiary: '', iban: '', bic: '', upiId: '', link: '' },
    style: { accent: '#5b5ef4', logoShape: 'square', logo: '' },
    updatedAt: Date.now(),
  };
}

try {
  const a = await makeUser('owner');
  const b = await makeUser('other');
  check(true, 'two confirmed users signed in through Supabase Auth');

  const { data: orgA, error: orgErr } = await a.client.rpc('create_organization', {
    p_name: 'Smoke Studio',
    p_country: 'GB',
    p_currency: 'GBP',
    p_timezone: 'Europe/London',
  });
  check(!orgErr && !!orgA, 'create_organization', orgErr?.message);
  orgs.push(orgA);
  const { data: orgB } = await b.client.rpc('create_organization', { p_name: 'Other Co' });
  orgs.push(orgB);

  const { data: sub } = await a.client
    .from('subscriptions')
    .select('plan_code, status')
    .eq('org_id', orgA)
    .single();
  check(
    sub?.plan_code === 'pro' && sub?.status === 'trialing',
    'new organization gets a Pro trial',
  );

  // Save + issue through the Edge Function (server recomputes totals).
  const doc = invoiceDoc('INV-001', true);
  const { data: saved, error: saveErr } = await a.client.functions.invoke('invoices', {
    body: { action: 'save', orgId: orgA, doc },
  });
  check(
    !saveErr && saved?.issued === true,
    'invoices function saves and issues a document',
    saveErr?.message,
  );
  const { data: row } = await a.client
    .from('invoices')
    .select('id, total_minor, balance_minor, client_id')
    .eq('org_id', orgA)
    .single();
  check(
    row?.total_minor === 144000,
    'server-computed total (2 × £600 + 20% VAT = £1,440.00)',
    `got ${row?.total_minor}`,
  );
  check(!!row?.client_id, 'client created and linked automatically');

  // Locked after issue.
  const tampered = { ...doc, items: [{ ...doc.items[0], rate: 1 }] };
  const { error: lockErr } = await a.client.functions.invoke('invoices', {
    body: { action: 'save', orgId: orgA, doc: tampered },
  });
  check(
    lockErr?.context?.status === 423,
    'issued documents are locked (423)',
    `got ${lockErr?.context?.status}`,
  );

  // Payments.
  const { error: payErr } = await a.client.rpc('record_payment', {
    p_invoice: row.id,
    p_amount_minor: 44000,
    p_paid_on: '2026-10-10',
    p_method: 'bank_transfer',
    p_reference: 'SMOKE',
  });
  check(!payErr, 'record_payment', payErr?.message);
  const { data: afterPay } = await a.client
    .from('invoices')
    .select('paid_minor, balance_minor, status')
    .eq('id', row.id)
    .single();
  check(
    afterPay?.balance_minor === 100000 && afterPay?.status === 'Unpaid',
    'balance follows the payments ledger',
  );

  // Dashboard aggregates.
  const { data: summary, error: sumErr } = await a.client.rpc('dashboard_summary', {
    p_org: orgA,
    p_currency: 'GBP',
  });
  check(
    !sumErr && summary?.partialCount === 1,
    'dashboard_summary sees the partially paid invoice',
    sumErr?.message,
  );

  // Share link → anonymous client view.
  const { data: token } = await a.client.rpc('create_invoice_share', {
    p_invoice: row.id,
    p_days: 7,
  });
  const anon = createClient(url, anonKey, opts);
  const { data: shared } = await anon.rpc('get_shared_invoice', { p_token: token });
  check(shared?.balanceMinor === 100000, 'anonymous client view through a share link');
  const { data: nope } = await anon.rpc('get_shared_invoice', { p_token: '0'.repeat(64) });
  check(nope === null, 'unknown share tokens reveal nothing');

  // Tenant isolation on the real API.
  const { data: leaked } = await b.client.from('invoices').select('id').eq('org_id', orgA);
  check(
    Array.isArray(leaked) && leaked.length === 0,
    'another organization cannot read the invoice',
  );
  const { error: crossSave } = await b.client.functions.invoke('invoices', {
    body: { action: 'save', orgId: orgA, doc: invoiceDoc('X-1', false) },
  });
  check(
    crossSave?.context?.status === 403,
    'another organization cannot write into it (403)',
    `got ${crossSave?.context?.status}`,
  );
  const { error: rpcLeak } = await b.client.rpc('save_invoice', {
    p_user: b.id,
    p_org: orgA,
    p_doc: {},
    p_totals: {},
  });
  check(!!rpcLeak, 'service-only functions are not callable by users');
  const { data: anonInvoices, error: anonErr } = await anon.from('invoices').select('id');
  check(!!anonErr || (anonInvoices ?? []).length === 0, 'anonymous visitors cannot read invoices');
  const { error: fnNoAuth } = await anon.functions.invoke('invoices', {
    body: { action: 'save', orgId: orgA, doc },
  });
  check(
    [401, 403].includes(fnNoAuth?.context?.status),
    'functions refuse requests without a signed-in user',
  );
} catch (err) {
  check(false, 'unexpected error', err?.message ?? String(err));
} finally {
  // Clean up: organizations first (cascades their data), then the users.
  for (const id of orgs.filter(Boolean)) await admin.from('organizations').delete().eq('id', id);
  for (const id of users) await admin.auth.admin.deleteUser(id);
  results.push(
    `· cleaned up ${orgs.filter(Boolean).length} organizations and ${users.length} users`,
  );
}

console.log(results.join('\n'));
process.exit(failures ? 1 : 0);
