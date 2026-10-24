/**
 * Compose and send an invoice email. The text keeps {{placeholders}}; the
 * server fills them (including a fresh private link) when it sends. The
 * preview shows what the client will read.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { Send, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_TEMPLATES,
  EMAIL_KIND_LABELS,
  EMAIL_KINDS,
  MAX_BODY,
  MAX_SUBJECT,
  TONE_LABELS,
  TONES,
  applyTone,
  fill,
  unknownPlaceholders,
  type EmailKind,
  type Tone,
} from '../../core/emails';
import {
  askAssistant,
  errorMessage,
  getSettings,
  listTemplates,
  sendInvoiceEmail,
  type InvoiceDetail,
} from '../lib/api';
import { useSupabase } from '../lib/auth';
import { date, money } from '../lib/format';
import { useActiveOrg } from '../lib/org';
import { Alert, Button, Field, Input, Select, Textarea } from './ui';

export interface ComposerPreset {
  kind: EmailKind;
  to: string;
  subject?: string;
  body?: string;
}

export function EmailComposer({
  invoice,
  preset,
  onClose,
  onSent,
}: {
  invoice: InvoiceDetail;
  preset: ComposerPreset;
  onClose: () => void;
  onSent: (status: string) => void;
}) {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const ref = useRef<HTMLDialogElement>(null);
  const templates = useQuery({
    queryKey: ['templates', org.id],
    queryFn: () => listTemplates(sb, org.id),
  });
  const settings = useQuery({
    queryKey: ['settings', org.id],
    queryFn: () => getSettings(sb, org.id),
  });
  const [kind, setKind] = useState<EmailKind>(preset.kind);
  const [tone, setTone] = useState<Tone>('professional');
  const [to, setTo] = useState(preset.to);
  // Until the user edits, the text follows the chosen template and tone.
  const [edited, setEdited] = useState<{ subject: string; body: string } | null>(
    preset.body ? { subject: preset.subject ?? '', body: preset.body } : null,
  );
  const [error, setError] = useState<string | null>(null);
  // One id per attempt: a double click or retry of the same request can't send twice.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);

  const template = templates.data?.find((x) => x.kind === kind) ?? DEFAULT_TEMPLATES[kind];
  const subject = edited?.subject ?? applyTone(template.subject, tone);
  const body = edited?.body ?? applyTone(template.body, tone);
  const setSubject = (v: string) => setEdited({ subject: v, body });
  const setBody = (v: string) => setEdited({ subject, body: v });

  const draft = useMutation({
    mutationFn: () =>
      askAssistant<{ subject: string; body: string }>(sb, {
        action: 'draft_reminder',
        invoiceId: invoice.id,
        kind,
        tone,
      }),
    onSuccess: (d) => {
      setEdited(d);
      setError(null);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const send = useMutation({
    mutationFn: () =>
      sendInvoiceEmail(sb, {
        invoiceId: invoice.id,
        kind,
        to: to.trim(),
        subject,
        body,
        requestId,
      }),
    onSuccess: (res) => {
      setRequestId(crypto.randomUUID());
      onSent(res.status);
    },
    onError: (err) => {
      setRequestId(crypto.randomUUID());
      setError(errorMessage(err));
    },
  });

  const unknown = unknownPlaceholders(`${subject}\n${body}`);
  const previewVars = {
    client_name: invoice.client_name || 'there',
    business_name: org.name,
    invoice_number: invoice.number,
    amount_due: money(invoice.balance_minor, invoice.currency),
    total: money(invoice.total_minor, invoice.currency),
    due_date: date(invoice.due_date),
    days_overdue: '…',
    link: '[private link to the invoice]',
    signature: settings.data?.email_signature || org.name,
  };

  const submit = () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.trim()))
      return setError('Enter a valid email address.');
    if (!subject.trim() || !body.trim()) return setError('Add a subject and a message.');
    if (unknown.length > 0) return setError(`Remove the unknown placeholder {{${unknown[0]}}}.`);
    setError(null);
    send.mutate();
  };

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!send.isPending) onClose();
      }}
      className="m-auto w-[min(860px,calc(100vw-32px))] rounded-xl border border-rule bg-paper p-0 shadow-2xl backdrop:bg-ink/40"
      aria-labelledby="composer-title"
    >
      <div className="flex items-center justify-between border-b border-rule px-5 py-4">
        <h2 id="composer-title" className="font-display text-lg font-bold">
          Email {invoice.number}
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={send.isPending}>
          Close
        </Button>
      </div>
      <div className="grid gap-0 md:grid-cols-2">
        <div className="space-y-4 p-5">
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email type">
              {(p) => (
                <Select
                  {...p}
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as EmailKind);
                    setEdited(null);
                  }}
                >
                  {EMAIL_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {EMAIL_KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Tone">
              {(p) => (
                <Select
                  {...p}
                  value={tone}
                  onChange={(e) => {
                    setTone(e.target.value as Tone);
                    setEdited(null);
                  }}
                >
                  {TONES.map((t) => (
                    <option key={t} value={t}>
                      {TONE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="To">
            {(p) => (
              <Input {...p} type="email" value={to} onChange={(e) => setTo(e.target.value)} />
            )}
          </Field>
          <Field label="Subject">
            {(p) => (
              <Input
                {...p}
                maxLength={MAX_SUBJECT}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Message"
            hint="Placeholders like {{amount_due}} and {{link}} are filled in when the email is sent."
          >
            {(p) => (
              <Textarea
                {...p}
                rows={10}
                maxLength={MAX_BODY}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            )}
          </Field>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => draft.mutate()}
            loading={draft.isPending}
          >
            <Sparkles className="h-4 w-4" aria-hidden /> Write with AI
          </Button>
          <p className="text-xs text-faint">
            The AI gets no names, emails or amounts, only the type, tone and how late the invoice
            is. Review the draft before sending.
          </p>
        </div>
        <div className="border-t border-rule bg-canvas p-5 md:border-l md:border-t-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">Preview</p>
          <div className="rounded-lg border border-rule bg-paper p-4 text-sm">
            <p className="font-semibold">{fill(subject, previewVars) || 'No subject'}</p>
            <p className="mb-3 text-xs text-graphite">
              From {settings.data?.email_from_name || org.name} via SASU Invoice · reply-to{' '}
              {settings.data?.email_reply_to || settings.data?.business.email || 'not set'}
            </p>
            <p className="whitespace-pre-wrap break-words text-ink">{fill(body, previewVars)}</p>
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-rule px-5 py-3">
        <Button variant="secondary" onClick={onClose} disabled={send.isPending}>
          Cancel
        </Button>
        <Button onClick={submit} loading={send.isPending}>
          <Send className="h-4 w-4" aria-hidden /> Send email
        </Button>
      </div>
    </dialog>
  );
}
