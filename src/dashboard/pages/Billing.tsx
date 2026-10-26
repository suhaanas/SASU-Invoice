/**
 * Plan, usage and subscription management. Payments are handled by Paddle
 * (merchant of record). The plan shown here changes only after Paddle's signed
 * webhook confirms it, never because someone came back from the checkout page.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, ExternalLink, FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  PageHeader,
  Skeleton,
  cn,
} from '../components/ui';
import {
  billing,
  countInvoices,
  countMembers,
  effectivePlanCode,
  errorMessage,
  getSubscription,
  monthlyUsage,
  planChangeProblems,
  type BillingInvoice,
  type Plan,
  type Subscription,
} from '../lib/api';
import { useAuth, useSupabase } from '../lib/auth';
import { saveCheckoutPrefill } from '../../cloud/checkout';
import { date, money } from '../lib/format';
import { useActiveOrg } from '../lib/org';
import { useLiveStatus } from '../lib/realtime';
import { useToast } from '../lib/toast';

const PAID_STATUSES = new Set(['active', 'past_due', 'canceled']);

function statusLine(
  sub: Subscription | null,
  planName: string,
  now: number,
): { text: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' } {
  if (!sub) return { text: 'Free plan', tone: 'neutral' };
  const ends = sub.current_period_end ? date(sub.current_period_end) : null;
  switch (sub.status) {
    case 'trialing': {
      const days = sub.trial_ends_at
        ? Math.ceil((Date.parse(sub.trial_ends_at) - now) / 86_400_000)
        : 0;
      return days > 0
        ? { text: `${planName} trial, ${days} day${days === 1 ? '' : 's'} left`, tone: 'neutral' }
        : { text: 'Your trial has ended', tone: 'warn' };
    }
    case 'active':
      return sub.cancel_at_period_end
        ? { text: `${planName}, cancels on ${ends}`, tone: 'warn' }
        : { text: `${planName}, renews on ${ends}`, tone: 'ok' };
    case 'past_due':
      return {
        text: 'Payment failed. Update your payment method to keep your plan.',
        tone: 'danger',
      };
    case 'canceled':
      return sub.current_period_end && Date.parse(sub.current_period_end) > now
        ? { text: `${planName}, cancelled; access until ${ends}`, tone: 'warn' }
        : { text: 'Subscription ended', tone: 'neutral' };
    default:
      return { text: 'No active subscription', tone: 'neutral' };
  }
}

export function BillingPage() {
  const sb = useSupabase();
  const { user } = useAuth();
  const active = useActiveOrg();
  const { org } = active;
  const owner = active.role === 'owner';
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [now] = useState(() => Date.now());
  // Waiting for Paddle's webhook after a checkout or change. `waitingFrom` is the
  // subscription state when we started waiting (null after a checkout redirect).
  const [waiting, setWaiting] = useState(params.get('checkout') === 'done');
  const [waitingFrom, setWaitingFrom] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Plan | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const plan = useQuery({
    queryKey: ['subscription', org.id],
    queryFn: () => getSubscription(sb, org.id),
  });
  const subKey = (s: Subscription | null | undefined) =>
    `${s?.status}:${s?.plan_code}:${s?.cancel_at_period_end}`;
  const currentKey = subKey(plan.data?.sub);
  const confirmed =
    waiting &&
    !!plan.data?.sub &&
    PAID_STATUSES.has(plan.data.sub.status) &&
    (waitingFrom === null || currentKey !== waitingFrom);
  // Wait for the webhook to land (or two minutes). With live updates on, the
  // change arrives by itself; otherwise poll.
  const { refetch } = plan;
  const live = useLiveStatus() === 'live';
  useEffect(() => {
    if (!waiting || confirmed) return;
    const poll = live ? undefined : setInterval(() => void refetch(), 4000);
    const stop = setTimeout(() => setWaiting(false), 120_000);
    return () => {
      clearInterval(poll);
      clearTimeout(stop);
    };
  }, [waiting, confirmed, refetch, live]);
  const startWaiting = () => {
    setWaitingFrom(currentKey);
    setWaiting(true);
    if (params.has('checkout')) setParams({}, { replace: true });
  };
  const usage = useQuery({
    queryKey: ['billing-usage', org.id],
    queryFn: async () => {
      const [monthly, invoices, users] = await Promise.all([
        monthlyUsage(sb, org.id),
        countInvoices(sb, org.id),
        countMembers(sb, org.id),
      ]);
      return { emails: monthly.email_sends ?? 0, ai: monthly.ai_requests ?? 0, invoices, users };
    },
  });

  const select = useMutation({
    mutationFn: (p: Plan) =>
      billing<{ checkoutUrl?: string; changed?: boolean }>(sb, {
        action: 'select_plan',
        orgId: org.id,
        plan: p.code,
      }),
    onSuccess: (res) => {
      setConfirm(null);
      if (res.checkoutUrl) {
        saveCheckoutPrefill({ email: user?.email ?? '', country: org.country ?? '' });
        location.assign(res.checkoutUrl);
        return;
      }
      toast('Plan change requested. It shows here once Paddle confirms it.');
      startWaiting();
    },
    onError: (err) => {
      setConfirm(null);
      toast(errorMessage(err), 'error');
    },
  });
  const simple = useMutation({
    mutationFn: (action: 'cancel' | 'resume') => billing(sb, { action, orgId: org.id }),
    onSuccess: async (_d, action) => {
      setCancelling(false);
      toast(action === 'cancel' ? 'Cancellation requested' : 'Resume requested');
      startWaiting();
      await qc.invalidateQueries({ queryKey: ['subscription', org.id] });
    },
    onError: (err) => {
      setCancelling(false);
      toast(errorMessage(err), 'error');
    },
  });
  const portal = useMutation({
    mutationFn: () => billing<{ url: string }>(sb, { action: 'portal', orgId: org.id }),
    onSuccess: (res) => window.open(res.url, '_blank', 'noopener,noreferrer'),
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  if (plan.isPending) return <Skeleton className="h-96" />;
  if (plan.error) return <Alert tone="danger">{errorMessage(plan.error)}</Alert>;

  const { sub, plans } = plan.data;
  const code = effectivePlanCode(sub, now);
  const current = plans.find((p) => p.code === code);
  const subscribed = !!sub && PAID_STATUSES.has(sub.status) && code !== 'free';
  const status = statusLine(sub, plans.find((p) => p.code === sub?.plan_code)?.name ?? '', now);

  return (
    <>
      <PageHeader title="Billing" description="Your plan, usage and invoices from SASU Invoice." />
      <div className="space-y-6">
        {waiting && !confirmed && (
          <Alert tone="info">
            Waiting for Paddle to confirm. This usually takes a few seconds; the page updates by
            itself.
          </Alert>
        )}
        {confirmed && (
          <Alert tone="ok">Confirmed by Paddle. Your subscription is up to date.</Alert>
        )}
        {sub?.status === 'past_due' && (
          <Alert tone="danger">
            We couldn’t take your last payment. Paddle will retry; update your payment method to
            avoid losing your plan.
          </Alert>
        )}
        {!owner && (
          <Alert tone="info">
            Only the organization owner can change the plan or payment details.
          </Alert>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader
              title={current?.name ?? 'Free'}
              description={status.text}
              action={
                <Badge tone={status.tone === 'neutral' ? 'neutral' : status.tone}>
                  {sub?.status ?? 'free'}
                </Badge>
              }
            />
            {owner && subscribed && (
              <div className="flex flex-wrap gap-2 p-5">
                <Button
                  variant="secondary"
                  onClick={() => portal.mutate()}
                  loading={portal.isPending}
                >
                  <CreditCard className="h-4 w-4" aria-hidden /> Payment method & billing details
                </Button>
                {sub?.status !== 'canceled' &&
                  (sub?.cancel_at_period_end ? (
                    <Button
                      variant="secondary"
                      onClick={() => simple.mutate('resume')}
                      loading={simple.isPending}
                    >
                      Keep my subscription
                    </Button>
                  ) : (
                    <Button variant="ghost" onClick={() => setCancelling(true)}>
                      Cancel subscription
                    </Button>
                  ))}
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Usage" description="Emails and AI reset on the 1st (UTC)." />
            <dl className="space-y-3 p-5 text-sm">
              {usage.data &&
                current &&
                (
                  [
                    ['Cloud documents', usage.data.invoices, current.limits.cloud_invoices],
                    ['Team members', usage.data.users, current.limits.users],
                    ['Emails this month', usage.data.emails, current.limits.email_sends_per_month],
                    ['AI requests this month', usage.data.ai, current.limits.ai_requests_per_month],
                  ] as const
                ).map(([label, used, limit]) => (
                  <div key={label}>
                    <div className="flex justify-between">
                      <dt className="text-graphite">{label}</dt>
                      <dd className="font-semibold tabular-nums">
                        {used} / {limit}
                      </dd>
                    </div>
                    <div className="mt-1.5 h-2 rounded-full bg-hover" aria-hidden>
                      <div
                        className={cn('h-2 rounded-full', used >= limit ? 'bg-danger' : 'bg-brand')}
                        style={{ width: `${limit ? Math.min(100, (used / limit) * 100) : 100}%` }}
                      />
                    </div>
                  </div>
                ))}
            </dl>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((p) => (
            <PlanCard
              key={p.code}
              plan={p}
              current={p.code === code}
              currentPrice={current?.price_minor ?? 0}
              owner={owner}
              subscribed={subscribed}
              busy={select.isPending && select.variables?.code === p.code}
              onChoose={() => setConfirm(p)}
            />
          ))}
        </div>

        {owner && subscribed && <InvoicesCard />}
        <p className="text-xs text-graphite">
          Payments are processed by Paddle.com, our reseller and merchant of record, which adds
          sales tax or VAT where required and issues the tax invoices.
        </p>
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={
          confirm
            ? subscribed
              ? `Switch to ${confirm.name}?`
              : `Subscribe to ${confirm.name}?`
            : ''
        }
        confirmLabel={subscribed ? 'Switch plan' : 'Continue to payment'}
        loading={select.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && select.mutate(confirm)}
      >
        {confirm && subscribed
          ? `Your plan changes straight away. Paddle charges or credits the difference for the rest of this billing period.`
          : confirm &&
            `${money(confirm.price_minor, confirm.currency)} per ${confirm.billing_interval}, plus tax where applicable. You'll pay on Paddle's secure checkout.`}
      </ConfirmDialog>
      <ConfirmDialog
        open={cancelling}
        title="Cancel your subscription?"
        confirmLabel="Cancel at period end"
        tone="danger"
        loading={simple.isPending}
        onCancel={() => setCancelling(false)}
        onConfirm={() => simple.mutate('cancel')}
      >
        You keep your plan until{' '}
        {sub?.current_period_end ? date(sub.current_period_end) : 'the end of the period'}. After
        that you’re on Free: your cloud documents stay readable, but new cloud documents, reminders
        and AI stop.
      </ConfirmDialog>
    </>
  );
}

function PlanCard({
  plan,
  current,
  currentPrice,
  owner,
  subscribed,
  busy,
  onChoose,
}: {
  plan: Plan;
  current: boolean;
  currentPrice: number;
  owner: boolean;
  subscribed: boolean;
  busy: boolean;
  onChoose: () => void;
}) {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const paid = plan.price_minor > 0;
  const problems = useQuery({
    queryKey: ['plan-check', org.id, plan.code],
    queryFn: () => planChangeProblems(sb, org.id, plan.code),
    enabled: owner && paid && !current,
  });
  const blocked = (problems.data?.length ?? 0) > 0;
  const label = current
    ? 'Current plan'
    : !subscribed
      ? `Choose ${plan.name}`
      : plan.price_minor > currentPrice
        ? 'Upgrade'
        : 'Downgrade';

  return (
    <Card className={cn('flex flex-col p-5', current && 'border-brand')}>
      <h3 className="font-display text-lg font-bold">{plan.name}</h3>
      <p className="mt-1 font-display text-2xl font-bold">
        {money(plan.price_minor, plan.currency)}
        <span className="text-sm font-medium text-graphite"> / {plan.billing_interval}</span>
      </p>
      <ul className="mt-3 flex-1 space-y-1 text-sm text-graphite">
        <li>{plan.limits.cloud_invoices} cloud documents</li>
        <li>
          {plan.limits.users} {plan.limits.users === 1 ? 'user' : 'users'}
        </li>
        <li>{plan.limits.email_sends_per_month} emails a month</li>
        <li>{plan.limits.ai_requests_per_month} AI requests a month</li>
      </ul>
      {blocked && <p className="mt-3 text-xs text-danger">{problems.data![0]}</p>}
      {paid ? (
        <Button
          className="mt-4"
          variant={current ? 'secondary' : 'primary'}
          disabled={current || !owner || blocked}
          loading={busy}
          onClick={onChoose}
        >
          {label}
        </Button>
      ) : (
        <p className="mt-4 text-xs text-graphite">
          {current
            ? 'You’re on the free plan.'
            : 'Cancel your subscription to move to Free at the end of the period.'}
        </p>
      )}
    </Card>
  );
}

function InvoicesCard() {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const toast = useToast();
  const invoices = useQuery({
    queryKey: ['billing-invoices', org.id],
    queryFn: () =>
      billing<{ invoices: BillingInvoice[] }>(sb, { action: 'invoices', orgId: org.id }),
  });
  const pdf = useMutation({
    mutationFn: (id: string) =>
      billing<{ url: string }>(sb, { action: 'invoice_pdf', orgId: org.id, invoiceId: id }),
    onSuccess: (res) => window.open(res.url, '_blank', 'noopener,noreferrer'),
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  return (
    <Card>
      <CardHeader title="Billing history" />
      {invoices.isPending ? (
        <Skeleton className="m-5 h-16" />
      ) : invoices.error ? (
        <div className="p-5">
          <Alert tone="danger">{errorMessage(invoices.error)}</Alert>
        </div>
      ) : invoices.data.invoices.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-graphite">No invoices yet.</p>
      ) : (
        <ul className="divide-y divide-rule">
          {invoices.data.invoices.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <FileText className="h-4 w-4 text-faint" aria-hidden />
              <span className="min-w-0 flex-1">
                {i.invoiceNumber ?? i.id} · {date(i.billedAt)}
              </span>
              <span className="tabular-nums">{money(i.totalMinor, i.currency)}</span>
              <Badge tone={i.status === 'completed' ? 'ok' : 'warn'}>{i.status}</Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => pdf.mutate(i.id)}
                loading={pdf.isPending && pdf.variables === i.id}
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden /> PDF
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
