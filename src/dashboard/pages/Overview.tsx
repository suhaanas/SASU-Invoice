import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Banknote,
  BellRing,
  CheckCircle2,
  Circle,
  FileText,
  PenLine,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { getEditorSyncOrg, getImportMarker } from '../../cloud/prefs';
import { currencyDigits } from '../../core/money';
import { loadInvoices } from '../../core/storage';
import { AgingChart, MonthlyChart } from '../components/Charts';
import { EmailActivity } from '../components/EmailActivity';
import { GettingStarted } from '../components/GettingStarted';
import {
  Alert,
  Button,
  Badge,
  Card,
  CardHeader,
  ComingSoon,
  EmptyState,
  PageHeader,
  Select,
  Skeleton,
  buttonVariants,
  cn,
} from '../components/ui';
import {
  countActiveClients,
  dashboardSummary,
  effectivePlanCode,
  errorMessage,
  getSettings,
  getSubscription,
  listInvoices,
  listMembers,
  listRecentPayments,
  orgCurrencies,
  todayIn,
  askAssistant,
  listEmailMessages,
} from '../lib/api';
import { date, money } from '../lib/format';
import { useSupabase } from '../lib/auth';
import { useAiEnabled } from '../lib/flags';
import { canManage, useActiveOrg } from '../lib/org';

function PlanCard() {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const [now] = useState(() => Date.now());
  const plan = useQuery({
    queryKey: ['subscription', org.id],
    queryFn: () => getSubscription(sb, org.id),
  });
  const used = useQuery({
    queryKey: ['invoices', org.id, 'count'],
    queryFn: () =>
      listInvoices(sb, org.id, { page: 0, search: '', docType: '' }).then((r) => r.total),
  });

  if (plan.isPending) return <Skeleton className="h-36" />;
  if (plan.error) return <Alert tone="danger">{errorMessage(plan.error)}</Alert>;
  const code = effectivePlanCode(plan.data.sub, now);
  const current = plan.data.plans.find((p) => p.code === code);
  const sub = plan.data.sub;
  const trialDays =
    sub?.status === 'trialing' && sub.trial_ends_at
      ? Math.ceil((Date.parse(sub.trial_ends_at) - now) / 86_400_000)
      : null;
  const limit = current?.limits.cloud_invoices ?? 0;
  const count = used.data ?? 0;

  return (
    <Card>
      <CardHeader
        title="Your plan"
        action={
          <Badge tone={code === 'free' ? 'neutral' : 'brand'}>
            {current?.name ?? code}
            {trialDays !== null && trialDays > 0 ? ' trial' : ''}
          </Badge>
        }
      />
      <div className="space-y-4 px-5 py-4 text-sm">
        {trialDays !== null && trialDays > 0 && (
          <p className="text-graphite">
            {trialDays} day{trialDays === 1 ? '' : 's'} left in your trial.
          </p>
        )}
        {code === 'free' && sub?.status === 'trialing' && (
          <Alert tone="warn">
            Your trial has ended. Your cloud documents stay available to read; new cloud documents
            need a paid plan.
          </Alert>
        )}
        <div>
          <div className="flex justify-between">
            <span className="text-graphite">Cloud documents</span>
            <span className="font-semibold">
              {used.isPending ? '…' : count} / {limit}
            </span>
          </div>
          <div
            className="mt-1.5 h-2 overflow-hidden rounded-full bg-hover"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={limit}
            aria-valuenow={count}
            aria-label="Cloud documents used"
          >
            <div
              className={cn('h-full rounded-full', count >= limit ? 'bg-danger' : 'bg-brand')}
              style={{ width: `${limit ? Math.min(100, (count / limit) * 100) : 100}%` }}
            />
          </div>
        </div>
        <Link to="/settings/billing" className="text-sm font-semibold text-brand-ink">
          Plans and billing
        </Link>
      </div>
    </Card>
  );
}

