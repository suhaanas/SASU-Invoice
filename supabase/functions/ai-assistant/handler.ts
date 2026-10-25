/**
 * POST /functions/v1/ai-assistant — RecoverFlow AI helpers. Every answer is a
 * suggestion for a person to review; nothing here changes invoices, payments,
 * statuses or reminders.
 *
 *   draft_reminder      { invoiceId, kind, tone }          → { subject, body }
 *   rewrite             { orgId, subject, body, tone }     → { subject, body }
 *   analyze_reply       { orgId, text }                    → analysis (intent, dispute, date…)
 *   explain_outstanding { orgId, currency }                → { summary, highlights }
 */
import { z } from 'zod';
import {
  EMAIL_KIND_LABELS,
  EMAIL_KINDS,
  MAX_BODY,
  TONE_LABELS,
  TONES,
  toneViolation,
  unknownPlaceholders,
} from '../_shared/core/emails.ts';
import {
  AiError,
  ANALYSIS_SCHEMA,
  DRAFT_SCHEMA,
  EXPLAIN_SCHEMA,
  redact,
  WRITING_RULES,
  type AiProvider,
} from '../_shared/ai.ts';
import { corsHeaders, json, tooManyRequests, sqlErrorResponse } from '../_shared/http.ts';
import { overLimit, type Rpc } from '../_shared/supabase.ts';

export interface Deps {
  allowedOrigins: string[];
  ai: AiProvider;
  userFromToken(token: string): Promise<string | null>;
  rpc: Rpc;
  today?: () => string;
}

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const tone = z.enum(TONES);

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('draft_reminder'),
    invoiceId: UUID,
    kind: z.enum(EMAIL_KINDS),
    tone,
  }),
  z.object({
    action: z.literal('rewrite'),
    orgId: UUID,
    subject: z.string().max(200),
    body: z.string().min(1).max(MAX_BODY),
    tone,
  }),
  z.object({
    action: z.literal('analyze_reply'),
    orgId: UUID,
    text: z.string().trim().min(2).max(6000),
  }),
  z.object({
    action: z.literal('explain_outstanding'),
    orgId: UUID,
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
]);

const draftOut = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(MAX_BODY),
});
const analysisOut = z.object({
  summary: z.string().max(1000),
  intent: z.enum(['will_pay', 'paid_already', 'dispute', 'question', 'needs_more_time', 'other']),
  dispute: z.boolean(),
  dispute_reason: z.string().max(500).nullable(),
  proposed_payment_date: z.string().nullable(),
  suggested_actions: z.array(z.string().max(300)).max(6),
  suggested_reply: z.string().max(MAX_BODY),
});
const explainOut = z.object({
  summary: z.string().max(1500),
  highlights: z.array(z.string().max(300)).max(6),
});

type Body = z.infer<typeof bodySchema>;

