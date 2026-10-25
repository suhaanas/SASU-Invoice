/**
 * A small in-browser stand-in for the Supabase APIs the dashboard calls, so
 * signed-in screens can be exercised end to end without a backend. It serves
 * fixture rows for /rest/v1/<table> (with `col=eq.value` filtering, counts and
 * single-object responses), fixed answers for /rest/v1/rpc/<name>, and a
 * signed-in session. It is a rendering harness, not a security test: access
 * rules are covered by the SQL suite.
 */
import type { Page, Route } from '@playwright/test';

export const BASE = 'https://e2e-placeholder.supabase.co';
export const USER = 'aaaaaaaa-0000-4000-8000-000000000001';
export const ORG = 'bbbbbbbb-0000-4000-8000-000000000001';
export const CLIENT = 'cccccccc-0000-4000-8000-000000000001';
export const INVOICE = 'dddddddd-0000-4000-8000-000000000001';
const MEMBER = 'aaaaaaaa-0000-4000-8000-000000000002';
const RULE = 'eeeeeeee-0000-4000-8000-000000000001';

const org = {
  id: ORG,
  name: 'Studio North',
  country: 'GB',
  default_currency: 'GBP',
  timezone: 'Europe/London',
  onboarding_completed_at: '2026-10-01T09:00:00Z',
};
const allPerms = {
  record_payments: true,
  send_emails: true,
  manage_clients: true,
  view_reports: true,
};

const invoice = (n: number, patch: Record<string, unknown> = {}) => ({
  id: n === 1 ? INVOICE : `dddddddd-0000-4000-8000-00000000000${n}`,
  local_id: `ffffffff-0000-4000-8000-00000000000${n}`,
  doc_type: 'invoice',
  number: `INV-04${n}`,
  status: 'Unpaid',
  currency: 'GBP',
  issue_date: '2026-10-01',
  due_date: '2026-10-31',
  client_name: 'Acme Ltd',
  total_minor: 120000,
  paid_minor: 0,
  balance_minor: 120000,
  client_id: CLIENT,
  issued_at: '2026-10-01T09:00:00Z',
  updated_at: '2026-10-20T09:00:00Z',
  source: 'editor',
  revision: 3,
  document: {},
  ...patch,
});

