import { redact } from './ai.ts';
import { fromHeader, ResendProvider, templateVars, type OutgoingEmail } from './email.ts';
import { safeEqual, svixSignature, verifySvix } from './webhook.ts';
import { readJson } from './http.ts';

function assertEquals(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const SECRET = 'whsec_' + btoa('super-secret-signing-key-0123456789');

async function signedHeaders(body: string, ts: number, id = 'msg_1'): Promise<Headers> {
  const sig = await svixSignature(SECRET, id, String(ts), body);
  return new Headers({
    'svix-id': id,
    'svix-timestamp': String(ts),
    'svix-signature': `v1,bogus v1,${sig}`,
  });
}

Deno.test('svix: accepts a valid signature among several', async () => {
  const now = 1_800_000_000;
  assertEquals(
    await verifySvix(SECRET, await signedHeaders('{"a":1}', now), '{"a":1}', now),
    true,
    'valid',
  );
});

Deno.test('svix: rejects tampered bodies, wrong secrets and replays', async () => {
  const now = 1_800_000_000;
  const headers = await signedHeaders('{"a":1}', now);
  assertEquals(await verifySvix(SECRET, headers, '{"a":2}', now), false, 'tampered');
  assertEquals(
    await verifySvix('whsec_' + btoa('other-key'), headers, '{"a":1}', now),
    false,
    'wrong secret',
  );
  assertEquals(await verifySvix(SECRET, headers, '{"a":1}', now + 301), false, 'replay');
  assertEquals(await verifySvix(SECRET, new Headers(), '{"a":1}', now), false, 'missing headers');
});

Deno.test('safeEqual compares exactly', () => {
  assertEquals(
    [safeEqual('abc', 'abc'), safeEqual('abc', 'abd'), safeEqual('abc', 'abcd')],
    [true, false, false],
    'eq',
  );
});

function email(): OutgoingEmail {
  return {
    from: fromHeader('Acme', 'invoices@mail.test'),
    to: 'client@x.test',
    replyTo: 'owner@acme.test',
    subject: 'Invoice',
    text: 'Hello',
    htmlBody: '<p>Hello</p>',
    idempotencyKey: 'reminder:123',
    messageId: 'm1',
  };
}

Deno.test('resend: sends with the idempotency key and reply-to', async () => {
  let seen: { headers: Headers; body: Record<string, unknown> } | null = null;
  const provider = new ResendProvider('re_key', (async (_url: string, init: RequestInit) => {
    seen = { headers: new Headers(init.headers), body: JSON.parse(init.body as string) };
    return new Response(JSON.stringify({ id: 're_123' }), { status: 200 });
  }) as typeof fetch);
  const res = await provider.send(email());
  assertEquals(res, { ok: true, providerMessageId: 're_123' }, 'result');
  assertEquals(seen!.headers.get('Idempotency-Key'), 'reminder:123', 'idempotency header');
  assertEquals(seen!.body.reply_to, 'owner@acme.test', 'reply-to');
  assertEquals(seen!.body.from, '"Acme via SASU Invoice" <invoices@mail.test>', 'from');
});

Deno.test('resend: 429/5xx are retryable, other 4xx are permanent', async () => {
  const respond = (status: number) =>
    new ResendProvider('k', (() =>
      Promise.resolve(new Response('{"message":"x"}', { status }))) as typeof fetch);
  const r429 = await respond(429).send(email());
  const r500 = await respond(503).send(email());
  const r422 = await respond(422).send(email());
  assertEquals([r429.ok, !r429.ok && r429.permanent], [false, false], '429');
  assertEquals(!r500.ok && r500.permanent, false, '5xx');
  assertEquals(!r422.ok && r422.permanent, true, '422');
});

Deno.test('fromHeader strips header-breaking characters from business names', () => {
  assertEquals(
    fromHeader('Evil"\r\nBcc: x@y <z>', 'a@b.test'),
    '"EvilBcc: x@y z via SASU Invoice" <a@b.test>',
    'sanitized',
  );
  assertEquals(
    fromHeader('', 'a@b.test'),
    '"SASU Invoice via SASU Invoice" <a@b.test>',
    'fallback',
  );
});

Deno.test('templateVars formats amounts and dates in the invoice locale', () => {
  const vars = templateVars(
    {
      messageId: 'm',
      shareToken: 'a'.repeat(64),
      fromName: 'Acme',
      replyTo: null,
      signature: 'Acme Ltd',
      businessName: 'Acme',
      clientName: 'Jane',
      invoiceNumber: 'INV-1',
      currency: 'EUR',
      locale: 'fr-FR',
      amountDueMinor: 123456,
      totalMinor: 123456,
      dueDate: '2026-11-04',
      daysOverdue: 0,
    },
    'https://app.test/',
  );
  assertEquals(vars.link, `https://app.test/invoice.html#t=${'a'.repeat(64)}`, 'link');
  assertEquals(vars.amount_due!.replace(/\s/g, ' '), '1 234,56 €', 'money');
});

Deno.test('redact masks emails, phone numbers and account numbers', () => {
  const out = redact(
    'Paid from GB29 NWBK 6016 1331 9268 19 yesterday, card 4111 1111 1111 1111. Call +44 20 7946 0958 or mail jane.doe@acme.co.uk on the 12th.',
  );
  assertEquals(out.includes('jane.doe'), false, 'email');
  assertEquals(out.includes('7946'), false, 'phone');
  assertEquals(out.includes('NWBK'), false, 'iban');
  assertEquals(out.includes('4111'), false, 'card');
  assertEquals(out.includes('12th'), true, 'keeps ordinary text');
});

Deno.test('request bodies are capped before parsing', async () => {
  const req = (body: string, length?: string) =>
    new Request('https://fn.test', {
      method: 'POST',
      body,
      headers: length ? { 'Content-Length': length } : {},
    });
  assertEquals(await readJson(req('{"a":1}'), 100), { a: 1 }, 'small JSON is read');
  assertEquals(await readJson(req('not json'), 100), null, 'invalid JSON is null');
  assertEquals(await readJson(req('{"a":"' + 'x'.repeat(200) + '"}'), 100), undefined, 'too large');
  assertEquals(await readJson(req('{}', '5000000'), 100), undefined, 'declared length too large');
});