function Checklist() {
  const sb = useSupabase();
  const active = useActiveOrg();
  const settings = useQuery({
    queryKey: ['settings', active.org.id],
    queryFn: () => getSettings(sb, active.org.id),
  });
  const members = useQuery({
    queryKey: ['members', active.org.id],
    queryFn: () => listMembers(sb, active.org.id),
  });
  const hasLocal = loadInvoices().length > 0;

  const items = [
    {
      done: !!active.org.onboarding_completed_at,
      label: 'Set up your business',
      to: '/onboarding',
      show: canManage(active),
    },
    {
      done: !!settings.data?.logo_path,
      label: 'Add your logo',
      to: '/settings/organization',
      show: canManage(active),
    },
    {
      done: getEditorSyncOrg() === active.org.id,
      label: 'Turn on cloud saving in this browser',
      to: '/browser',
      show: true,
    },
    {
      done: !!getImportMarker(active.org.id),
      label: 'Import invoices from this browser',
      to: '/browser',
      show: hasLocal,
    },
    {
      done: (members.data?.length ?? 1) > 1,
      label: 'Invite a teammate',
      to: '/settings/team',
      show: canManage(active),
    },
  ].filter((i) => i.show);

  if (items.every((i) => i.done)) return null;
  return (
    <Card>
      <CardHeader
        title="Getting started"
        description={`${items.filter((i) => i.done).length} of ${items.length} done`}
      />
      <ul className="divide-y divide-rule">
        {items.map((i) => (
          <li key={i.label}>
            <Link to={i.to} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-hover">
              {i.done ? (
                <CheckCircle2 className="h-4 w-4 text-ok" aria-label="Done" />
              ) : (
                <Circle className="h-4 w-4 text-faint" aria-label="To do" />
              )}
              <span className={cn(i.done && 'text-graphite line-through')}>{i.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ReminderActivity() {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const messages = useQuery({
    queryKey: ['emails', org.id, 'overview'],
    queryFn: () => listEmailMessages(sb, org.id, { limit: 5 }),
  });
  return (
    <Card className="min-w-0">
      <CardHeader
        title="Reminder activity"
        action={
          <Link to="/reminders" className="text-sm font-semibold text-brand-ink">
            RecoverFlow AI
          </Link>
        }
      />
      {messages.isPending ? (
        <Skeleton className="m-5 h-20" />
      ) : messages.error ? (
        <div className="p-5">
          <Alert tone="danger">{errorMessage(messages.error)}</Alert>
        </div>
      ) : messages.data.length === 0 ? (
        <EmptyState icon={<BellRing className="h-5 w-5" />} title="No emails yet">
          Turn on automatic reminders to follow up on unpaid invoices for you.
        </EmptyState>
      ) : (
        <EmailActivity messages={messages.data} showInvoice />
      )}
    </Card>
  );
}

function AiSummary({ currency }: { currency: string }) {
  const ai = useAiEnabled();
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const explain = useMutation({
    mutationFn: () =>
      askAssistant<{ summary: string; highlights: string[] }>(sb, {
        action: 'explain_outstanding',
        orgId: org.id,
        currency,
      }),
  });
  if (!ai.enabled) {
    return (
      <Card>
        <CardHeader title="What needs attention" action={<ComingSoon />} />
        <p className="p-5 text-sm text-graphite">
          A plain-language AI summary of what you’re owed and what to follow up first is on its way.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="What needs attention"
        description={`AI summary of your ${currency} receivables, from totals only.`}
        action={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => explain.mutate()}
            loading={explain.isPending}
          >
            <Sparkles className="h-4 w-4" aria-hidden /> {explain.data ? 'Refresh' : 'Explain'}
          </Button>
        }
      />
      <div className="p-5 text-sm">
        {explain.error ? (
          <Alert tone="danger">{errorMessage(explain.error)}</Alert>
        ) : explain.data ? (
          <>
            <p>{explain.data.summary}</p>
            {explain.data.highlights.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-graphite">
                {explain.data.highlights.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-faint">
              AI summaries can be wrong; the figures above are authoritative.
            </p>
          </>
        ) : (
          <p className="text-graphite">
            Get a plain-language summary of what’s owed and what to follow up first. Only totals are
            shared with the AI, never client names.
          </p>
        )}
      </div>
    </Card>
  );
}

function Kpi({
  label,
  value,
  detail,
  tone,
  to,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'danger';
  to?: string;
}) {
  const body = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wide text-faint">{label}</p>
      <p
        className={cn(
          'mt-1 font-display text-xl font-bold tabular-nums',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value}
      </p>
      {detail && <p className="mt-0.5 text-xs text-graphite">{detail}</p>}
    </>
  );
  return to ? (
    <Link to={to} className="block bg-paper px-5 py-4 hover:bg-hover">
      {body}
    </Link>
  ) : (
    <div className="bg-paper px-5 py-4">{body}</div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function MiniList({
  title,
  empty,
  rows,
  to,
}: {
  title: string;
  empty: string;
  rows:
    | {
        key: string;
        to: string;
        primary: string;
        secondary: string;
        amount: string;
        danger?: boolean;
      }[]
    | undefined;
  to?: string;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader
        title={title}
        action={
          to && (
            <Link to={to} className="text-sm font-semibold text-brand-ink">
              View all
            </Link>
          )
        }
      />
      {!rows ? (
        <Skeleton className="m-5 h-24" />
      ) : rows.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-graphite">{empty}</p>
      ) : (
        <ul className="divide-y divide-rule">
          {rows.map((r) => (
            <li key={r.key}>
              <Link
                to={r.to}
                className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-hover"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.primary}</span>
                  <span className={cn('block text-xs', r.danger ? 'text-danger' : 'text-graphite')}>
                    {r.secondary}
                  </span>
                </span>
                <span className="font-semibold tabular-nums">{r.amount}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function OverviewPage() {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const today = todayIn(org.timezone);
  const currencies = useQuery({
    queryKey: ['dashboard', org.id, 'currencies'],
    queryFn: () => orgCurrencies(sb, org.id),
  });
  const [picked, setPicked] = useState<string | null>(null);
  const list = currencies.data ?? [];
  const currency =
    picked && list.includes(picked)
      ? picked
      : list.includes(org.default_currency)
        ? org.default_currency
        : (list[0] ?? org.default_currency);

  const summary = useQuery({
    queryKey: ['dashboard', org.id, 'summary', currency],
    queryFn: () => dashboardSummary(sb, org.id, currency),
    enabled: currencies.isSuccess,
  });
  const clients = useQuery({
    queryKey: ['dashboard', org.id, 'clients'],
    queryFn: () => countActiveClients(sb, org.id),
  });
  const overdue = useQuery({
    queryKey: ['invoices', org.id, 'overdue-top', today],
    queryFn: () =>
      listInvoices(sb, org.id, {
        page: 0,
        search: '',
        docType: '',
        filter: 'overdue',
        sort: 'due',
        today,
      }),
  });
  const upcoming = useQuery({
    queryKey: ['invoices', org.id, 'upcoming', today],
    queryFn: () =>
      listInvoices(sb, org.id, {
        page: 0,
        search: '',
        docType: '',
        filter: 'open',
        sort: 'due',
        today,
      }),
  });
  const payments = useQuery({
    queryKey: ['dashboard', org.id, 'payments'],
    queryFn: () => listRecentPayments(sb, org.id, { limit: 5 }),
  });

  const s = summary.data;
  const m = (minor: number) => money(minor, currency);
  const inWeek = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const hasIssued = list.length > 0;

  return (
    <>
      <PageHeader
        title={org.name}
        description="Figures come from issued invoices and recorded payments."
        actions={
          <>
            <a href="/app.html" className={buttonVariants()}>
              <PenLine className="h-4 w-4" aria-hidden /> New invoice
            </a>
            <Link to="/clients/new" className={buttonVariants({ variant: 'secondary' })}>
              <UserPlus className="h-4 w-4" aria-hidden /> Add client
            </Link>
            <Link
              to="/invoices?filter=open&sort=due"
              className={buttonVariants({ variant: 'secondary' })}
            >
              <Banknote className="h-4 w-4" aria-hidden /> Record payment
            </Link>
          </>
        }
      />

      <GettingStarted />

      {list.length > 1 && (
        <div className="mb-4 flex items-center gap-2 text-sm">
          <label htmlFor="currency" className="text-graphite">
            Currency
          </label>
          <Select
            id="currency"
            className="h-9 w-auto"
            value={currency}
            onChange={(e) => setPicked(e.target.value)}
          >
            {list.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <span className="text-xs text-faint">
            Amounts in different currencies are never added together.
          </span>
        </div>
      )}

      {currencies.error || summary.error ? (
        <Alert tone="danger">{errorMessage(currencies.error ?? summary.error)}</Alert>
      ) : !s ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className="grid grid-cols-2 gap-px bg-rule lg:grid-cols-4">
              <Kpi label="Total invoiced" value={m(s.invoicedMinor)} detail="Issued invoices" />
              <Kpi label="Total paid" value={m(s.paidMinor)} detail="On issued invoices" />
              <Kpi
                label="Outstanding"
                value={m(s.outstandingMinor)}
                detail={plural(s.outstandingCount, 'invoice')}
                to="/invoices?filter=open&sort=due"
              />
              <Kpi
                label="Overdue"
                value={m(s.overdueMinor)}
                detail={plural(s.overdueCount, 'invoice')}
                tone={s.overdueCount > 0 ? 'danger' : undefined}
                to="/invoices?filter=overdue&sort=due"
              />
              <Kpi
                label="Partially paid"
                value={m(s.partialMinor)}
                detail={`${plural(s.partialCount, 'invoice')} · still due`}
                to="/invoices?filter=partial"
              />
              <Kpi
                label="Due in 7 days"
                value={m(s.dueWeekMinor)}
                detail={plural(s.dueWeekCount, 'invoice')}
              />
              <Kpi
                label="Received this month"
                value={m(s.paymentsMonthMinor)}
                detail="Recorded payments"
              />
              <Kpi
                label="Active clients"
                value={clients.data === undefined ? '…' : String(clients.data)}
                detail="All currencies"
                to="/clients"
              />
            </div>
          </Card>

          {hasIssued ? (
            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              <Card className="min-w-0 p-5">
                <MonthlyChart data={s} digits={currencyDigits(currency)} />
              </Card>
              <Card className="p-5">
                <AgingChart data={s} />
              </Card>
            </div>
          ) : (
            <Card>
              <EmptyState icon={<FileText className="h-5 w-5" />} title="No issued invoices yet">
                Charts appear once you issue invoices with cloud saving on, or import the ones in
                this browser.
              </EmptyState>
            </Card>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <MiniList
          title="Overdue"
          empty="Nothing overdue."
          to="/invoices?filter=overdue&sort=due"
          rows={overdue.data?.rows.slice(0, 5).map((r) => ({
            key: r.id,
            to: `/invoices/${r.id}`,
            primary: `${r.number} · ${r.client_name || 'No client'}`,
            secondary: `Due ${date(r.due_date)}`,
            amount: money(r.balance_minor, r.currency),
            danger: true,
          }))}
        />
        <MiniList
          title="Due in the next 7 days"
          empty="Nothing due this week."
          rows={upcoming.data?.rows
            .filter((r) => r.due_date && r.due_date >= today && r.due_date <= inWeek)
            .slice(0, 5)
            .map((r) => ({
              key: r.id,
              to: `/invoices/${r.id}`,
              primary: `${r.number} · ${r.client_name || 'No client'}`,
              secondary: `Due ${date(r.due_date)}`,
              amount: money(r.balance_minor, r.currency),
            }))}
        />
        <MiniList
          title="Recent payments"
          empty="No payments recorded yet."
          rows={payments.data?.map((p) => ({
            key: p.id,
            to: `/invoices/${p.invoice_id}`,
            primary: `${p.invoice?.number ?? ''} · ${p.invoice?.client_name || 'No client'}`,
            secondary: date(p.paid_on),
            amount: money(p.amount_minor, p.currency),
          }))}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ReminderActivity />
        {hasIssued && <AiSummary currency={currency} />}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <PlanCard />
        <Checklist />
      </div>
    </>
  );
}
