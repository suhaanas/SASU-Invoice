import type { EmailProvider, OutgoingEmail, SendResult } from '../_shared/email.ts';
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

function setup(results: SendResult[], prep: Record<string, unknown>) {
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

Deno.test('does not claim jobs when email is not configured', async () => {
  const { deps, calls } = setup([], { a: prepared('a') });
  deps.provider = { name: 'none', configured: false, send: () => Promise.reject() };
  assertEquals((await handle(req(), deps)).status, 503, 'status');
  assertEquals(calls.length, 0, 'nothing claimed');
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
  assertEquals(summary, { queued: 2, claimed: 3, sent: 1, skipped: 1, failed: 1 }, 'summary');
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
