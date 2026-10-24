/**
 * POST /functions/v1/reminder-worker — run by pg_cron every few minutes
 * (supabase/setup/schedule-reminders.sql) with the shared WORKER_SECRET.
 *
 * 1. Queue reminders that are due now (idempotent).
 * 2. Claim a batch of jobs (leased, skip-locked).
 * 3. For each: re-check eligibility and prepare (DB), render, send with the
 *    job's idempotency key, then record accepted / failed (DB handles retries).
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

export interface RunSummary {
  queued: number;
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const given = req.headers.get('x-worker-secret') ?? '';
  if (!deps.secret || !safeEqual(given, deps.secret)) return json(401, { error: 'Unauthorized' });
  // Don't claim jobs we can't send: they would burn their retries.
  if (!deps.provider.configured) return json(503, { error: 'Email provider not configured' });

  const summary: RunSummary = { queued: 0, claimed: 0, sent: 0, skipped: 0, failed: 0 };
  const enq = await deps.rpc('rf_enqueue_due_reminders', {});
  if (enq.error) return json(500, { error: 'enqueue failed' });
  summary.queued = enq.data as number;

  const claim = await deps.rpc('rf_claim_jobs', { p_limit: deps.batchSize ?? 25 });
  if (claim.error) return json(500, { error: 'claim failed' });
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
    const vars = templateVars(p, deps.appUrl);
    const email = renderEmail({
      template: p.template ?? DEFAULT_TEMPLATES[p.kind],
      tone: p.tone,
      vars,
    });
    const result = await deps.provider.send({
      from: fromHeader(p.fromName, deps.fromAddress),
      to: p.to,
      replyTo: p.replyTo,
      subject: email.subject,
      text: email.text,
      htmlBody: email.htmlBody,
      idempotencyKey: p.idempotencyKey,
      messageId: p.messageId,
    });
    if (result.ok) {
      await deps.rpc('rf_mark_accepted', {
        p_message: p.messageId,
        p_provider: deps.provider.name,
        p_provider_message_id: result.providerMessageId,
        p_subject: email.subject,
        p_body: email.text,
      });
      summary.sent++;
    } else {
      await deps.rpc('rf_mark_failed', {
        p_message: p.messageId,
        p_error: result.error,
        p_permanent: result.permanent,
      });
      summary.failed++;
    }
  }
  console.log(JSON.stringify({ fn: 'reminder-worker', ...summary }));
  return json(200, summary);
}
