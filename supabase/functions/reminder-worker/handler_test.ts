import type { EmailProvider, OutgoingEmail, SendResult } from '../_shared/email.ts';
import { createInvoice } from '../_shared/core/state.ts';
import { handle, type Deps } from './handler.ts';

function assertEquals(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const prepared = (id: string, extra: Record<string, unknown> = {}) => ({
  skip: false,
  messageId: `msg-${id}`,
  idempotencyKey: `reminder:${id}`,
  to: 'client@x.test',
  kind: 'overdue',
  tone: 'firm',
  template: null,
  shareToken: 'b'.repeat(64),
  fromName: 'Acme',
  replyTo: 'owner@acme.test',
  signature: 'Acme Ltd',
  businessName: 'Acme',
  clientName: 'Jane',
  invoiceNumber: 'INV-7',
  currency: 'GBP',
  locale: 'en-GB',
  amountDueMinor: 5000,
  totalMinor: 10000,
  dueDate: '2026-10-01',
  daysOverdue: 3,
  ...extra,
});

function setup(
  results: SendResult[],
  prep: Record<string, unknown>,
  flags = { reminders: true, recurring: true },
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const sent: OutgoingEmail[] = [];
  const provider: EmailProvider = {
    name: 'fake',
    configured: true,
    send: (e) => {
      sent.push(e);
      return Promise.resolve(results.shift()!);
    },
  };
  const deps: Deps = {
    secret: 's3cret',
    appUrl: 'https://app.test',
    fromAddress: 'invoices@mail.test',
    provider,
    rpc: (name, args) => {
      calls.push({ name, args });
      if (name === 'rf_scheduler_flags') return Promise.resolve({ data: flags, error: null });
      if (name === 'rf_claim_recurring') return Promise.resolve({ data: [], error: null });
      if (name === 'rf_enqueue_due_reminders') return Promise.resolve({ data: 2, error: null });
      if (name === 'rf_claim_jobs')
        return Promise.resolve({ data: Object.keys(prep).map((id) => ({ id })), error: null });
      if (name === 'rf_prepare_reminder')
        return Promise.resolve({ data: prep[args.p_job as string], error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { deps, calls, sent };
}

const req = (secret = 's3cret') =>
  new Request('https://fn.test', { method: 'POST', headers: { 'x-worker-secret': secret } });

Deno.test('rejects calls without the worker secret', async () => {
  const { deps, calls } = setup([], {});
  assertEquals((await handle(req('wrong'), deps)).status, 401, 'status');
  assertEquals(calls.length, 0, 'no db calls');
});

Deno.test('does not claim reminder jobs when email is not configured', async () => {
  const { deps, calls } = setup([], { a: prepared('a') });
  deps.provider = { name: 'none', configured: false, send: () => Promise.reject() };
  const res = await handle(req(), deps);
  assertEquals((await res.json()).notes, ['email provider not configured'], 'explained');
  assertEquals(
    calls.some((c) => c.name === 'rf_claim_jobs'),
    false,
    'nothing claimed',
  );
  assertEquals(
    calls.some((c) => c.name === 'rf_claim_recurring'),
    true,
    'recurring still runs',
  );
});

Deno.test('the admin kill switches stop each step', async () => {
  const { deps, calls } = setup([], { a: prepared('a') }, { reminders: false, recurring: false });
  await handle(req(), deps);
  assertEquals(
    calls.map((c) => c.name),
    ['rf_scheduler_flags'],
    'only the flags were read',
  );
});

Deno.test('sends, records acceptance, and passes failures back for retry', async () => {
  const { deps, calls, sent } = setup(
    [
      { ok: true, providerMessageId: 're_1' },
      { ok: false, error: 'Resend 503', permanent: false },
    ],
    { a: prepared('a'), b: prepared('b'), c: { skip: true, reason: 'paid' } },
  );
  const res = await handle(req(), deps);
  const summary = await res.json();
  assertEquals(
    summary.reminders,
    { queued: 2, claimed: 3, sent: 1, skipped: 1, failed: 1 },
    'summary',
  );
  assertEquals(
    sent.map((e) => e.idempotencyKey),
    ['reminder:a', 'reminder:b'],
    'idempotency keys',
  );
  const accepted = calls.find((c) => c.name === 'rf_mark_accepted')!;
  assertEquals(accepted.args.p_provider_message_id, 're_1', 'provider id');
  const failed = calls.find((c) => c.name === 'rf_mark_failed')!;
  assertEquals(
    [failed.args.p_message, failed.args.p_permanent],
    ['msg-b', false],
    'transient failure',
  );
});

Deno.test('renders the default template with the client link and no raw placeholders', async () => {
  const { deps, sent } = setup([{ ok: true, providerMessageId: 're_1' }], { a: prepared('a') });
  await handle(req(), deps);
  const e = sent[0]!;
  assertEquals(e.text.includes(`https://app.test/invoice.html#t=${'b'.repeat(64)}`), true, 'link');
  assertEquals(e.text.includes('{{'), false, 'placeholders filled');
  assertEquals(e.subject, 'Invoice INV-7 is now overdue', 'subject');
  assertEquals(e.htmlBody.includes('<script'), false, 'html is escaped text');
});

Deno.test('uses the organization’s own template when it has one', async () => {
  const { deps, sent } = setup([{ ok: true, providerMessageId: 're_1' }], {
    a: prepared('a', {
      template: {
        subject: 'Custom {{invoice_number}}',
        body: 'Hi <b>{{client_name}}</b> {{link}}',
      },
    }),
  });
  await handle(req(), deps);
  assertEquals(sent[0]!.subject, 'Custom INV-7', 'subject');
  assertEquals(
    sent[0]!.htmlBody.includes('&lt;b&gt;Jane&lt;/b&gt;'),
    true,
    'user text is escaped in html',
  );
});

Deno.test(
  'recurring: builds the run from the template, saves it and emails the client once',
  async () => {
    const template = createInvoice();
    template.items = [{ ...template.items[0]!, desc: 'Retainer', qty: 1, rate: 500 }];
    template.meta.issueDate = '2026-09-01';
    template.meta.dueTerm = 'net30';
    template.meta.issuedAt = 1;
    template.totals.amountPaid = 500;
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const sent: OutgoingEmail[] = [];
    const deps: Deps = {
      secret: 's3cret',
      appUrl: 'https://app.test',
      fromAddress: 'invoices@mail.test',
      now: () => 1_800_000_000_000,
      provider: {
        name: 'fake',
        configured: true,
        send: (e) => {
          sent.push(e);
          return Promise.resolve({ ok: true, providerMessageId: 're_r' });
        },
      },
      rpc: (name, args) => {
        calls.push({ name, args });
        switch (name) {
          case 'rf_scheduler_flags':
            return Promise.resolve({ data: { reminders: false, recurring: true }, error: null });
          case 'rf_claim_recurring':
            return Promise.resolve({
              data: [{ ruleId: 'rule-1', runDate: '2026-11-01', mode: 'issue', template }],
              error: null,
            });
          case 'rf_complete_recurring':
            return Promise.resolve({
              data: {
                runId: '11111111-2222-3333-4444-555555555555',
                invoiceId: 'inv-9',
                userId: 'user-1',
                sendEmail: true,
                to: 'ap@client.test',
                template: null,
              },
              error: null,
            });
          case 'rf_prepare_manual_email':
            return Promise.resolve({
              data: { ...prepared('x'), duplicate: false, messageId: 'msg-r' },
              error: null,
            });
          default:
            return Promise.resolve({ data: null, error: null });
        }
      },
    };
    const res = await handle(req(), deps);
    assertEquals(
      (await res.json()).recurring,
      { claimed: 1, created: 1, emailed: 1, failed: 0 },
      'summary',
    );
    const complete = calls.find((c) => c.name === 'rf_complete_recurring')!;
    const doc = complete.args.p_doc as {
      meta: Record<string, unknown>;
      totals: { amountPaid: number };
    };
    assertEquals(
      [
        doc.meta.issueDate,
        doc.meta.dueDate,
        doc.meta.status,
        doc.meta.number,
        doc.totals.amountPaid,
      ],
      ['2026-11-01', '2026-12-01', 'Unpaid', 'PENDING', 0],
      'document dated for the run, nothing paid',
    );
    assertEquals(
      (complete.args.p_totals as { total: number }).total,
      50000,
      'totals computed on the server',
    );
    assertEquals(
      sent[0]!.idempotencyKey,
      'manual:11111111-2222-3333-4444-555555555555',
      'one email per run',
    );
    assertEquals(calls.at(-1)!.name, 'rf_link_recurring_email', 'email linked to the run');
  },
);
