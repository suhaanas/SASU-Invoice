/**
 * One cloud document: amounts, payments (record / void), client share links
 * and history. Amounts and status are computed in the database; this page
 * only displays them and calls the audited RPCs.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, ExternalLink, Link2, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { setEditorSyncOrg } from '../../cloud/prefs';
import { currencyDigits, parseAmount } from '../../core/money';
import { InvoiceRecoverFlow } from '../components/InvoiceRecoverFlow';
import { STATUS_TONE, displayStatus } from '../components/InvoiceTable';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  Textarea,
  buttonVariants,
} from '../components/ui';
import {
  PAYMENT_METHODS,
  createShare,
  errorMessage,
  getInvoice,
  invoiceHistory,
  listPayments,
  listShares,
  recordPayment,
  revokeShare,
  shareUrl,
  todayIn,
  voidPayment,
  type InvoiceDetail,
  type PaymentMethod,
  type PaymentRow,
} from '../lib/api';
import { useSupabase } from '../lib/auth';
import { date, dateTime, money } from '../lib/format';
import { canManage, useActiveOrg } from '../lib/org';
import { useToast } from '../lib/toast';

const TYPE_LABEL: Record<InvoiceDetail['doc_type'], string> = {
  invoice: 'Invoice',
  quote: 'Quote',
  credit: 'Credit note',
  receipt: 'Receipt',
  proforma: 'Proforma invoice',
};

export function InvoiceDetailPage() {
  const { id = '' } = useParams();
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const invoice = useQuery({ queryKey: ['invoice', id], queryFn: () => getInvoice(sb, id) });

  if (invoice.isPending) return <Skeleton className="h-96" />;
  if (invoice.error) return <Alert tone="danger">{errorMessage(invoice.error)}</Alert>;
  if (!invoice.data) {
    return (
      <Card>
        <EmptyState icon={<ExternalLink className="h-5 w-5" />} title="Document not found">
          It may have been deleted, or it belongs to another organization.
        </EmptyState>
      </Card>
    );
  }
  const inv = invoice.data;
  const today = todayIn(org.timezone);
  const status = displayStatus(inv, today);
  const payable = inv.doc_type === 'invoice' && !!inv.issued_at && inv.status !== 'Cancelled';

  return (
    <>
      <Link
        to="/invoices"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-graphite hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Invoices
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-graphite">{TYPE_LABEL[inv.doc_type]}</p>
          <h1 className="flex flex-wrap items-center gap-3 font-display text-2xl font-bold">
            {inv.number || 'Untitled'}
            <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{status}</Badge>
            {!inv.issued_at && <Badge>Draft</Badge>}
          </h1>
          {inv.client_id ? (
            <Link
              to={`/clients/${inv.client_id}`}
              className="mt-1 inline-block text-sm font-medium text-brand-ink"
            >
              {inv.client_name}
            </Link>
          ) : (
            <p className="mt-1 text-sm text-faint">No client</p>
          )}
        </div>
        <a
          href={`/app.html?doc=${inv.id}`}
          onClick={() => setEditorSyncOrg(org.id)}
          className={buttonVariants({ variant: 'secondary' })}
        >
          <ExternalLink className="h-4 w-4" aria-hidden /> Open in editor
        </a>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-rule sm:grid-cols-4">
              {[
                ['Total', money(inv.total_minor, inv.currency)],
                ['Paid', money(inv.paid_minor, inv.currency)],
                ['Balance due', money(inv.balance_minor, inv.currency)],
                ['Due date', date(inv.due_date)],
              ].map(([label, value]) => (
                <div key={label} className="bg-paper px-5 py-4">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-faint">
                    {label}
                  </dt>
                  <dd className="mt-1 font-display text-lg font-bold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="border-t border-rule px-5 py-3 text-xs text-graphite">
              Issued {date(inv.issue_date)} · {inv.currency} · last updated{' '}
              {dateTime(inv.updated_at)}
            </p>
          </Card>
          <PaymentsCard invoice={inv} payable={payable} />
          <InvoiceRecoverFlow invoice={inv} />
        </div>
        <div className="space-y-6">
          <ShareCard invoice={inv} />
          <HistoryCard invoiceId={inv.id} />
        </div>
      </div>
    </>
  );
}

const METHOD_LABEL = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.value, m.label])) as Record<
  PaymentMethod,
  string
>;

function PaymentsCard({ invoice, payable }: { invoice: InvoiceDetail; payable: boolean }) {
  const sb = useSupabase();
  const active = useActiveOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const payments = useQuery({
    queryKey: ['payments', invoice.id],
    queryFn: () => listPayments(sb, invoice.id),
  });
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<PaymentRow | null>(null);
  const [reason, setReason] = useState('');

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['invoice', invoice.id] }),
      qc.invalidateQueries({ queryKey: ['payments', invoice.id] }),
      qc.invalidateQueries({ queryKey: ['history', invoice.id] }),
      qc.invalidateQueries({ queryKey: ['invoices'] }),
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);

  const voidMut = useMutation({
    mutationFn: () => voidPayment(sb, voiding!.id, reason),
    onSuccess: async () => {
      setVoiding(null);
      setReason('');
      toast('Payment voided');
      await refresh();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  return (
    <Card>
      <CardHeader
        title="Payments"
        description={
          payable ? 'Record money as it arrives. Corrections are made by voiding.' : undefined
        }
        action={
          payable &&
          invoice.balance_minor > 0 &&
          !adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Record payment
            </Button>
          )
        }
      />
      {!payable && (
        <div className="p-5">
          <Alert tone="info">
            {invoice.issued_at
              ? 'Payments are recorded on invoices only.'
              : 'Issue this invoice in the editor before recording payments.'}
          </Alert>
        </div>
      )}
      {adding && (
        <PaymentForm
          invoice={invoice}
          onDone={async (saved) => {
            setAdding(false);
            if (saved) {
              toast('Payment recorded');
              await refresh();
            }
          }}
        />
      )}
      {payments.isPending ? (
        <Skeleton className="m-5 h-16" />
      ) : payments.error ? (
        <div className="p-5">
          <Alert tone="danger">{errorMessage(payments.error)}</Alert>
        </div>
      ) : payments.data.length === 0 ? (
        payable && (
          <p className="px-5 py-6 text-center text-sm text-graphite">No payments recorded yet.</p>
        )
      ) : (
        <ul className="divide-y divide-rule">
          {payments.data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p
                  className={p.voided_at ? 'text-faint line-through' : 'font-semibold tabular-nums'}
                >
                  {money(p.amount_minor, p.currency)}
                </p>
                <p className="text-xs text-graphite">
                  {date(p.paid_on)} · {METHOD_LABEL[p.method]}
                  {p.reference && ` · ${p.reference}`}
                  {p.source === 'opening_balance' && ' · carried over'}
                </p>
                {p.notes && <p className="mt-0.5 text-xs text-graphite">{p.notes}</p>}
                {p.voided_at && (
                  <p className="mt-0.5 text-xs text-danger">
                    Voided {date(p.voided_at)}: {p.void_reason}
                  </p>
                )}
              </div>
              {!p.voided_at && canManage(active) && (
                <Button variant="ghost" size="sm" onClick={() => setVoiding(p)}>
                  Void
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!voiding}
        title="Void this payment?"
        confirmLabel="Void payment"
        tone="danger"
        loading={voidMut.isPending}
        onCancel={() => {
          setVoiding(null);
          setReason('');
        }}
        onConfirm={() => voidMut.mutate()}
      >
        <p>
          The payment of {voiding && money(voiding.amount_minor, voiding.currency)} stays in the
          history, marked as voided, and the balance goes back up.
        </p>
        <div className="mt-3">
          <Field label="Reason">
            {(p) => (
              <Input
                {...p}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
        </div>
      </ConfirmDialog>
    </Card>
  );
}

function PaymentForm({
  invoice,
  onDone,
}: {
  invoice: InvoiceDetail;
  onDone: (saved: boolean) => void;
}) {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const digits = currencyDigits(invoice.currency);
  const [amount, setAmount] = useState((invoice.balance_minor / 10 ** digits).toFixed(digits));
  const [paidOn, setPaidOn] = useState(todayIn(org.timezone));
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (amountMinor: number) =>
      recordPayment(sb, { invoiceId: invoice.id, amountMinor, paidOn, method, reference, notes }),
    onSuccess: () => onDone(true),
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const minor = parseAmount(amount, invoice.currency);
    if (minor === null || minor <= 0) {
      return setError(
        `Enter an amount like ${(1234.5).toFixed(digits)} (up to ${digits} decimals).`,
      );
    }
    if (minor > invoice.balance_minor) {
      return setError(
        `That’s more than the balance due (${money(invoice.balance_minor, invoice.currency)}).`,
      );
    }
    setError(null);
    save.mutate(minor);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4 border-b border-rule bg-canvas/60 p-5">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={`Amount (${invoice.currency})`}>
          {(p) => (
            <Input
              {...p}
              inputMode="decimal"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
        <Field label="Received on">
          {(p) => (
            <Input
              {...p}
              type="date"
              max={todayIn(org.timezone)}
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
          )}
        </Field>
        <Field label="Method">
          {(p) => (
            <Select
              {...p}
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Reference" hint="Bank reference, transaction ID or cheque number.">
        {(p) => (
          <Input
            {...p}
            maxLength={120}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        )}
      </Field>
      <Field label="Internal note">
        {(p) => (
          <Textarea
            {...p}
            rows={2}
            maxLength={1000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => onDone(false)} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          Save payment
        </Button>
      </div>
    </form>
  );
}

function ShareCard({ invoice }: { invoice: InvoiceDetail }) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const toast = useToast();
  const shares = useQuery({
    queryKey: ['shares', invoice.id],
    queryFn: () => listShares(sb, invoice.id),
  });
  const [days, setDays] = useState('30');
  const [link, setLink] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const create = useMutation({
    mutationFn: () => createShare(sb, invoice.id, Number(days)),
    onSuccess: (token) => {
      setLink(shareUrl(token));
      void qc.invalidateQueries({ queryKey: ['shares', invoice.id] });
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  const revoke = useMutation({
    mutationFn: (shareId: string) => revokeShare(sb, shareId),
    onSuccess: () => {
      toast('Link turned off');
      void qc.invalidateQueries({ queryKey: ['shares', invoice.id] });
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  const live = (shares.data ?? []).filter((s) => !s.revoked_at && Date.parse(s.expires_at) > now);

  return (
    <Card>
      <CardHeader
        title="Share with your client"
        description="A private link to view and download this document."
      />
      <div className="space-y-4 p-5 text-sm">
        {!invoice.issued_at ? (
          <Alert tone="info">Issue the document in the editor before sharing it.</Alert>
        ) : (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="Link works for">
                {(p) => (
                  <Select {...p} value={days} onChange={(e) => setDays(e.target.value)}>
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="365">1 year</option>
                  </Select>
                )}
              </Field>
            </div>
            <Button onClick={() => create.mutate()} loading={create.isPending}>
              <Link2 className="h-4 w-4" aria-hidden /> Create link
            </Button>
          </div>
        )}
        {link && (
          <Alert tone="ok">
            <p className="font-semibold">Copy this link now. For security it isn’t shown again.</p>
            <div className="mt-2 flex gap-2">
              <Input
                readOnly
                value={link}
                aria-label="Share link"
                onFocus={(e) => e.target.select()}
                className="text-ink"
              />
              <Button
                variant="secondary"
                aria-label="Copy share link"
                onClick={() =>
                  void navigator.clipboard.writeText(link).then(() => toast('Link copied'))
                }
              >
                <Copy className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </Alert>
        )}
        {live.length > 0 && (
          <ul className="divide-y divide-rule rounded-lg border border-rule">
            {live.map((s) => (
              <li key={s.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1 text-xs text-graphite">
                  <p>Expires {date(s.expires_at)}</p>
                  <p>
                    {s.view_count === 0
                      ? 'Not opened yet'
                      : `Opened ${s.view_count}× · last ${dateTime(s.last_viewed_at!)}`}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={revoke.isPending && revoke.variables === s.id}
                  onClick={() => revoke.mutate(s.id)}
                >
                  Turn off
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

const ACTION_LABEL: Record<string, string> = {
  'invoice.created': 'Saved to the cloud',
  'invoice.issued': 'Issued',
  'invoice.status_changed': 'Status changed',
  'invoice.unlocked': 'Unlocked for editing',
  'invoice.deleted': 'Deleted',
  'payment.recorded': 'Payment recorded',
  'payment.voided': 'Payment voided',
  'email.sent': 'Email sent',
  'reminders.paused': 'Reminders paused',
  'reminders.resumed': 'Reminders resumed',
  'reminders.client_opted_out': 'Client opted out of reminders',
  'dispute.opened': 'Marked as disputed',
  'dispute.resolved': 'Dispute resolved',
  'share.created': 'Share link created',
  'share.revoked': 'Share link turned off',
};

function HistoryCard({ invoiceId }: { invoiceId: string }) {
  const sb = useSupabase();
  const history = useQuery({
    queryKey: ['history', invoiceId],
    queryFn: () => invoiceHistory(sb, invoiceId),
  });
  return (
    <Card>
      <CardHeader title="History" />
      {history.isPending ? (
        <Skeleton className="m-5 h-20" />
      ) : history.error ? (
        <div className="p-5">
          <Alert tone="danger">{errorMessage(history.error)}</Alert>
        </div>
      ) : history.data.length === 0 ? (
        <p className="px-5 py-4 text-sm text-graphite">No history yet.</p>
      ) : (
        <ol className="space-y-3 px-5 py-4 text-sm">
          {history.data.map((h) => (
            <li key={h.id}>
              <p className="font-medium">
                {ACTION_LABEL[h.action] ?? h.action}
                {h.action === 'invoice.status_changed' && ` to ${String(h.metadata.to)}`}
              </p>
              <p className="text-xs text-graphite">{dateTime(h.created_at)}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
