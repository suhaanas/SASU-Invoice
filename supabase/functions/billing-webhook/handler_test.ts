import { paddleSignature, verifyPaddle } from '../_shared/billing.ts';
import { handle } from './handler.ts';

function assertEquals(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const SECRET = 'pdl_ntfset_test_secret';
const NOW = 1_800_000_000;
const ORG = '6f1c1e9a-3b8e-4c1f-9f39-2f6f8b1e7a10';

async function signed(body: string, ts = NOW): Promise<Request> {
  const h1 = await paddleSignature(SECRET, String(ts), body);
  return new Request('https://fn.test', {
    method: 'POST',
    headers: { 'Paddle-Signature': `ts=${ts};h1=${h1}` },
    body,
  });
}

const subscriptionEvent = JSON.stringify({
  event_id: 'evt_01',
  event_type: 'subscription.updated',
  occurred_at: '2026-10-24T10:00:00Z',
  data: {
    id: 'sub_01',
    status: 'active',
    customer_id: 'ctm_01',
    custom_data: { org_id: ORG },
    items: [{ price: { id: 'pri_pro' } }],
    current_billing_period: { ends_at: '2026-11-24T10:00:00Z' },
    scheduled_change: { action: 'cancel' },
  },
});

Deno.test('signature: valid, tampered, stale and missing', async () => {
  const h1 = await paddleSignature(SECRET, String(NOW), 'body');
  assertEquals(await verifyPaddle(SECRET, `ts=${NOW};h1=${h1}`, 'body', NOW), true, 'valid');
  assertEquals(await verifyPaddle(SECRET, `ts=${NOW};h1=${h1}`, 'body2', NOW), false, 'tampered');
  assertEquals(await verifyPaddle(SECRET, `ts=${NOW};h1=${h1}`, 'body', NOW + 301), false, 'stale');
  assertEquals(await verifyPaddle(SECRET, null, 'body', NOW), false, 'missing');
  assertEquals(
    await verifyPaddle(SECRET, `ts=${NOW};h1=bad;h1=${h1}`, 'body', NOW),
    true,
    'key rotation',
  );
});

Deno.test('subscription events are mapped to the database call', async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const res = await handle(await signed(subscriptionEvent), {
    secret: SECRET,
    nowSeconds: () => NOW,
    rpc: (name, args) => {
      if (name !== 'rf_rate_limit' && name !== 'rf_heartbeat') calls.push({ name, args });
      return Promise.resolve({ data: 'applied', error: null });
    },
  });
  assertEquals(res.status, 200, 'status');
  assertEquals(
    calls[0],
    {
      name: 'billing_apply_subscription_event',
      args: {
        p_provider: 'paddle',
        p_event_id: 'evt_01',
        p_event_type: 'subscription.updated',
        p_occurred_at: '2026-10-24T10:00:00Z',
        p_org: ORG,
        p_subscription_id: 'sub_01',
        p_customer_id: 'ctm_01',
        p_price_id: 'pri_pro',
        p_provider_status: 'active',
        p_period_end: '2026-11-24T10:00:00Z',
        p_cancel_at_period_end: true,
      },
    },
    'mapped',
  );
});

Deno.test('other events are recorded, and malformed org ids are dropped', async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const body = JSON.stringify({
    event_id: 'evt_02',
    event_type: 'transaction.completed',
    occurred_at: '2026-10-24T10:00:00Z',
    data: { id: 'txn_1', custom_data: { org_id: "x' or 1=1" } },
  });
  await handle(await signed(body), {
    secret: SECRET,
    nowSeconds: () => NOW,
    rpc: (name, args) => {
      if (name !== 'rf_rate_limit' && name !== 'rf_heartbeat') calls.push({ name, args });
      return Promise.resolve({ data: 'ignored', error: null });
    },
  });
  assertEquals([calls[0]!.name, calls[0]!.args.p_org], ['billing_record_event', null], 'recorded');
});

Deno.test('unsigned requests never reach the database', async () => {
  let called = false;
  const res = await handle(
    new Request('https://fn.test', { method: 'POST', body: subscriptionEvent }),
    {
      secret: SECRET,
      nowSeconds: () => NOW,
      rpc: () => {
        called = true;
        return Promise.resolve({ data: null, error: null });
      },
    },
  );
  assertEquals([res.status, called], [401, false], 'rejected');
});
