/**
 * Reports for a date range and currency: what was invoiced, what was received,
 * what is still owed, top clients, email and recurring activity. Every table
 * exports to CSV; the page prints cleanly (Save as PDF).
 *
 * These are invoicing and cash figures, not accounting revenue.
 */
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { useState } from 'react';
import { toCsv } from '../../core/csv';
import { addDays, addMonths, todayISO } from '../../core/dates';
import { currencyDigits, fromMinor } from '../../core/money';
import { downloadBlob } from '../../ui/dom';
import { MonthlyChart } from '../components/Charts';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from '../components/ui';
import {
  errorMessage,
  invoicesInRange,
  listMembers,
  orgCurrencies,
  paymentsInRange,
  reportSummary,
  todayIn,
} from '../lib/api';
import { useSupabase } from '../lib/auth';
import { date, money, monthLabel } from '../lib/format';
import { canManage, useActiveOrg } from '../lib/org';
import { useToast } from '../lib/toast';

type Preset = 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'last_12' | 'custom';

export function rangeFor(preset: Preset, today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const monthStart = `${today.slice(0, 7)}-01`;
  const endOfMonth = (start: string) => addDays(addMonths(start, 1), -1);
  switch (preset) {
    case 'last_month': {
      const start = addMonths(monthStart, -1);
      return { from: start, to: endOfMonth(start) };
    }
    case 'this_quarter': {
      const qStart = `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
      return { from: qStart, to: today };
    }
    case 'this_year':
      return { from: `${y}-01-01`, to: today };
    case 'last_12':
      return { from: addMonths(monthStart, -11), to: today };
    default:
      return { from: monthStart, to: today };
  }
}

const decimal = (minor: number, currency: string) =>
  fromMinor(minor, currency).toFixed(currencyDigits(currency));

function csvDownload(name: string, rows: (string | number)[][]) {
  downloadBlob(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), name);
}

export function ReportsPage() {
  const sb = useSupabase();
  const active = useActiveOrg();
  const { org } = active;
  const toast = useToast();
  const today = todayIn(org.timezone);
  const [preset, setPreset] = useState<Preset>('this_year');
  const [custom, setCustom] = useState(() => ({ from: addMonths(today, -1), to: today }));
  const [clientId, setClientId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const range = preset === 'custom' ? custom : rangeFor(preset, today);

  const currencies = useQuery({
    queryKey: ['dashboard', org.id, 'currencies'],
    queryFn: () => orgCurrencies(sb, org.id),
  });
  const list = currencies.data ?? [];
  const currency =
    picked ??
    (list.includes(org.default_currency)
      ? org.default_currency
      : (list[0] ?? org.default_currency));
  const clients = useQuery({
    queryKey: ['report-clients', org.id],
    queryFn: async () => {
      const { data, error } = await sb
        .from('clients')
        .select('id, name, company')
        .eq('org_id', org.id)
        .order('company')
        .limit(500);
      if (error) throw error;
      return data as { id: string; name: string; company: string }[];
    },
  });
  const members = useQuery({
    queryKey: ['members', org.id],
    queryFn: () => listMembers(sb, org.id),
    enabled: canManage(active),
  });

  const filters = {
    currency,
    from: range.from,
    to: range.to,
    clientId: clientId || null,
    memberId: memberId || null,
  };
  const report = useQuery({
    queryKey: ['report', org.id, filters],
    queryFn: () => reportSummary(sb, org.id, filters),
    enabled: currencies.isSuccess && range.from <= range.to,
  });
  const r = report.data;
  const m = (minor: number) => money(minor, currency);
  const tag = `${range.from}_${range.to}_${currency}`;

  const exportInvoices = async () => {
    try {
      const rows = await invoicesInRange(sb, org.id, filters);
      csvDownload(`invoices_${tag}.csv`, [
        [
          'number',
          'type',
          'status',
          'issue_date',
          'due_date',
          'client',
          'currency',
          'total',
          'paid',
          'balance',
        ],
        ...rows.map((i) => [
          i.number,
          i.doc_type,
          i.status,
          i.issue_date ?? '',
          i.due_date ?? '',
          i.client_name,
          i.currency,
          decimal(i.total_minor, i.currency),
          decimal(i.paid_minor, i.currency),
          decimal(i.balance_minor, i.currency),
        ]),
      ]);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };
  const exportPayments = async () => {
    try {
      const rows = await paymentsInRange(sb, org.id, filters);
      csvDownload(`payments_${tag}.csv`, [
        ['paid_on', 'invoice', 'client', 'method', 'reference', 'currency', 'amount'],
        ...rows.map((p) => [
          p.paid_on,
          p.invoice?.number ?? '',
          p.invoice?.client_name ?? '',
          p.method,
          p.reference,
          p.currency,
          decimal(p.amount_minor, p.currency),
        ]),
      ]);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <>
      <PageHeader
        title="Reports"
        description={`${date(range.from)} – ${date(range.to)} · ${currency}`}
        actions={
          <Button variant="secondary" onClick={() => window.print()} className="print:hidden">
            <Printer className="h-4 w-4" aria-hidden /> Print or save as PDF
          </Button>
        }
      />

      <Card className="mb-6 print:hidden">
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Period">
            {(p) => (
              <Select {...p} value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
                <option value="this_month">This month</option>
                <option value="last_month">Last month</option>
                <option value="this_quarter">This quarter</option>
                <option value="this_year">This year</option>
                <option value="last_12">Last 12 months</option>
                <option value="custom">Custom…</option>
              </Select>
            )}
          </Field>
          {preset === 'custom' && (
            <>
              <Field label="From">
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    max={custom.to}
                    value={custom.from}
                    onChange={(e) => setCustom({ ...custom, from: e.target.value })}
                  />
                )}
              </Field>
              <Field label="To">
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    min={custom.from}
                    max={todayISO()}
                    value={custom.to}
                    onChange={(e) => setCustom({ ...custom, to: e.target.value })}
                  />
                )}
              </Field>
            </>
          )}
          <Field label="Currency">
            {(p) => (
              <Select {...p} value={currency} onChange={(e) => setPicked(e.target.value)}>
                {(list.length ? list : [org.default_currency]).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Client">
            {(p) => (
              <Select {...p} value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">All clients</option>
                {(clients.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company || c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {canManage(active) && (
            <Field label="Created by">
              {(p) => (
                <Select {...p} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                  <option value="">Anyone</option>
                  {(members.data ?? []).map((mem) => (
                    <option key={mem.user_id} value={mem.user_id}>
                      {mem.profile?.full_name || mem.profile?.email}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
      </Card>

      {report.isPending ? (
        <Skeleton className="h-96" />
      ) : report.error ? (
        <Alert tone="danger">{errorMessage(report.error)}</Alert>
      ) : !r ? null : (
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <dl className="grid grid-cols-2 gap-px bg-rule lg:grid-cols-5">
              {[
                ['Invoiced', m(r.invoicedMinor), `${r.invoiceCount} issued invoices`],
                ['Credit notes', m(r.creditedMinor), 'Issued in the period'],
                ['Received', m(r.receivedMinor), `${r.paymentCount} recorded payments`],
                ['Still owed', m(r.outstandingMinor), 'On invoices from this period'],
                ['Overdue', m(r.overdueMinor), 'Past due today'],
              ].map(([label, value, detail]) => (
                <div key={label} className="bg-paper px-5 py-4">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-faint">
                    {label}
                  </dt>
                  <dd className="mt-1 font-display text-xl font-bold tabular-nums">{value}</dd>
                  <dd className="text-xs text-graphite">{detail}</dd>
                </div>
              ))}
            </dl>
            <p className="border-t border-rule px-5 py-3 text-xs text-graphite">
              Invoiced shows what you billed, received shows money you recorded as paid. Neither is
              accounting revenue; share the CSV exports with your accountant.
            </p>
          </Card>

          <Card className="p-5">
            <MonthlyChart
              data={r}
              digits={currencyDigits(currency)}
              period={`${date(range.from)} – ${date(range.to)}`}
            />
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="By month"
                action={
                  <Button
                    size="sm"
                    variant="ghost"
                    className="print:hidden"
                    onClick={() =>
                      csvDownload(`monthly_${tag}.csv`, [
                        ['month', 'currency', 'invoiced', 'credited', 'received'],
                        ...r.monthly.map((x) => [
                          x.month,
                          currency,
                          decimal(x.invoicedMinor, currency),
                          decimal(x.creditedMinor, currency),
                          decimal(x.receivedMinor, currency),
                        ]),
                      ])
                    }
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden /> CSV
                  </Button>
                }
              />
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-faint">
                    <th scope="col" className="px-5 py-2">
                      Month
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Invoiced
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Credited
                    </th>
                    <th scope="col" className="px-5 py-2 text-right">
                      Received
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {r.monthly.map((x) => (
                    <tr key={x.month}>
                      <th scope="row" className="px-5 py-2 text-left font-medium">
                        {monthLabel(x.month, true)}
                      </th>
                      <td className="px-3 py-2 text-right tabular-nums">{m(x.invoicedMinor)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{m(x.creditedMinor)}</td>
                      <td className="px-5 py-2 text-right tabular-nums">{m(x.receivedMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card>
              <CardHeader
                title="Top clients"
                action={
                  <Button
                    size="sm"
                    variant="ghost"
                    className="print:hidden"
                    onClick={() =>
                      csvDownload(`top_clients_${tag}.csv`, [
                        ['client', 'invoices', 'currency', 'invoiced', 'still_owed'],
                        ...r.topClients.map((c) => [
                          c.name,
                          c.count,
                          currency,
                          decimal(c.invoicedMinor, currency),
                          decimal(c.outstandingMinor, currency),
                        ]),
                      ])
                    }
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden /> CSV
                  </Button>
                }
              />
              {r.topClients.length === 0 ? (
                <EmptyState
                  icon={<Download className="h-5 w-5" />}
                  title="No invoices in this period"
                />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-faint">
                      <th scope="col" className="px-5 py-2">
                        Client
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Invoiced
                      </th>
                      <th scope="col" className="px-5 py-2 text-right">
                        Still owed
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">
                    {r.topClients.map((c) => (
                      <tr key={c.clientId}>
                        <td className="max-w-48 truncate px-5 py-2">{c.name || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{m(c.invoicedMinor)}</td>
                        <td className="px-5 py-2 text-right tabular-nums">
                          {m(c.outstandingMinor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <Card>
              <CardHeader title="Invoices from this period" />
              <dl className="space-y-2 p-5 text-sm">
                {[
                  ['Paid in full', r.statusCounts.paid],
                  ['Partially paid', r.statusCounts.partial],
                  ['Unpaid', r.statusCounts.unpaid],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <dt className="text-graphite">{k}</dt>
                    <dd className="font-semibold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
            <Card>
              <CardHeader title="Emails" />
              <dl className="space-y-2 p-5 text-sm">
                {[
                  ['Sent by your team', r.emails.manual],
                  ['Automatic reminders', r.emails.automatic],
                  ['Confirmed delivered', r.emails.delivered],
                  ['Bounced or failed', r.emails.problems],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <dt className="text-graphite">{k}</dt>
                    <dd className="font-semibold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
            <Card>
              <CardHeader title="Recurring" />
              <dl className="space-y-2 p-5 text-sm">
                {[
                  ['Active schedules', r.recurring.active],
                  ['Invoices created in period', r.recurring.generated],
                  ['Due in the next 30 days', r.recurring.upcoming30],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <dt className="text-graphite">{k}</dt>
                    <dd className="font-semibold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>

          <Card className="print:hidden">
            <CardHeader
              title="Export details"
              description="Every issued invoice or payment in the period, for your accountant."
            />
            <div className="flex flex-wrap gap-2 p-5">
              <Button variant="secondary" onClick={() => void exportInvoices()}>
                <Download className="h-4 w-4" aria-hidden /> Invoices CSV
              </Button>
              <Button variant="secondary" onClick={() => void exportPayments()}>
                <Download className="h-4 w-4" aria-hidden /> Payments CSV
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
