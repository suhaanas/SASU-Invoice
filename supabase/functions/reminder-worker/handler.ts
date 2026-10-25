/**
 * POST /functions/v1/reminder-worker — run by pg_cron every few minutes
 * (supabase/setup/schedule-reminders.sql) with the shared WORKER_SECRET.
 *
 * 1. Recurring invoices due today: build each from its template (shared core),
 *    save it with a server-assigned number (once per date), email if asked.
 * 2. Reminders: queue those due now (idempotent), claim a batch (leased,
 *    skip-locked), re-check eligibility, send with the job's idempotency key,
 *    then record accepted / failed (the database handles retries).
 * Either step can be switched off from the admin console.
 */
import {
  DEFAULT_TEMPLATES,
  renderEmail,
  type EmailKind,
  type Tone,
} from '../_shared/core/emails.ts';
import {
  fromHeader,
  templateVars,
  type EmailProvider,
  type SendContext,
} from '../_shared/email.ts';
import { computeTotals } from '../_shared/core/calc.ts';
import { buildRecurringDocument } from '../_shared/core/recurrence.ts';
import { invoiceSchema } from '../_shared/core/validate.ts';
import { json } from '../_shared/http.ts';
import type { Rpc } from '../_shared/supabase.ts';
import { safeEqual } from '../_shared/webhook.ts';

export interface Deps {
  secret: string;
  appUrl: string;
  fromAddress: string;
  provider: EmailProvider;
  rpc: Rpc;
  batchSize?: number;
  now?: () => number;
}

type Prepared =
  | { skip: true; reason: string }
  | (SendContext & {
      skip: false;
      to: string;
      kind: EmailKind;
      tone: Tone;
      idempotencyKey: string;
      template: { subject: string; body: string } | null;
    });

export interface ReminderSummary {
  queued: number;
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
}

export interface RecurringSummary {
  claimed: number;
  created: number;
  emailed: number;
  failed: number;
}

interface Flags {
  reminders: boolean;
  recurring: boolean;
}

/** Send one prepared email and record the outcome. */
async function sendAndRecord(
  deps: Deps,
  ctx: SendContext,
  to: string,
  template: { subject: string; body: string },
  tone: Tone,
  idempotencyKey: string,
): Promise<boolean> {
  const vars = templateVars(ctx, deps.appUrl);
  const email = renderEmail({ template, tone, vars });
  const result = await deps.provider.send({
    from: fromHeader(ctx.fromName, deps.fromAddress),
    to,
    replyTo: ctx.replyTo,
    subject: email.subject,
    text: email.text,
    htmlBody: email.htmlBody,
    idempotencyKey,
    messageId: ctx.messageId,
  });
  if (result.ok) {
    await deps.rpc('rf_mark_accepted', {
      p_message: ctx.messageId,
      p_provider: deps.provider.name,
      p_provider_message_id: result.providerMessageId,
      p_subject: email.subject,
      p_body: email.text,
    });
    return true;
  }
  await deps.rpc('rf_mark_failed', {
    p_message: ctx.messageId,
    p_error: result.error,
    p_permanent: result.permanent,
  });
  return false;
}

