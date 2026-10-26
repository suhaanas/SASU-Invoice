import { svixSignature } from '../_shared/webhook.ts';
import { handle } from './handler.ts';

function assertEquals(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const SECRET = 'whsec_' + btoa('webhook-secret-for-tests-123456');
const NOW = 1_800_000_000;

async function signed(body: string): Promise<Request> {
  const sig = await svixSignature(SECRET, 'evt_1', String(NOW), body);
  return new Request('https://fn.test', {
    method: 'POST',
    headers: { 'svix-id': 'evt_1', 'svix-timestamp': String(NOW), 'svix-signature': `v1,${sig}` },
    body,
  });
}

Deno.test('applies signed delivery events with the provider event id', async () => {
  const calls: Record<string, unknown>[] = [];
  const body = JSON.stringify({
    type: 'email.bounced',
    created_at: '2026-10-24T10:00:00.000Z',
    data: { email_id: 're_1', bounce: { message: 'Mailbox full' } },
  });
  const res = await handle(await signed(body), {
    secret: SECRET,
    nowSeconds: () => NOW,
    rpc: (_n, args) => {
      calls.push(args);
      return Promise.resolve({ data: true, error: null });
    },
  });
  assertEquals(res.status, 200, 'status');
  assertEquals(
    calls[0],
    {
      p_event_id: 'evt_1',
      p_provider_message_id: 're_1',
      p_type: 'email.bounced',
      p_occurred_at: '2026-10-24T10:00:00.000Z',
      p_detail: 'Mailbox full',
    },
    'rpc args',
  );
});

Deno.test('rejects unsigned requests without touching the database', async () => {
  let called = false;
  const res = await handle(new Request('https://fn.test', { method: 'POST', body: '{}' }), {
    secret: SECRET,
    nowSeconds: () => NOW,
    rpc: () => {
      called = true;
      return Promise.resolve({ data: null, error: null });
    },
  });
  assertEquals([res.status, called], [401, false], 'rejected');
});

Deno.test('asks the provider to retry when the database fails', async () => {
  const body = JSON.stringify({
    type: 'email.delivered',
    created_at: '2026-10-24T10:00:00Z',
    data: { email_id: 're_1' },
  });
  const res = await handle(await signed(body), {
    secret: SECRET,
    nowSeconds: () => NOW,
    rpc: () => Promise.resolve({ data: null, error: { code: 'XX000', message: 'down' } }),
  });
  assertEquals(res.status, 500, 'status');
});
