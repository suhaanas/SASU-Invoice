import { PaddleProvider, type BillingProvider } from '../_shared/billing.ts';
import { handle, type Deps } from './handler.ts';

function assertEquals(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const ORG = '6f1c1e9a-3b8e-4c1f-9f39-2f6f8b1e7a10';

function fakeBilling(log: string[]): BillingProvider {
  return {
    name: 'paddle',
    configured: true,
    createCheckout: (i) => {
      log.push(`checkout:${i.priceId}:${i.orgId}`);
      return Promise.resolve({ url: 'https://pay.test/?_ptxn=txn_1' });
    },
    changePlan: (s, p) => {
      log.push(`change:${s}:${p}`);
      return Promise.resolve();
    },
    cancelAtPeriodEnd: (s) => {
      log.push(`cancel:${s}`);
      return Promise.resolve();
    },
    resume: (s) => {
      log.push(`resume:${s}`);
      return Promise.resolve();
    },
    portalUrl: () => Promise.resolve('https://portal.test'),
    listInvoices: () => Promise.resolve([]),
    invoicePdfUrl: () => Promise.resolve('https://pdf.test'),
  };
}

function setup(
  prepare: unknown,
  sub: unknown = null,
  prepareError: { code: string; message: string } | null = null,
) {
  const log: string[] = [];
  const deps: Deps = {
    allowedOrigins: [],
    billing: fakeBilling(log),
    userFromToken: (t) => Promise.resolve(t === 'good' ? 'user-1' : null),
    rpc: (name) => {
      if (name === 'billing_prepare')
        return Promise.resolve({ data: prepare, error: prepareError });
      return Promise.resolve({ data: sub, error: null });
    },
  };
  return { deps, log };
}

const post = (body: unknown, token = 'good') =>
  new Request('https://fn.test', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

Deno.test('a first purchase returns a checkout url and tags it with the organization', async () => {
  const { deps, log } = setup({ priceId: 'pri_pro', customerId: null, subscriptionId: null });
  const res = await handle(post({ action: 'select_plan', orgId: ORG, plan: 'pro' }), deps);
  assertEquals(await res.json(), { checkoutUrl: 'https://pay.test/?_ptxn=txn_1' }, 'body');
  assertEquals(log, [`checkout:pri_pro:${ORG}`], 'provider call');
});

Deno.test('an existing subscription is changed in place (no second subscription)', async () => {
  const { deps, log } = setup({
    priceId: 'pri_business',
    customerId: 'ctm_1',
    subscriptionId: 'sub_1',
  });
  const res = await handle(post({ action: 'select_plan', orgId: ORG, plan: 'business' }), deps);
  assertEquals(await res.json(), { changed: true }, 'body');
  assertEquals(log, ['change:sub_1:pri_business'], 'provider call');
});

Deno.test('database refusals (not owner, over limits) are passed through', async () => {
  const { deps, log } = setup(null, null, {
    code: 'SA409',
    message: 'You have 3 team members; Pro allows 1.',
  });
  const res = await handle(post({ action: 'select_plan', orgId: ORG, plan: 'pro' }), deps);
  assertEquals(res.status, 409, 'status');
  assertEquals((await res.json()).error, 'You have 3 team members; Pro allows 1.', 'message');
  assertEquals(log.length, 0, 'provider not called');
});

Deno.test('cancel needs a paid subscription and cancels at period end', async () => {
  const none = setup(null, {
    provider: null,
    customerId: null,
    subscriptionId: null,
    status: 'trialing',
  });
  assertEquals(
    (await handle(post({ action: 'cancel', orgId: ORG }), none.deps)).status,
    409,
    'no subscription',
  );
  const paid = setup(null, {
    provider: 'paddle',
    customerId: 'ctm_1',
    subscriptionId: 'sub_1',
    status: 'active',
  });
  assertEquals(
    (await handle(post({ action: 'cancel', orgId: ORG }), paid.deps)).status,
    200,
    'cancelled',
  );
  assertEquals(paid.log, ['cancel:sub_1'], 'provider call');
});

Deno.test('requires a session and validates invoice ids', async () => {
  const { deps } = setup(null);
  assertEquals(
    (await handle(post({ action: 'portal', orgId: ORG }, 'bad'), deps)).status,
    401,
    'auth',
  );
  assertEquals(
    (await handle(post({ action: 'invoice_pdf', orgId: ORG, invoiceId: '../x' }), deps)).status,
    400,
    'id',
  );
});

Deno.test('paddle: checkout, change and cancel requests are well formed', async () => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const paddle = new PaddleProvider('pdl_key', 'sandbox', ((url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method!,
      body: init.body ? JSON.parse(init.body as string) : null,
    });
    const data = url.endsWith('/transactions')
      ? { checkout: { url: 'https://pay.test/?_ptxn=txn_9' } }
      : {};
    return Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }));
  }) as typeof fetch);
  assertEquals(
    (await paddle.createCheckout({ priceId: 'pri_1', orgId: ORG, customerId: null })).url,
    'https://pay.test/?_ptxn=txn_9',
    'checkout url',
  );
  await paddle.changePlan('sub_1', 'pri_2');
  await paddle.cancelAtPeriodEnd('sub_1');
  assertEquals(
    calls[0],
    {
      url: 'https://sandbox-api.paddle.com/transactions',
      method: 'POST',
      body: {
        items: [{ price_id: 'pri_1', quantity: 1 }],
        custom_data: { org_id: ORG },
        collection_mode: 'automatic',
      },
    },
    'transaction',
  );
  assertEquals(
    [calls[1]!.method, calls[1]!.url],
    ['PATCH', 'https://sandbox-api.paddle.com/subscriptions/sub_1'],
    'change',
  );
  assertEquals(calls[2]!.body, { effective_from: 'next_billing_period' }, 'cancel at period end');
});

Deno.test('paddle: invoices of another customer are refused', async () => {
  const paddle = new PaddleProvider('k', 'live', ((url: string) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: url.endsWith('/invoice') ? { url: 'x' } : { customer_id: 'ctm_other' },
        }),
        { status: 200 },
      ),
    )) as typeof fetch);
  let status = 0;
  try {
    await paddle.invoicePdfUrl('ctm_mine', 'txn_0123456789ab');
  } catch (err) {
    status = (err as { status: number }).status;
  }
  assertEquals(status, 404, 'refused');
});

Deno.test('paddle: a missing default payment link reads as "checkout not open yet"', async () => {
  const paddle = new PaddleProvider('k', 'live', (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ error: { code: 'transaction_default_checkout_url_not_set' } }),
        { status: 400 },
      ),
    )) as typeof fetch);
  let error: { status: number; message: string } | null = null;
  try {
    await paddle.createCheckout({ priceId: 'pri_1', orgId: 'org', customerId: null });
  } catch (err) {
    error = err as { status: number; message: string };
  }
  assertEquals(error?.status, 503, 'service unavailable');
  assertEquals(error?.message, 'Checkout isn’t open yet. Please try again later.', 'clear message');
});