const tables: Record<string, Record<string, unknown>[]> = {
  organization_members: [
    {
      org_id: ORG,
      user_id: USER,
      role: 'owner',
      created_at: '2026-10-01T09:00:00Z',
      permissions: allPerms,
      org,
      profile: { full_name: 'Olivia Owner', email: 'owner@studio.test' },
    },
    {
      org_id: ORG,
      user_id: MEMBER,
      role: 'member',
      created_at: '2026-10-05T09:00:00Z',
      permissions: { ...allPerms, send_emails: false },
      org,
      profile: { full_name: 'Max Member', email: 'max@studio.test' },
    },
  ],
  organization_settings: [
    {
      org_id: ORG,
      business: {
        name: 'Studio North',
        email: 'hello@studio.test',
        address: '1 High St\nLondon',
        phone: '',
        website: '',
        taxId: 'GB123',
      },
      invoice_prefix: 'INV-',
      tax_label: 'VAT',
      tax_rate: 20,
      payment_terms: 'Payment due within 30 days',
      payment_instructions: 'Bank transfer to 12-34-56 12345678',
      logo_path: null,
      email_from_name: '',
      email_reply_to: '',
      email_signature: 'Olivia, Studio North',
      reminders_enabled: true,
      reminder_send_hour: 9,
      reminders_weekdays_only: true,
    },
  ],
  invoices: [
    invoice(1, { paid_minor: 40000, balance_minor: 80000 }),
    invoice(2, { status: 'Paid', paid_minor: 120000, balance_minor: 0, due_date: '2026-11-15' }),
    invoice(3, {
      status: 'Draft',
      issued_at: null,
      total_minor: 50000,
      balance_minor: 50000,
      client_name: 'Beta Co',
    }),
  ],
  clients: [
    {
      id: CLIENT,
      name: 'Jane Smith',
      company: 'Acme Ltd',
      email: 'jane@acme.test',
      phone: '',
      address: '2 Market St',
      delivery_address: '',
      country: 'GB',
      tax_id: '',
      reg_number: '',
      preferred_currency: null,
      payment_terms_days: 30,
      notes: 'Prefers email.',
      archived_at: null,
      created_at: '2026-10-01T09:00:00Z',
      reminders_opted_out_at: null,
    },
  ],
  invoice_payments: [
    {
      id: '99999999-0000-4000-8000-000000000001',
      invoice_id: INVOICE,
      amount_minor: 40000,
      currency: 'GBP',
      paid_on: '2026-10-10',
      method: 'bank_transfer',
      reference: 'ACME-OCT',
      notes: '',
      source: 'manual',
      created_at: '2026-10-10T09:00:00Z',
      voided_at: null,
      void_reason: null,
      invoice: { number: 'INV-041', client_name: 'Acme Ltd', client_id: CLIENT },
    },
  ],
  subscriptions: [
    {
      org_id: ORG,
      plan_code: 'pro',
      status: 'active',
      trial_ends_at: null,
      current_period_end: '2026-11-25T00:00:00Z',
      cancel_at_period_end: false,
    },
  ],
  plans: [
    {
      code: 'free',
      name: 'Free',
      price_minor: 0,
      currency: 'USD',
      billing_interval: 'month',
      limits: { cloud_invoices: 0, users: 1, email_sends_per_month: 0, ai_requests_per_month: 0 },
    },
    {
      code: 'pro',
      name: 'Pro',
      price_minor: 1200,
      currency: 'USD',
      billing_interval: 'month',
      limits: {
        cloud_invoices: 100,
        users: 1,
        email_sends_per_month: 100,
        ai_requests_per_month: 100,
      },
    },
    {
      code: 'business',
      name: 'Business',
      price_minor: 2900,
      currency: 'USD',
      billing_interval: 'month',
      limits: {
        cloud_invoices: 500,
        users: 5,
        email_sends_per_month: 600,
        ai_requests_per_month: 600,
      },
    },
  ],
  usage_counters: [
    { metric: 'email_sends', used: 12 },
    { metric: 'ai_requests', used: 4 },
  ],
  reminder_rules: [-3, 0, 3, 7, 14].map((d, i) => ({
    id: `12121212-0000-4000-8000-00000000000${i}`,
    offset_days: d,
    kind: d < 0 ? 'due_soon' : d === 0 ? 'due_today' : d <= 3 ? 'overdue' : 'follow_up',
    tone: d >= 14 ? 'firm' : d > 0 ? 'professional' : 'friendly',
    is_active: true,
  })),
  email_templates: [],
  email_messages: [
    {
      id: '34343434-0000-4000-8000-000000000001',
      invoice_id: INVOICE,
      client_id: CLIENT,
      reminder_job_id: null,
      kind: 'new_invoice',
      to_email: 'jane@acme.test',
      subject: 'Invoice INV-041 from Studio North',
      body_text: 'Hello Jane, …',
      status: 'delivered',
      error: null,
      created_at: '2026-10-01T09:05:00Z',
      accepted_at: '2026-10-01T09:05:01Z',
      delivered_at: '2026-10-01T09:05:04Z',
      invoice: { number: 'INV-041' },
    },
  ],
  reminder_jobs: [
    {
      id: '56565656-0000-4000-8000-000000000001',
      invoice_id: INVOICE,
      offset_days: -3,
      kind: 'due_soon',
      status: 'sent',
      attempts: 1,
      last_error: null,
      cancel_reason: null,
      scheduled_for: '2026-10-28T09:00:00Z',
      next_attempt_at: '2026-10-28T09:00:00Z',
      invoice: { number: 'INV-041', client_name: 'Acme Ltd' },
    },
  ],
  email_suppressions: [],
  invoice_shares: [],
  audit_logs: [
    {
      id: 1,
      action: 'invoice.issued',
      metadata: { number: 'INV-041' },
      created_at: '2026-10-01T09:00:00Z',
      actor_id: USER,
    },
    {
      id: 2,
      action: 'payment.recorded',
      metadata: {},
      created_at: '2026-10-10T09:00:00Z',
      actor_id: USER,
    },
  ],
  recurring_rules: [
    {
      id: RULE,
      template_invoice_id: INVOICE,
      client_id: CLIENT,
      name: 'Monthly retainer',
      unit: 'month',
      every: 1,
      start_date: '2026-10-01',
      end_date: null,
      occurrence: 1,
      next_run_date: '2026-11-01',
      mode: 'issue',
      send_email: true,
      status: 'active',
      runs_count: 1,
      last_run_at: '2026-10-01T09:00:00Z',
      last_error: null,
      template: {
        number: 'INV-041',
        client_name: 'Acme Ltd',
        total_minor: 120000,
        currency: 'GBP',
      },
    },
  ],
  recurring_runs: [
    {
      id: '78787878-0000-4000-8000-000000000001',
      rule_id: RULE,
      run_date: '2026-10-01',
      invoice_id: INVOICE,
      email_message_id: null,
      invoice: { number: 'INV-041', status: 'Unpaid' },
    },
  ],
  profiles: [{ id: USER, full_name: 'Olivia Owner', email: 'owner@studio.test' }],
  account_deletion_requests: [],
  organization_invitations: [],
  feature_flags: [
    {
      key: 'ai_assistant',
      enabled: false,
      description: 'RecoverFlow AI drafting and analysis',
      updated_at: '2026-10-01T09:00:00Z',
    },
    {
      key: 'automatic_reminders',
      enabled: true,
      description: 'Automatic reminder emails (scheduler)',
      updated_at: '2026-10-01T09:00:00Z',
    },
  ],
};