/** Keep a proposed date only if it is a real date within a plausible range. */
export function plausibleDate(value: string | null, today: string): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const t = Date.parse(`${value}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== value) return null;
  const days = (t - now) / 86_400_000;
  return days >= -60 && days <= 366 ? value : null;
}

/** Checks a draft against the house rules; returns the cleaned draft or a reason. */
export function checkDraft(d: {
  subject: string;
  body: string;
}): { subject: string; body: string } | { reason: string } {
  const unknown = unknownPlaceholders(`${d.subject}\n${d.body}`);
  if (unknown.length > 0) return { reason: `it used an unknown placeholder ({{${unknown[0]}}})` };
  const banned = toneViolation(`${d.subject}\n${d.body}`);
  if (banned) return { reason: `it mentioned “${banned}”` };
  let body = d.body.trim();
  if (!body.includes('{{link}}')) body += '\n\n{{link}}';
  if (!body.includes('{{signature}}')) body += '\n\n{{signature}}';
  return { subject: d.subject.replace(/[\r\n]+/g, ' ').trim(), body };
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const cors = corsHeaders(req.headers.get('Origin'), deps.allowedOrigins);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, cors);

  const token = /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '')?.[1];
  const userId = token ? await deps.userFromToken(token) : null;
  if (!userId) return json(401, { error: 'Please sign in again', code: 'SA401' }, cors);
  if (await overLimit(deps.rpc, `ai-assistant:${userId}`, 10)) return tooManyRequests(cors);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, { error: 'Invalid request', code: 'SA422' }, cors);
  const body: Body = parsed.data;
  if (!deps.ai.configured) {
    return json(
      503,
      { error: 'The AI assistant is not set up yet.', code: 'not_configured' },
      cors,
    );
  }
  const flags = await deps.rpc('rf_scheduler_flags', {});
  if ((flags.data as { ai?: boolean } | null)?.ai === false) {
    return json(
      503,
      { error: 'The AI assistant is switched off right now.', code: 'disabled' },
      cors,
    );
  }

  // Facts for drafts come from the database (and contain no personal data).
  let facts: {
    orgId: string;
    daysFromDue: number | null;
    partiallyPaid: boolean;
    paid: boolean;
    remindersSent: number;
  } | null = null;
  if (body.action === 'draft_reminder') {
    const ctx = await deps.rpc('rf_ai_invoice_context', {
      p_user: userId,
      p_invoice: body.invoiceId,
    });
    if (ctx.error) return sqlErrorResponse(ctx.error, cors);
    facts = ctx.data as typeof facts;
  }
  const orgId = body.action === 'draft_reminder' ? facts!.orgId : body.orgId;

  const allowed = await deps.rpc('rf_begin_ai', { p_user: userId, p_org: orgId });
  if (allowed.error) return sqlErrorResponse(allowed.error, cors);
  const log = (model: string, input: number, output: number, outcome: string) =>
    deps.rpc('rf_log_ai', {
      p_user: userId,
      p_org: orgId,
      p_action: body.action,
      p_model: model,
      p_input: input,
      p_output: output,
      p_outcome: outcome,
    });
  if (allowed.data !== true) {
    await log('', 0, 0, 'limited');
    return json(
      402,
      { error: 'Your plan’s monthly AI allowance is used up.', code: 'SA402' },
      cors,
    );
  }

  let request;
  switch (body.action) {
    case 'draft_reminder': {
      const when =
        facts!.daysFromDue === null
          ? 'The invoice has no due date.'
          : facts!.daysFromDue < 0
            ? `The invoice is due in ${-facts!.daysFromDue} days.`
            : facts!.daysFromDue === 0
              ? 'The invoice is due today.'
              : `The invoice is ${facts!.daysFromDue} days past its due date.`;
      request = {
        system: `You write short payment reminder emails for small businesses to their clients.\n${WRITING_RULES}`,
        user: [
          `Email type: ${EMAIL_KIND_LABELS[body.kind]}.`,
          `Tone: ${TONE_LABELS[body.tone]}.`,
          when,
          facts!.partiallyPaid ? 'Part of the invoice has already been paid.' : '',
          facts!.paid ? 'The invoice is fully paid (write a thank-you, not a reminder).' : '',
          `Reminders already sent for this invoice: ${facts!.remindersSent}.`,
        ]
          .filter(Boolean)
          .join('\n'),
        schemaName: 'email_draft',
        schema: DRAFT_SCHEMA,
      };
      break;
    }
    case 'rewrite':
      request = {
        system: `You rewrite payment emails in a requested tone, keeping their facts and placeholders.\n${WRITING_RULES}`,
        user: `Tone: ${TONE_LABELS[body.tone]}.\nSubject: ${redact(body.subject)}\n\nBody:\n${redact(body.body)}`,
        schemaName: 'email_draft',
        schema: DRAFT_SCHEMA,
      };
      break;
    case 'analyze_reply':
      request = {
        system: `You help a small business understand a client's reply about an unpaid invoice.
Summarise it in one or two sentences, classify the intent, say whether the client disputes the invoice (wrong amount, work not delivered, not agreed…) and why, and extract a payment date only if the client explicitly states one (YYYY-MM-DD; today is ${deps.today?.() ?? new Date().toISOString().slice(0, 10)}).
Suggest up to 4 short next steps for the business. You cannot verify payments: if the client says they paid, the next step is to check the bank account before recording anything.
Also draft a polite reply using {{client_name}} and {{signature}} placeholders. Never threaten or mention legal action, collections or credit scores.
Identifiers in the text may be masked like [email]; leave them masked.`,
        user: `Client reply:\n"""\n${redact(body.text)}\n"""`,
        schemaName: 'reply_analysis',
        schema: ANALYSIS_SCHEMA,
      };
      break;
    case 'explain_outstanding': {
      const summary = await deps.rpc('dashboard_summary', {
        p_org: orgId,
        p_currency: body.currency,
      });
      if (summary.error) return sqlErrorResponse(summary.error, cors);
      const s = summary.data as Record<string, unknown>;
      // Aggregates only: no client names or individual invoices.
      const figures = {
        currency: body.currency,
        invoiced: s.invoicedMinor,
        paid: s.paidMinor,
        outstanding: s.outstandingMinor,
        outstandingInvoices: s.outstandingCount,
        overdue: s.overdueMinor,
        overdueInvoices: s.overdueCount,
        partiallyPaidInvoices: s.partialCount,
        dueNext7Days: s.dueWeekMinor,
        receivedThisMonth: s.paymentsMonthMinor,
        aging: s.aging,
        monthly: s.monthly,
      };
      request = {
        system: `You explain a small business's unpaid invoices in plain language. Amounts are integer minor units (cents) of the given currency; convert them for display. Be factual and brief; do not give legal or tax advice. Up to 4 highlights, each one sentence, focused on what to follow up first.`,
        user: JSON.stringify(figures),
        schemaName: 'outstanding_summary',
        schema: EXPLAIN_SCHEMA,
      };
      break;
    }
  }

  let result;
  try {
    result = await deps.ai.complete(request);
  } catch (err) {
    await log('', 0, 0, 'error');
    const message =
      err instanceof AiError && err.kind === 'refused'
        ? err.message
        : 'The assistant is unavailable right now. Try again shortly.';
    return json(502, { error: message }, cors);
  }

  const out = (() => {
    if (body.action === 'draft_reminder' || body.action === 'rewrite') {
      const d = draftOut.safeParse(result.json);
      if (!d.success) return { error: 'The assistant returned an unexpected answer. Try again.' };
      const checked = checkDraft(d.data);
      if ('reason' in checked)
        return {
          error: `The draft was discarded because ${checked.reason}. Try again or pick another tone.`,
        };
      return { data: checked };
    }
    if (body.action === 'analyze_reply') {
      const a = analysisOut.safeParse(result.json);
      if (!a.success) return { error: 'The assistant returned an unexpected answer. Try again.' };
      const reply = checkDraft({ subject: 'Reply', body: a.data.suggested_reply });
      return {
        data: {
          ...a.data,
          proposed_payment_date: plausibleDate(
            a.data.proposed_payment_date,
            deps.today?.() ?? new Date().toISOString().slice(0, 10),
          ),
          suggested_reply: 'reason' in reply ? '' : reply.body.replace(/\n\n\{\{link\}\}/, ''),
          // The assistant can't confirm money arrived; the UI must say so.
          requires_verification: a.data.intent === 'paid_already',
        },
      };
    }
    const e = explainOut.safeParse(result.json);
    return e.success
      ? { data: e.data }
      : { error: 'The assistant returned an unexpected answer. Try again.' };
  })();

  await log(
    result.model,
    result.inputTokens,
    result.outputTokens,
    'error' in out ? 'rejected' : 'ok',
  );
  return 'error' in out ? json(422, { error: out.error }, cors) : json(200, out.data, cors);
}
