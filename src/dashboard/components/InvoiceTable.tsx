import { ExternalLink, Trash2 } from 'lucide-react';
import { Link } from 'react-router';
import { formatMoney } from '../../core/money';
import { formatDate, todayISO } from '../../core/dates';
import { setEditorSyncOrg } from '../../cloud/prefs';
import type { CloudInvoiceRow } from '../lib/api';
import { Badge, Button } from './ui';

const TYPE_LABEL: Record<CloudInvoiceRow['doc_type'], string> = {
  invoice: 'Invoice',
  quote: 'Quote',
  credit: 'Credit note',
  receipt: 'Receipt',
  proforma: 'Proforma',
};

/**
 * Status as people read it: Overdue (unpaid and past due, as in the editor's
 * effectiveStatus) wins over Partially paid, which wins over the stored status.
 */
export function displayStatus(
  row: Pick<CloudInvoiceRow, 'doc_type' | 'status' | 'due_date' | 'paid_minor' | 'balance_minor'>,
  today = todayISO(),
): string {
  if (row.doc_type !== 'invoice' || !['Unpaid', 'Overdue'].includes(row.status)) return row.status;
  if (row.due_date && row.due_date < today && row.balance_minor > 0) return 'Overdue';
  if (row.paid_minor > 0 && row.balance_minor > 0) return 'Partially paid';
  return row.status;
}

export const STATUS_TONE: Record<string, 'neutral' | 'brand' | 'ok' | 'warn' | 'danger'> = {
  Draft: 'neutral',
  Unpaid: 'warn',
  Overdue: 'danger',
  'Partially paid': 'brand',
  Paid: 'ok',
  Accepted: 'ok',
  Issued: 'brand',
  Sent: 'brand',
  Cancelled: 'neutral',
  Declined: 'neutral',
  Expired: 'neutral',
};

const money = (minor: number, currency: string) => formatMoney(minor, currency, 'en-GB');

export function InvoiceTable({
  orgId,
  rows,
  compact,
  onDelete,
  today = todayISO(),
}: {
  orgId: string;
  rows: CloudInvoiceRow[];
  compact?: boolean;
  onDelete?: (row: CloudInvoiceRow) => void;
  /** The organization's calendar date (todayIn(org.timezone)), for Overdue. */
  today?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-faint">
            <th scope="col" className="px-5 py-2.5">
              Number
            </th>
            <th scope="col" className="px-3 py-2.5">
              Client
            </th>
            {!compact && (
              <th scope="col" className="px-3 py-2.5">
                Issued
              </th>
            )}
            {!compact && (
              <th scope="col" className="px-3 py-2.5">
                Due
              </th>
            )}
            <th scope="col" className="px-3 py-2.5">
              Status
            </th>
            <th scope="col" className="px-3 py-2.5 text-right">
              Total
            </th>
            {!compact && (
              <th scope="col" className="px-3 py-2.5 text-right">
                Balance
              </th>
            )}
            <th scope="col" className="px-5 py-2.5">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {rows.map((r) => {
            const status = displayStatus(r, today);
            return (
              <tr key={r.id} className="hover:bg-hover/60">
                <td className="px-5 py-3">
                  <Link
                    to={`/invoices/${r.id}`}
                    className="font-semibold text-ink hover:text-brand-ink hover:underline"
                  >
                    {r.number || '—'}
                  </Link>
                  <div className="text-xs text-faint">{TYPE_LABEL[r.doc_type]}</div>
                </td>
                <td className="max-w-48 truncate px-3 py-3">
                  {r.client_name || <span className="text-faint">No client</span>}
                </td>
                {!compact && (
                  <td className="whitespace-nowrap px-3 py-3 text-graphite">
                    {r.issue_date ? formatDate(r.issue_date, 'en-GB') : '—'}
                  </td>
                )}
                {!compact && (
                  <td className="whitespace-nowrap px-3 py-3 text-graphite">
                    {r.due_date ? formatDate(r.due_date, 'en-GB') : '—'}
                  </td>
                )}
                <td className="px-3 py-3">
                  <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{status}</Badge>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">
                  {money(r.total_minor, r.currency)}
                </td>
                {!compact && (
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                    {money(r.balance_minor, r.currency)}
                  </td>
                )}
                <td className="px-5 py-3">
                  <div className="flex justify-end gap-1">
                    <a
                      href={`/app.html?doc=${r.id}`}
                      // Editing a cloud document means saving back to its organization.
                      onClick={() => setEditorSyncOrg(orgId)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-brand-ink hover:bg-brand-wash"
                      aria-label={`Open ${r.number} in the editor`}
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open
                    </a>
                    {onDelete && !r.issued_at && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Delete draft ${r.number}`}
                        onClick={() => onDelete(r)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
