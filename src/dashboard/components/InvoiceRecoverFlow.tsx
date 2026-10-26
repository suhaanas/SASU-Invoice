/**
 * RecoverFlow on the invoice page: email the client, see what was sent and
 * whether it arrived, control automatic reminders, and get AI help with a
 * client's reply. AI output is advice; every change is a separate click.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellOff, BellRing, Mail, MessageSquareText, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { EMAIL_KIND_LABELS, type EmailKind } from '../../core/emails';
import {
  askAssistant,
  errorMessage,
  getClient,
  listEmailMessages,
  listReminderJobs,
  reminderStatus,
  setDispute,
  setRemindersPaused,
  type InvoiceDetail,
  type ReplyAnalysis,
  todayIn,
} from '../lib/api';
import { useSupabase } from '../lib/auth';
import { date, dateTime } from '../lib/format';
import { useAiEnabled } from '../lib/flags';
import { useActiveOrg } from '../lib/org';
import { useToast } from '../lib/toast';
import { EmailActivity } from './EmailActivity';
import { EmailComposer, type ComposerPreset } from './EmailComposer';
import {
  Alert,
  ComingSoon,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Field,
  Input,
  Skeleton,
  Textarea,
} from './ui';

export const BLOCK_REASONS: Record<string, string> = {
  deleted: 'The invoice was deleted.',
  not_issued: 'Only issued invoices get reminders.',
  paid: 'The invoice is paid.',
  paused: 'Reminders are paused for this invoice.',
  disputed: 'The invoice is marked as disputed.',
  reminders_off: 'Automatic reminders are off for your organization.',
  plan: 'Automatic reminders need a Pro or Business plan.',
  no_client: 'The invoice has no client.',
  opted_out: 'The client asked not to receive reminder emails.',
  no_email: 'The client has no valid email address.',
  suppressed: 'Emails to this client bounced or were marked as spam.',
};

const JOB_STATUS: Record<
  string,
  { label: string; tone: 'neutral' | 'brand' | 'ok' | 'warn' | 'danger' }
> = {
  scheduled: { label: 'Queued', tone: 'brand' },
  processing: { label: 'Sending', tone: 'brand' },
  sent: { label: 'Sent', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};

const timing = (offset: number) =>
  offset === 0
    ? 'On the due date'
    : offset < 0
      ? `${-offset} days before due`
      : `${offset} days after due`;

export function InvoiceRecoverFlow({ invoice }: { invoice: InvoiceDetail }) {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [composer, setComposer] = useState<ComposerPreset | null>(null);
  const client = useQuery({
    queryKey: ['client', invoice.client_id],
    queryFn: () => getClient(sb, invoice.client_id!),
    enabled: !!invoice.client_id,
  });
  const messages = useQuery({
    queryKey: ['emails', invoice.id],
    queryFn: () => listEmailMessages(sb, org.id, { invoiceId: invoice.id }),
  });
  const clientEmail = client.data?.email ?? '';

  const open = (kind: EmailKind, extra: Partial<ComposerPreset> = {}) =>
    setComposer({ kind, to: clientEmail, ...extra });
  const today = todayIn(org.timezone);
  const pastDue = !!invoice.due_date && invoice.due_date < today;
  const defaultKind: EmailKind =
    invoice.balance_minor <= 0 ? 'payment_received' : pastDue ? 'overdue' : 'new_invoice';

  return (
    <>
      <Card>
        <CardHeader
          title="Emails"
          description="Sent from SASU Invoice on your behalf; replies go to your business email."
          action={
            invoice.issued_at && (
              <Button size="sm" onClick={() => open(defaultKind)}>
                <Mail className="h-4 w-4" aria-hidden /> Send email
              </Button>
            )
          }
        />
        {!invoice.issued_at ? (
          <div className="p-5">
            <Alert tone="info">Issue the invoice in the editor before emailing it.</Alert>
          </div>
        ) : messages.isPending ? (
          <Skeleton className="m-5 h-16" />
        ) : messages.error ? (
          <div className="p-5">
            <Alert tone="danger">{errorMessage(messages.error)}</Alert>
          </div>
        ) : messages.data.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-graphite">
            No emails sent for this invoice yet.
          </p>
        ) : (
          <EmailActivity
            messages={messages.data}
            onRetry={(m) => open(m.kind, { to: m.to_email, subject: m.subject || undefined })}
          />
        )}
      </Card>

      {invoice.doc_type === 'invoice' && invoice.issued_at && <RemindersCard invoice={invoice} />}
      {invoice.issued_at && (
        <ReplyAssistant
          invoice={invoice}
          onUseReply={(body) =>
            open('follow_up', { body, subject: `Re: invoice ${invoice.number}` })
          }
        />
      )}

      {composer && (
        <EmailComposer
          invoice={invoice}
          preset={composer}
          onClose={() => setComposer(null)}
          onSent={async (status) => {
            setComposer(null);
            toast(status === 'accepted' ? 'Email accepted for delivery' : `Email ${status}`);
            await Promise.all([
              qc.invalidateQueries({ queryKey: ['emails', invoice.id] }),
              qc.invalidateQueries({ queryKey: ['history', invoice.id] }),
            ]);
          }}
        />
      )}
    </>
  );
}

function RemindersCard({ invoice }: { invoice: InvoiceDetail }) {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState('');
  const status = useQuery({
    queryKey: ['reminder-status', invoice.id],
    queryFn: () => reminderStatus(sb, invoice.id),
  });
  const jobs = useQuery({
    queryKey: ['reminder-jobs', invoice.id],
    queryFn: () => listReminderJobs(sb, org.id, { invoiceId: invoice.id }),
  });
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['reminder-status', invoice.id] }),
      qc.invalidateQueries({ queryKey: ['reminder-jobs', invoice.id] }),
      qc.invalidateQueries({ queryKey: ['history', invoice.id] }),
    ]);
  const pause = useMutation({
    mutationFn: (paused: boolean) => setRemindersPaused(sb, invoice.id, paused),
    onSuccess: async (_d, paused) => {
      toast(paused ? 'Reminders paused' : 'Reminders resumed');
      await refresh();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  const dispute = useMutation({
    mutationFn: (openIt: boolean) => setDispute(sb, invoice.id, openIt, note),
    onSuccess: async (_d, openIt) => {
      setDisputing(false);
      setNote('');
      toast(openIt ? 'Marked as disputed; reminders stopped' : 'Dispute resolved');
      await refresh();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  const s = status.data;
  return (
    <Card>
      <CardHeader
        title="Automatic reminders"
        action={
          <Link to="/reminders" className="text-sm font-semibold text-brand-ink">
            Schedule
          </Link>
        }
      />
      <div className="space-y-4 p-5 text-sm">
        {!s ? (
          <Skeleton className="h-10" />
        ) : (
          <>
            <p className="flex items-start gap-2">
              {s.blockReason ? (
                <BellOff className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden />
              ) : (
                <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
              )}
              <span>
                {s.blockReason
                  ? (BLOCK_REASONS[s.blockReason] ?? s.blockReason)
                  : 'Reminders will go out on your schedule until this invoice is paid.'}
              </span>
            </p>
            {s.disputed && s.disputeNote && <Alert tone="warn">Dispute: {s.disputeNote}</Alert>}
            <div className="flex flex-wrap gap-2">
              {!s.disputed && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={pause.isPending}
                  onClick={() => pause.mutate(!s.paused)}
                >
                  {s.paused ? 'Resume reminders' : 'Pause reminders'}
                </Button>
              )}
              {s.disputed ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={dispute.isPending}
                  onClick={() => dispute.mutate(false)}
                >
                  Resolve dispute
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setDisputing(true)}>
                  Mark as disputed
                </Button>
              )}
            </div>
          </>
        )}
        {jobs.data && jobs.data.length > 0 && (
          <ul className="divide-y divide-rule rounded-lg border border-rule">
            {jobs.data.map((j) => (
              <li key={j.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{timing(j.offset_days)}</span>
                  <span className="text-graphite">
                    {' '}
                    · {EMAIL_KIND_LABELS[j.kind]} · {dateTime(j.scheduled_for)}
                  </span>
                  {(j.cancel_reason || j.last_error) && (
                    <span className="block text-graphite">
                      {j.cancel_reason
                        ? (BLOCK_REASONS[j.cancel_reason] ?? j.cancel_reason)
                        : j.last_error}
                    </span>
                  )}
                </span>
                <Badge tone={JOB_STATUS[j.status]!.tone}>{JOB_STATUS[j.status]!.label}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={disputing}
        title="Mark this invoice as disputed?"
        confirmLabel="Mark as disputed"
        loading={dispute.isPending}
        onCancel={() => setDisputing(false)}
        onConfirm={() => dispute.mutate(true)}
      >
        <p>Automatic reminders stop until you resolve the dispute.</p>
        <div className="mt-3">
          <Field label="What is disputed?">
            {(p) => (
              <Input
                {...p}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
        </div>
      </ConfirmDialog>
    </Card>
  );
}

const INTENT_LABEL: Record<ReplyAnalysis['intent'], string> = {
  will_pay: 'Will pay',
  paid_already: 'Says they’ve paid',
  dispute: 'Disputes the invoice',
  question: 'Has a question',
  needs_more_time: 'Needs more time',
  other: 'Other',
};

function ReplyAssistant({
  invoice,
  onUseReply,
}: {
  invoice: InvoiceDetail;
  onUseReply: (body: string) => void;
}) {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const analyze = useMutation({
    mutationFn: () =>
      askAssistant<ReplyAnalysis>(sb, { action: 'analyze_reply', orgId: org.id, text }),
  });
  const markDisputed = useMutation({
    mutationFn: (reason: string) => setDispute(sb, invoice.id, true, reason),
    onSuccess: async () => {
      toast('Marked as disputed; reminders stopped');
      await qc.invalidateQueries({ queryKey: ['reminder-status', invoice.id] });
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  const a = analyze.data;
  const ai = useAiEnabled();

  if (!ai.enabled) {
    return (
      <Card>
        <CardHeader title="Reply assistant" action={<ComingSoon />} />
        <p className="px-5 py-4 text-sm text-graphite">
          Soon you’ll be able to paste a client’s reply here to get a summary, spot disputes and a
          suggested answer.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Reply assistant"
        description="Paste a client’s reply to get a summary and a suggested answer."
      />
      <div className="space-y-3 p-5 text-sm">
        <Textarea
          aria-label="Client reply"
          rows={4}
          maxLength={6000}
          value={text}
          placeholder="Paste the client's email here"
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-faint">
            Emails, phone and account numbers are masked before the text is sent to the AI.
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={text.trim().length < 2}
            loading={analyze.isPending}
            onClick={() => analyze.mutate()}
          >
            <Sparkles className="h-4 w-4" aria-hidden /> Analyze
          </Button>
        </div>
        {analyze.error && <Alert tone="danger">{errorMessage(analyze.error)}</Alert>}
        {a && (
          <div className="space-y-3 rounded-lg border border-rule p-4">
            <div className="flex flex-wrap items-center gap-2">
              <MessageSquareText className="h-4 w-4 text-brand" aria-hidden />
              <Badge tone={a.dispute ? 'danger' : 'brand'}>{INTENT_LABEL[a.intent]}</Badge>
              {a.proposed_payment_date && <Badge>Proposes {date(a.proposed_payment_date)}</Badge>}
            </div>
            <p>{a.summary}</p>
            {a.requires_verification && (
              <Alert tone="warn">
                The client says they’ve paid. Check your bank account; record the payment only once
                the money has arrived.
              </Alert>
            )}
            {a.dispute && (
              <Alert tone="warn">
                <p>Possible dispute{a.dispute_reason ? `: ${a.dispute_reason}` : ''}.</p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  loading={markDisputed.isPending}
                  onClick={() => markDisputed.mutate(a.dispute_reason ?? 'Raised by client')}
                >
                  Mark as disputed and stop reminders
                </Button>
              </Alert>
            )}
            {a.suggested_actions.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-graphite">
                {a.suggested_actions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            )}
            {a.suggested_reply && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">
                  Suggested reply
                </p>
                <p className="whitespace-pre-wrap rounded-lg bg-canvas p-3 text-xs">
                  {a.suggested_reply}
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  onClick={() => onUseReply(a.suggested_reply)}
                >
                  Use in an email
                </Button>
              </div>
            )}
            <p className="text-xs text-faint">
              AI suggestions can be wrong. Nothing is changed until you choose to.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