const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

const rpcs: Record<string, unknown> = {
  org_currencies: [{ currency: 'GBP', invoices: 3 }],
  dashboard_summary: {
    currency: 'GBP',
    today: '2026-10-25',
    invoicedMinor: 240000,
    paidMinor: 160000,
    outstandingMinor: 80000,
    outstandingCount: 1,
    overdueMinor: 0,
    overdueCount: 0,
    partialMinor: 80000,
    partialCount: 1,
    dueWeekMinor: 80000,
    dueWeekCount: 1,
    paymentsMonthMinor: 40000,
    monthly: months.map((m, i) => ({
      month: m,
      invoicedMinor: i * 30000,
      receivedMinor: i * 20000,
    })),
    aging: { current: 80000, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
    statusCounts: { paid: 1, partial: 1, unpaid: 0, overdue: 0 },
  },
  client_balances: [
    {
      client_id: CLIENT,
      currency: 'GBP',
      invoiced_minor: 240000,
      paid_minor: 160000,
      outstanding_minor: 80000,
      overdue_minor: 0,
      invoice_count: 2,
      last_issue_date: '2026-10-01',
    },
  ],
  invoice_reminder_status: { blockReason: null, paused: false, disputed: false, disputeNote: '' },
  plan_change_check: [],
  is_platform_admin: true,
  report_summary: {
    currency: 'GBP',
    from: '2026-01-01',
    to: '2026-10-25',
    invoicedMinor: 240000,
    invoiceCount: 2,
    creditedMinor: 0,
    receivedMinor: 160000,
    paymentCount: 2,
    outstandingMinor: 80000,
    overdueMinor: 0,
    monthly: months.map((m, i) => ({
      month: m,
      invoicedMinor: i * 30000,
      creditedMinor: 0,
      receivedMinor: i * 20000,
    })),
    topClients: [
      {
        clientId: CLIENT,
        name: 'Acme Ltd',
        invoicedMinor: 240000,
        outstandingMinor: 80000,
        count: 2,
      },
    ],
    statusCounts: { paid: 1, partial: 1, unpaid: 0 },
    emails: { manual: 1, automatic: 1, delivered: 1, problems: 0 },
    recurring: { active: 1, generated: 1, upcoming30: 1 },
  },
  admin_overview: {
    organizations: 42,
    organizations30d: 9,
    users: 61,
    plans: { free: 30, pro: 10, business: 2 },
    subscriptionStatus: { active: 12, trialing: 30 },
    mrr: { USD: 17800 },
    scheduler: { scheduler: { lastRunAt: '2026-10-25T09:55:00Z', stale: false, summary: {} } },
    health: {
      reminderJobsFailed7d: 0,
      reminderJobsStuck: 0,
      emailProblems7d: 2,
      recurringErrors: 0,
      billingErrors7d: 0,
      aiErrors7d: 0,
    },
    recentBillingErrors: [],
  },
  admin_organizations: [
    {
      id: ORG,
      name: 'Studio North',
      country: 'GB',
      created_at: '2026-10-01T09:00:00Z',
      plan: 'pro',
      status: 'active',
      members: 2,
      documents: 3,
      reminders_enabled: true,
    },
  ],
};

/** Apply `col=eq.value` / `col=is.null` filters PostgREST-style (enough for these screens). */
function filterRows(
  rows: Record<string, unknown>[],
  params: URLSearchParams,
): Record<string, unknown>[] {
  let out = rows;
  for (const [key, value] of params) {
    if (['select', 'order', 'limit', 'offset', 'or'].includes(key)) continue;
    const m = /^(eq|is)\.(.*)$/.exec(value);
    if (!m) continue;
    out = out.filter((r) => {
      const v = key.includes('.') ? undefined : r[key];
      if (v === undefined) return true;
      return m[1] === 'is' ? (m[2] === 'null' ? v === null : true) : String(v) === m[2];
    });
  }
  return out;
}

// Real Supabase sends these; without expose-headers the browser hides
// Content-Range from scripts and every count reads as 0.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': 'content-range, content-profile',
};

