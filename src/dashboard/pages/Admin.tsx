/**
 * Platform admin console: platform health, organization directory (metadata
 * and counts only) and feature switches. Admins cannot see customers'
 * invoices, clients or amounts; every request here is audited server-side.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  Input,
  PageHeader,
  Skeleton,
  Spinner,
  cn,
} from '../components/ui';
import { adminOrganizations, adminOverview, errorMessage, listFlags, setFlag } from '../lib/api';
import { useIsPlatformAdmin } from '../lib/admin';
import { useSupabase } from '../lib/auth';
import { date, money } from '../lib/format';
import { useToast } from '../lib/toast';

const HEALTH_LABELS: Record<string, string> = {
  reminderJobsFailed7d: 'Reminder jobs failed (7 days)',
  reminderJobsStuck: 'Reminder jobs stuck over an hour',
  emailProblems7d: 'Emails bounced, failed or marked spam (7 days)',
  recurringErrors: 'Recurring schedules with errors',
  billingErrors7d: 'Billing webhook errors (7 days)',
  aiErrors7d: 'AI errors or rejected drafts (7 days)',
};

export function AdminPage() {
  const admin = useIsPlatformAdmin();
  if (admin.isPending) return <Spinner />;
  if (!admin.data) return <Navigate to="/" replace />;
  return <AdminConsole />;
}

function AdminConsole() {
  const sb = useSupabase();
  const qc = useQueryClient();
  const toast = useToast();
  const overview = useQuery({ queryKey: ['admin-overview'], queryFn: () => adminOverview(sb) });
  const flags = useQuery({ queryKey: ['flags'], queryFn: () => listFlags(sb) });
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const orgs = useQuery({
    queryKey: ['admin-orgs', term],
    queryFn: () => adminOrganizations(sb, term),
  });
  const toggle = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) => setFlag(sb, key, enabled),
    onSuccess: async (_d, v) => {
      toast(`${v.key} ${v.enabled ? 'on' : 'off'}`);
      await qc.invalidateQueries({ queryKey: ['flags'] });
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  return (
    <>
      <PageHeader title="Platform admin" description="Health and usage across SASU Invoice." />
      <Alert tone="info" className="mb-6">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          You can see organization metadata and counts, never customers’ invoices, clients or
          amounts. Your use of this page is logged.
        </span>
      </Alert>

      {overview.isPending ? (
        <Skeleton className="h-48" />
      ) : overview.error ? (
        <Alert tone="danger">{errorMessage(overview.error)}</Alert>
      ) : (
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <dl className="grid grid-cols-2 gap-px bg-rule lg:grid-cols-4">
              {[
                [
                  'Organizations',
                  overview.data.organizations,
                  `${overview.data.organizations30d} new in 30 days`,
                ],
                ['Users', overview.data.users, ''],
                [
                  'Paid organizations',
                  Object.entries(overview.data.plans)
                    .filter(([k]) => k !== 'free')
                    .reduce((n, [, v]) => n + v, 0),
                  Object.entries(overview.data.plans)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(' · '),
                ],
                [
                  'Monthly recurring',
                  Object.entries(overview.data.mrr)
                    .map(([cur, v]) => money(v, cur))
                    .join(' · ') || '—',
                  'Active and past-due subscriptions',
                ],
              ].map(([label, value, detail]) => (
                <div key={label as string} className="bg-paper px-5 py-4">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-faint">
                    {label}
                  </dt>
                  <dd className="mt-1 font-display text-xl font-bold tabular-nums">{value}</dd>
                  {detail && <dd className="text-xs text-graphite">{detail}</dd>}
                </div>
              ))}
            </dl>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Health" />
              <ul className="divide-y divide-rule text-sm">
                {Object.entries(overview.data.health).map(([k, v]) => (
                  <li key={k} className="flex items-center justify-between px-5 py-2.5">
                    <span className="text-graphite">{HEALTH_LABELS[k] ?? k}</span>
                    <Badge tone={v > 0 ? 'danger' : 'ok'}>{v}</Badge>
                  </li>
                ))}
              </ul>
              {overview.data.recentBillingErrors.length > 0 && (
                <div className="space-y-1 border-t border-rule p-5 text-xs">
                  <p className="font-semibold">Recent billing errors</p>
                  {overview.data.recentBillingErrors.map((e, i) => (
                    <p key={i} className="text-graphite">
                      {date(e.receivedAt)} · {e.type}: {e.detail}
                    </p>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Switches"
                description="Turn platform features off in an emergency."
              />
              {flags.isPending ? (
                <Skeleton className="m-5 h-20" />
              ) : flags.error ? (
                <div className="p-5">
                  <Alert tone="danger">{errorMessage(flags.error)}</Alert>
                </div>
              ) : (
                <ul className="divide-y divide-rule text-sm">
                  {flags.data.map((f) => (
                    <li key={f.key} className="flex items-center gap-3 px-5 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{f.key}</span>
                        <span className="text-xs text-graphite">{f.description}</span>
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={f.enabled}
                        aria-label={f.key}
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate({ key: f.key, enabled: !f.enabled })}
                        className={cn(
                          'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                          f.enabled ? 'bg-brand' : 'bg-field',
                        )}
                      >
                        <span
                          className={cn(
                            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                            f.enabled ? 'translate-x-5.5' : 'translate-x-0.5',
                          )}
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader title="Organizations" />
            <div className="border-b border-rule p-4">
              <div className="relative max-w-sm">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
                  aria-hidden
                />
                <Input
                  type="search"
                  aria-label="Search organizations"
                  placeholder="Search by name"
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            {orgs.isPending ? (
              <Skeleton className="m-5 h-24" />
            ) : orgs.error ? (
              <div className="p-5">
                <Alert tone="danger">{errorMessage(orgs.error)}</Alert>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-faint">
                      <th scope="col" className="px-5 py-2">
                        Organization
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Created
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Plan
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Members
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Documents
                      </th>
                      <th scope="col" className="px-5 py-2">
                        Reminders
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">
                    {orgs.data.map((o) => (
                      <tr key={o.id}>
                        <td className="px-5 py-2">
                          <span className="font-medium">{o.name}</span>
                          {o.country && (
                            <span className="ml-1.5 text-xs text-faint">{o.country}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-graphite">{date(o.created_at)}</td>
                        <td className="px-3 py-2">
                          <Badge tone={o.plan === 'free' ? 'neutral' : 'brand'}>{o.plan}</Badge>
                          {o.status && (
                            <span className="ml-1.5 text-xs text-faint">{o.status}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{o.members}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{o.documents}</td>
                        <td className="px-5 py-2">{o.reminders_enabled ? 'On' : 'Off'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
