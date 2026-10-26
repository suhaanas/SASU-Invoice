import type { AiProvider, AiRequest, AiResult } from '../_shared/ai.ts';
import { checkDraft, handle, plausibleDate, type Deps } from './handler.ts';

function assertEquals(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const ORG = '6f1c1e9a-3b8e-4c1f-9f39-2f6f8b1e7a10';
const INVOICE = '7f1c1e9a-3b8e-4c1f-9f39-2f6f8b1e7a10';

function setup(answer: unknown, opts: { allowed?: boolean } = {}) {
  const prompts: AiRequest[] = [];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const ai: AiProvider = {
    configured: true,
    complete: (req) => {
      prompts.push(req);
      return Promise.resolve({
        json: answer,
        model: 'test-model',
        inputTokens: 100,
        outputTokens: 50,
      } as AiResult);
    },
  };
  const deps: Deps = {
    allowedOrigins: [],
    ai,
    today: () => '2026-10-24',
    userFromToken: (t) => Promise.resolve(t === 'good' ? 'user-1' : null),
    rpc: (name, args) => {
      if (name !== 'rf_rate_limit' && name !== 'rf_heartbeat') calls.push({ name, args });
      if (name === 'rf_begin_ai')
        return Promise.resolve({ data: opts.allowed ?? true, error: null });
      if (name === 'rf_ai_invoice_context') {
        return Promise.resolve({
          data: { orgId: ORG, daysFromDue: 12, partiallyPaid: true, paid: false, remindersSent: 2 },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { deps, prompts, calls };
}

const post = (body: unknown) =>
  new Request('https://fn.test', {
    method: 'POST',
    headers: { Authorization: 'Bearer good' },
    body: JSON.stringify(body),
  });

Deno.test('drafts use only non-personal facts and come back with link and signature', async () => {
  const { deps, prompts, calls } = setup({
    subject: 'Invoice {{invoice_number}}',
    body: 'Hello {{client_name}}, a reminder.',
  });
  const res = await handle(
    post({ action: 'draft_reminder', invoiceId: INVOICE, kind: 'overdue', tone: 'firm' }),
    deps,
  );
  const out = await res.json();
  assertEquals(res.status, 200, 'status');
  assertEquals(
    out.body.includes('{{link}}') && out.body.includes('{{signature}}'),
    true,
    'link and signature added',
  );
  assertEquals(prompts[0]!.user.includes('12 days past'), true, 'facts in prompt');
  assertEquals(calls.find((c) => c.name === 'rf_log_ai')!.args.p_outcome, 'ok', 'logged');
});

Deno.test('drafts that threaten are discarded', async () => {
  const { deps, calls } = setup({
    subject: 'Final notice',
    body: 'Pay now or we start legal action. {{link}}',
  });
  const res = await handle(
    post({ action: 'draft_reminder', invoiceId: INVOICE, kind: 'overdue', tone: 'firm' }),
    deps,
  );
  assertEquals(res.status, 422, 'status');
  assertEquals(
    calls.find((c) => c.name === 'rf_log_ai')!.args.p_outcome,
    'rejected',
    'logged as rejected',
  );
});

Deno.test('pasted replies are redacted before they reach the AI', async () => {
  const { deps, prompts } = setup({
    summary: 'Client says they paid.',
    intent: 'paid_already',
    dispute: false,
    dispute_reason: null,
    proposed_payment_date: null,
    suggested_actions: ['Check the bank account'],
    suggested_reply: 'Hi {{client_name}}, thanks!',
  });
  const res = await handle(
    post({
      action: 'analyze_reply',
      orgId: ORG,
      text: 'I paid from GB29NWBK60161331926819, email me at jo@client.test',
    }),
    deps,
  );
  const out = await res.json();
  assertEquals(
    prompts[0]!.user.includes('jo@client.test') || prompts[0]!.user.includes('NWBK'),
    false,
    'redacted',
  );
  assertEquals(out.requires_verification, true, 'a payment claim must be verified by a person');
});

Deno.test('implausible payment dates are dropped', () => {
  assertEquals(plausibleDate('2026-11-15', '2026-10-24'), '2026-11-15', 'ok');
  assertEquals(plausibleDate('2031-01-01', '2026-10-24'), null, 'too far');
  assertEquals(plausibleDate('2026-02-31', '2026-10-24'), null, 'not a date');
  assertEquals(plausibleDate('next week', '2026-10-24'), null, 'not iso');
});

Deno.test('the monthly allowance is enforced before calling the AI', async () => {
  const { deps, prompts } = setup({}, { allowed: false });
  const res = await handle(
    post({ action: 'analyze_reply', orgId: ORG, text: 'hello there' }),
    deps,
  );
  assertEquals([res.status, prompts.length], [402, 0], 'limited');
});

Deno.test('malformed AI output is rejected', async () => {
  const { deps } = setup({ subject: 42 });
  const res = await handle(
    post({ action: 'rewrite', orgId: ORG, subject: 's', body: 'b', tone: 'neutral' }),
    deps,
  );
  assertEquals(res.status, 422, 'status');
});

Deno.test('checkDraft rejects unknown placeholders', () => {
  assertEquals('reason' in checkDraft({ subject: 's', body: 'Hi {{iban}}' }), true, 'unknown');
});

Deno.test('the admin kill switch turns the assistant off', async () => {
  const { deps, prompts } = setup({});
  const rpc = deps.rpc;
  deps.rpc = (name, args) =>
    name === 'rf_scheduler_flags'
      ? Promise.resolve({ data: { ai: false }, error: null })
      : rpc(name, args);
  const res = await handle(
    post({ action: 'analyze_reply', orgId: ORG, text: 'hello there' }),
    deps,
  );
  assertEquals([res.status, prompts.length], [503, 0], 'off');
});