async function handle(route: Route): Promise<void> {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
  const url = new URL(req.url());
  const path = url.pathname;

  if (path.startsWith('/auth/v1/')) {
    if (path.endsWith('/user')) return route.fulfill({ json: session().user });
    if (path.endsWith('/logout')) return route.fulfill({ status: 204, body: '' });
    return route.fulfill({ json: session() });
  }
  if (path.startsWith('/storage/v1/')) return route.fulfill({ json: { signedURL: null } });
  if (path.startsWith('/functions/v1/'))
    return route.fulfill({ status: 503, json: { error: 'Not available in tests' } });

  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(path);
  if (rpc) {
    const name = rpc[1]!;
    return name in rpcs
      ? route.fulfill({ json: rpcs[name] })
      : route.fulfill({ status: 404, json: { message: `rpc ${name} not mocked` } });
  }

  const table = /^\/rest\/v1\/(\w+)$/.exec(path)?.[1];
  if (!table) return route.fulfill({ status: 404, json: { message: 'not mocked' } });
  if (req.method() !== 'GET' && req.method() !== 'HEAD')
    return route.fulfill({ status: 201, json: [] });
  const rows = filterRows(tables[table] ?? [], url.searchParams);
  const headers = {
    ...CORS,
    'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : `*/0`,
  };
  if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers, body: '' });
  if ((req.headers()['accept'] ?? '').includes('vnd.pgrst.object')) {
    return rows[0]
      ? route.fulfill({ headers, json: rows[0] })
      : route.fulfill({ status: 406, json: { code: 'PGRST116', message: 'no rows' } });
  }
  return route.fulfill({ headers, json: rows });
}

function session() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return {
    access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER, exp, role: 'authenticated', aud: 'authenticated' })}.sig`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: 'e2e-refresh',
    user: {
      id: USER,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'owner@studio.test',
      app_metadata: { provider: 'email' },
      user_metadata: { full_name: 'Olivia Owner' },
      created_at: '2026-10-01T09:00:00Z',
    },
  };
}

/** Sign in as the owner of "Studio North" and mock every backend call. */
export async function signedInOwner(page: Page): Promise<void> {
  await page.route(`${BASE}/**`, handle);
  await page.addInitScript((value) => {
    localStorage.setItem('sb-e2e-placeholder-auth-token', value);
  }, JSON.stringify(session()));
}
