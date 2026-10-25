/**
 * "Get set up" checklist on the overview for owners and admins. Every item is
 * worked out from real data (settings, invoices, clients, team), so it ticks
 * itself off as you go. It disappears when everything is done or when you
 * hide it (remembered per organization in this browser).
 */
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { setEditorSyncOrg } from '../../cloud/prefs';
import {
  countActiveClients,
  effectivePlanCode,
  getSettings,
  getSubscription,
  listInvoices,
  listMembers,
} from '../lib/api';
import { useSupabase } from '../lib/auth';
import { canManage, useActiveOrg } from '../lib/org';
import { Button, Card } from './ui';

const hiddenKey = (orgId: string) => `sasu-getting-started-hidden:${orgId}`;

function isHidden(orgId: string): boolean {
  try {
    return localStorage.getItem(hiddenKey(orgId)) === '1';
  } catch {
    return false;
  }
}

interface Item {
  key: string;
  label: string;
  hint: string;
  done: boolean;
  action: ReactNode;
}

const linkClass = 'text-sm font-semibold text-brand-ink hover:underline';

export function GettingStarted() {
  const sb = useSupabase();
  const membership = useActiveOrg();
  const { org } = membership;
  const [hidden, setHidden] = useState(() => isHidden(org.id));
  const enabled = canManage(membership) && !hidden;

  const settings = useQuery({
    queryKey: ['settings', org.id],
    queryFn: () => getSettings(sb, org.id),
    enabled,
  });
  const invoices = useQuery({
    queryKey: ['invoices', org.id, 'count'],
    queryFn: () =>
      listInvoices(sb, org.id, { page: 0, search: '', docType: '' }).then((r) => r.total),
    enabled,
  });
  const clients = useQuery({
    queryKey: ['dashboard', org.id, 'clients'],
    queryFn: () => countActiveClients(sb, org.id),
    enabled,
  });
  const members = useQuery({
    queryKey: ['members', org.id],
    queryFn: () => listMembers(sb, org.id),
    enabled,
  });
  const plan = useQuery({
    queryKey: ['subscription', org.id],
    queryFn: () => getSubscription(sb, org.id),
    enabled,
  });

  if (!enabled) return null;
  if (!settings.data || invoices.data === undefined || clients.data === undefined) return null;

  const s = settings.data;
  const teamPlan = plan.data ? effectivePlanCode(plan.data.sub) === 'business' : false;
  const items: Item[] = [
    {
      key: 'details',
      label: 'Add your business details',
      hint: 'Email and address appear on every invoice.',
      done: !!s.business.email && !!s.business.address,
      action: (
        <Link to="/settings/organization" className={linkClass}>
          Add details
        </Link>
      ),
    },
    {
      key: 'logo',
      label: 'Upload your logo',
      hint: 'Makes your invoices instantly recognisable.',
      done: !!s.logo_path,
      action: (
        <Link to="/settings/organization" className={linkClass}>
          Upload logo
        </Link>
      ),
    },
    {
      key: 'client',
      label: 'Add a client',
      hint: 'Save their details once and reuse them on every invoice.',
      done: clients.data > 0,
      action: (
        <Link to="/clients/new" className={linkClass}>
          Add client
        </Link>
      ),
    },
    {
      key: 'invoice',
      label: 'Create your first invoice',
      hint: 'It saves to this workspace automatically.',
      done: invoices.data > 0,
      action: (
        <a href="/app.html" onClick={() => setEditorSyncOrg(org.id)} className={linkClass}>
          New invoice
        </a>
      ),
    },
    {
      key: 'reminders',
      label: 'Turn on payment reminders',
      hint: 'RecoverFlow follows up on late invoices for you.',
      done: s.reminders_enabled,
      action: (
        <Link to="/reminders" className={linkClass}>
          Set up reminders
        </Link>
      ),
    },
    ...(teamPlan
      ? [
          {
            key: 'team',
            label: 'Invite a teammate',
            hint: 'Give your accountant or staff the right access.',
            done: (members.data?.length ?? 1) > 1,
            action: (
              <Link to="/settings/team" className={linkClass}>
                Invite
              </Link>
            ),
          },
        ]
      : []),
  ];
  const doneCount = items.filter((i) => i.done).length;
  if (doneCount === items.length) return null;

  const hide = () => {
    try {
      localStorage.setItem(hiddenKey(org.id), '1');
    } catch {
      // Private mode: hide for this visit only.
    }
    setHidden(true);
  };

  return (
    <Card className="mb-6 p-5" role="region" aria-labelledby="getting-started-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="getting-started-title" className="font-display text-lg font-bold">
            Get set up
          </h2>
          <p className="mt-0.5 text-sm text-graphite">
            {doneCount} of {items.length} done. A few minutes now saves time on every invoice.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={hide} aria-label="Hide checklist">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-rule"
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={doneCount}
      >
        <div
          className="h-full rounded-full bg-brand transition-[width]"
          style={{ width: `${(doneCount / items.length) * 100}%` }}
        />
      </div>
      <ul className="mt-4 divide-y divide-rule">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-3 py-3">
            {item.done ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-ok" aria-hidden />
            ) : (
              <Circle className="h-5 w-5 shrink-0 text-faint" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p
                className={
                  item.done ? 'text-sm text-graphite line-through' : 'text-sm font-semibold'
                }
              >
                {item.label}
                <span className="sr-only">{item.done ? ' (done)' : ' (to do)'}</span>
              </p>
              {!item.done && <p className="text-xs text-graphite">{item.hint}</p>}
            </div>
            {!item.done && item.action}
          </li>
        ))}
      </ul>
    </Card>
  );
}
