import { createInvoice } from '../_shared/core/state.ts';
import { handle, type Deps } from './handler.ts';

const ORG = '6f1c1e9a-3b8e-4c1f-9f39-2f6f8b1e7a10';

function assertEquals(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function deps(
  calls: { name: string; args: Record<string, unknown> }[],
  rpcResult: unknown = { revision: 1 },
): Deps {
  return {
    allowedOrigins: ['https://app.test'],
    userFromToken: (token) => Promise.resolve(token === 'good' ? 'user-1' : null),
    rpc: (name, args) => {
      if (name !== 'rf_rate_limit' && name !== 'rf_heartbeat') calls.push({ name, args });
      return Promise.resolve({ data: rpcResult, error: null });
    },
  };
}

function post(body: unknown, token = 'good'): Request {
  return new Request('https://fn.test/invoices', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: 'https://app.test',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function invoice() {
  const doc = createInvoice();
  doc.items = [{ ...doc.items[0]!, qty: 3, rate: 19.99 }];
  doc.totals.taxRate = 20;
  doc.totals.amountPaid = 10;
  return doc;
}

Deno.test('rejects requests without a valid session', async () => {
  const res = await handle(post({ action: 'save', orgId: ORG, doc: invoice() }, 'bad'), deps([]));
  assertEquals(res.status, 401, 'status');
});

Deno.test('recomputes totals on the server and ignores anything the client claims', async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const res = await handle(
    post({ action: 'save', orgId: ORG, doc: invoice(), p_totals: { total: 1 } }),
    deps(calls),
  );
  assertEquals(res.status, 200, 'status');
  assertEquals(calls[0]?.name, 'save_invoice', 'rpc');
  // 3 × 19.99 = 59.97; +20% tax = 11.994 → 11.99; total 71.96; paid 10.
  assertEquals(
    calls[0]?.args.p_totals,
    { subtotal: 5997, discount: 0, tax: 1199, shipping: 0, total: 7196, paid: 1000, balance: 6196 },
    'totals',
  );
  assertEquals(calls[0]?.args.p_user, 'user-1', 'user comes from the token, never the body');
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://app.test', 'cors');
});

Deno.test('rejects invalid documents before touching the database', async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const doc = { ...invoice(), meta: { ...invoice().meta, currency: 'XXX' } };
  const res = await handle(post({ action: 'save', orgId: ORG, doc }), deps(calls));
  assertEquals(res.status, 422, 'status');
  assertEquals(calls.length, 0, 'no rpc');
});

Deno.test('rejects non-UUID organization ids', async () => {
  const res = await handle(post({ action: 'save', orgId: '1 or 1=1', doc: invoice() }), deps([]));
  assertEquals(res.status, 400, 'status');
});

Deno.test('import reports invalid rows and sends only valid ones', async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const good = invoice();
  const res = await handle(
    post({ action: 'import', orgId: ORG, docs: [good, { id: 'legacy', junk: true }] }),
    deps(calls, [{ localId: good.id, result: 'imported' }]),
  );
  const body = await res.json();
  assertEquals(res.status, 200, 'status');
  assertEquals((calls[0]?.args.p_items as unknown[]).length, 1, 'only valid rows sent');
  assertEquals(
    body.results.map((r: { result: string }) => r.result),
    ['failed', 'imported'],
    'per-row results',
  );
});

Deno.test('maps SQL business errors to HTTP statuses without leaking internals', async () => {
  const d = deps([]);
  d.rpc = () =>
    Promise.resolve({
      data: null,
      error: { code: 'SA423', message: 'This document is issued and locked' },
    });
  const locked = await handle(post({ action: 'save', orgId: ORG, doc: invoice() }), d);
  assertEquals(locked.status, 423, 'locked');
  d.rpc = () =>
    Promise.resolve({ data: null, error: { code: 'XX000', message: 'internal detail' } });
  const crash = await handle(post({ action: 'save', orgId: ORG, doc: invoice() }), d);
  assertEquals(crash.status, 500, 'internal');
  assertEquals((await crash.json()).error.includes('internal detail'), false, 'no leak');
});

Deno.test('CORS is not granted to unknown origins', async () => {
  const req = new Request('https://fn.test/invoices', {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.test' },
  });
  const res = await handle(req, deps([]));
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), null, 'no cors');
});