/** Recurring invoices due today: build from the template, save, optionally email. */
async function runRecurring(deps: Deps): Promise<RecurringSummary> {
  const summary: RecurringSummary = { claimed: 0, created: 0, emailed: 0, failed: 0 };
  const claim = await deps.rpc('rf_claim_recurring', { p_limit: 10 });
  if (claim.error) return summary;
  const due = claim.data as {
    ruleId: string;
    runDate: string;
    mode: 'draft' | 'issue';
    template: unknown;
  }[];
  summary.claimed = due.length;
  for (const rule of due) {
    const template = invoiceSchema.safeParse(rule.template);
    if (!template.success) {
      summary.failed++;
      continue; // lease expires; the template problem shows as a stuck schedule
    }
    const doc = buildRecurringDocument(template.data, rule.runDate, {
      issue: rule.mode === 'issue',
      now: deps.now?.() ?? Date.now(),
      id: crypto.randomUUID(),
    });
    const t = computeTotals(doc);
    const done = await deps.rpc('rf_complete_recurring', {
      p_rule: rule.ruleId,
      p_run_date: rule.runDate,
      p_doc: doc,
      p_totals: {
        subtotal: t.subtotal,
        discount: t.discount,
        tax: t.tax,
        shipping: t.shipping,
        total: t.total,
        paid: t.paid,
        balance: t.balance,
      },
    });
    const r = done.data as {
      error?: string;
      duplicate?: boolean;
      runId?: string;
      invoiceId?: string;
      userId?: string;
      sendEmail?: boolean;
      to?: string;
      template?: { subject: string; body: string } | null;
    } | null;
    if (done.error || !r || r.error) {
      summary.failed++;
      continue;
    }
    if (r.duplicate) continue;
    summary.created++;
    if (!r.sendEmail || !deps.provider.configured) continue;
    const key = `manual:${r.runId}`;
    const prep = await deps.rpc('rf_prepare_manual_email', {
      p_user: r.userId,
      p_invoice: r.invoiceId,
      p_kind: 'new_invoice',
      p_to: r.to,
      p_idempotency_key: key,
    });
    if (prep.error) continue;
    const ctx = prep.data as SendContext & { duplicate: boolean };
    if (ctx.duplicate) continue;
    const ok = await sendAndRecord(
      deps,
      ctx,
      r.to!,
      r.template ?? DEFAULT_TEMPLATES.new_invoice,
      'professional',
      key,
    );
    await deps.rpc('rf_link_recurring_email', { p_run: r.runId, p_message: ctx.messageId });
    if (ok) summary.emailed++;
  }
  return summary;
}

async function runReminders(deps: Deps): Promise<ReminderSummary> {
  const summary: ReminderSummary = { queued: 0, claimed: 0, sent: 0, skipped: 0, failed: 0 };
  const enq = await deps.rpc('rf_enqueue_due_reminders', {});
  if (enq.error) return summary;
  summary.queued = enq.data as number;
  const claim = await deps.rpc('rf_claim_jobs', { p_limit: deps.batchSize ?? 25 });
  if (claim.error) return summary;
  const jobs = claim.data as { id: string }[];
  summary.claimed = jobs.length;
  for (const job of jobs) {
    const prep = await deps.rpc('rf_prepare_reminder', { p_job: job.id });
    if (prep.error) {
      summary.failed++;
      continue; // lease expires and the job is retried
    }
    const p = prep.data as Prepared;
    if (p.skip) {
      summary.skipped++;
      continue;
    }
    const ok = await sendAndRecord(
      deps,
      p,
      p.to,
      p.template ?? DEFAULT_TEMPLATES[p.kind],
      p.tone,
      p.idempotencyKey,
    );
    if (ok) summary.sent++;
    else summary.failed++;
  }
  return summary;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const given = req.headers.get('x-worker-secret') ?? '';
  if (!deps.secret || !safeEqual(given, deps.secret)) return json(401, { error: 'Unauthorized' });

  const flagsRes = await deps.rpc('rf_scheduler_flags', {});
  const flags = (flagsRes.data as Flags | null) ?? { reminders: true, recurring: true };

  // Recurring invoices are created even without email; only their emails need a provider.
  const recurring = flags.recurring ? await runRecurring(deps) : null;
  // Reminders aren't claimed without a provider: they would burn their retries.
  const reminders = flags.reminders && deps.provider.configured ? await runReminders(deps) : null;

  const summary = {
    recurring,
    reminders,
    notes: [
      ...(flags.recurring ? [] : ['recurring invoices switched off']),
      ...(!flags.reminders ? ['reminders switched off'] : []),
      ...(flags.reminders && !deps.provider.configured ? ['email provider not configured'] : []),
    ],
  };
  console.log(JSON.stringify({ fn: 'scheduler', ...summary }));
  return json(200, summary);
}
