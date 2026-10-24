import { useState } from 'react';
import { EMAIL_KIND_LABELS } from '../../core/emails';
import type { EmailMessageRow, EmailStatus } from '../lib/api';
import { dateTime } from '../lib/format';
import { Badge, Button } from './ui';

/** Provider states, worded so "accepted" is never mistaken for "delivered". */
export const EMAIL_STATUS: Record<
  EmailStatus,
  { label: string; tone: 'neutral' | 'brand' | 'ok' | 'warn' | 'danger' }
> = {
  queued: { label: 'Queued', tone: 'neutral' },
  accepted: { label: 'Accepted by provider', tone: 'brand' },
  sent: { label: 'Sent', tone: 'brand' },
  delivery_delayed: { label: 'Delivery delayed', tone: 'warn' },
  delivered: { label: 'Delivered', tone: 'ok' },
  bounced: { label: 'Bounced', tone: 'danger' },
  complained: { label: 'Marked as spam', tone: 'danger' },
  failed: { label: 'Failed', tone: 'danger' },
};

export function EmailActivity({
  messages,
  showInvoice,
  onRetry,
}: {
  messages: EmailMessageRow[];
  showInvoice?: boolean;
  onRetry?: (m: EmailMessageRow) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="divide-y divide-rule">
      {messages.map((m) => {
        const status = EMAIL_STATUS[m.status];
        return (
          <li key={m.id} className="px-5 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{m.subject || EMAIL_KIND_LABELS[m.kind]}</p>
                <p className="text-xs text-graphite">
                  {m.reminder_job_id ? 'Automatic reminder' : EMAIL_KIND_LABELS[m.kind]} · to{' '}
                  {m.to_email} · {dateTime(m.created_at)}
                  {showInvoice && m.invoice && ` · ${m.invoice.number}`}
                </p>
              </div>
              <Badge tone={status.tone}>{status.label}</Badge>
              {m.body_text && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={open === m.id}
                  onClick={() => setOpen(open === m.id ? null : m.id)}
                >
                  {open === m.id ? 'Hide' : 'View'}
                </Button>
              )}
              {onRetry && m.status === 'failed' && !m.reminder_job_id && (
                <Button variant="secondary" size="sm" onClick={() => onRetry(m)}>
                  Retry
                </Button>
              )}
            </div>
            {m.error && <p className="mt-1 text-xs text-danger">{m.error}</p>}
            {open === m.id && (
              <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-canvas p-3 text-xs text-ink">
                {m.body_text}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
