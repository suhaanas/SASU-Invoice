import type { EmailProvider, OutgoingEmail, SendResult } from '../_shared/email.ts';
import { handle, type Deps } from './handler.ts';

function assertEquals(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const INVOICE = '6f1c1e9a-3b8e-4c1f-9f39-2f6f8b1e7a10';
const REQUEST = '11111111-2222-3333-4444-555555555555';

const ctx = {
  duplicate: false,
  messageId: 'msg-1',
  shareToken: 'c'.repeat(64),
  fromName: 'Acme',
  replyTo: null,
  signature: 'Acme',
  businessName: 'Acme',
  clientName: 'Jane',
  invoiceNumber: 'INV-9',
  currency: 'USD',
  locale: 'en-US',
  amountDueMinor: 2500,
  totalMinor: 2500,
  dueDate: '2026-11-01',
  daysOverdue: 0,
};

function setup(result: SendResult, prepData: unknown = ctx, configured = true) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const sent: OutgoingEmail[] = [];
  const provider: EmailProvider = {
    name: 'fake',
    configured,
    send: (e) => {
      sent.push(e);
      return Promise.resolve(result);
    },
  };
  const deps: Deps = {
    allowedOrigins: ['https://app.test'],
    appUrl: 'https://app.test',
    fromAddress: 'invoices@mail.test',
    provider,
    userFromToken: (t) => Promise.resolve(t === 'good' ? 'user-1' : null),
    rpc: (name, args) => {
      calls.push({ name, args });
      return Promise.resolve({
        data: name === 'rf_prepare_manual_email' ? prepData : null,
        error: null,
      });
    },
  };
  return { deps, calls, sent };
}

const post = (body: unknown, token = 'good') =>
  new Request('https://fn.test', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Origin: 'https://app.test' },
    body: JSON.stringify(body),
  });

const valid = {
  invoiceId: INVOICE,
  kind: 'new_invoice',
  to: 'ap@client.test',
  subject: 'Invoice {{invoice_number}}',
  body: 'Hello {{client_name}}, here it is.',
  requestId: REQUEST,
};

Deno.test('requires a session', async () => {
  const { deps } = setup({ ok: true, providerMessageId: 'x' });
  assertEquals((await handle(post(valid, 'bad'), deps)).status, 401, 'status');
});

Deno.test('rejects unknown placeholders before touching the database', async () => {
  const { deps, calls } = setup({ ok: true, providerMessageId: 'x' });
  const res = await handle(post({ ...valid, body: 'Hi {{password}}' }), deps);
  assertEquals(res.status, 422, 'status');
  assertEquals(calls.length, 0, 'no rpc');
});

Deno.test('sends with the request id as idempotency key and always includes the link', async () => {
  const { deps, calls, sent } = setup({ ok: true, providerMessageId: 're_9' });
  const res = await handle(post(valid), deps);
  assertEquals(res.status, 200, 'status');
  assertEquals(sent[0]!.idempotencyKey, `manual:${REQUEST}`, 'idempotency');
  assertEquals(sent[0]!.subject, 'Invoice INV-9', 'subject filled');
  assertEquals(sent[0]!.text.includes(`#t=${'c'.repeat(64)}`), true, 'link appended');
  assertEquals(calls.at(-1)!.name, 'rf_mark_accepted', 'recorded');
  assertEquals(calls[0]!.args.p_user, 'user-1', 'user from token');
});

Deno.test('a repeated request returns the first result without sending again', async () => {
  const { deps, sent } = setup(
    { ok: true, providerMessageId: 'x' },
    { duplicate: true, messageId: 'msg-1', status: 'accepted' },
  );
  const res = await handle(post(valid), deps);
  assertEquals(
    await res.json(),
    { messageId: 'msg-1', status: 'accepted', duplicate: true },
    'duplicate',
  );
  assertEquals(sent.length, 0, 'not sent');
});

Deno.test('a provider failure is recorded and reported', async () => {
  const { deps, calls } = setup({ ok: false, error: 'Resend 422: invalid', permanent: true });
  const res = await handle(post(valid), deps);
  assertEquals(res.status, 502, 'status');
  assertEquals(calls.at(-1)!.name, 'rf_mark_failed', 'recorded failure');
});

Deno.test('without a configured provider it says so plainly', async () => {
  const { deps } = setup(
    { ok: false, error: 'Email sending is not set up yet.', permanent: true },
    ctx,
    false,
  );
  const res = await handle(post(valid), deps);
  assertEquals(res.status, 503, 'status');
  assertEquals((await res.json()).error, 'Email sending is not set up yet.', 'message');
});
