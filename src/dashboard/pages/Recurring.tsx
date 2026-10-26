import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Repeat } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { describeSchedule } from '../../core/recurrence';
import { RecurringDialog } from '../components/RecurringDialog';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Skeleton,
} from '../components/ui';
import {
  errorMessage,
  listRecurring,
  listRecurringRuns,
  setRecurringStatus,
  type RecurringRule,
} from '../lib/api';
import { useSupabase } from '../lib/auth';
import { date, dateTime, money } from '../lib/format';
import { useActiveOrg } from '../lib/org';
import { useToast } from '../lib/toast';

const STATUS: Record<RecurringRule['status'], { label: string; tone: 'ok' | 'warn' | 'neutral' }> =
  {
    active: { label: 'Active', tone: 'ok' },
    paused: { label: 'Paused', tone: 'warn' },
    cancelled: { label: 'Cancelled', tone: 'neutral' },
    ended: { label: 'Ended', tone: 'neutral' },
  };

export function RecurringPage() {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const rules = useQuery({
    queryKey: ['recurring', org.id],
    queryFn: () => listRecurring(sb, org.id),
  });

  return (
    <>
      <PageHeader
        title="Recurring invoices"
        description="Invoices created for you on a schedule. Start one from any invoice’s page."
      />
      {rules.isPending ? (
        <Skeleton className="h-48" />
      ) : rules.error ? (
        <Alert tone="danger">{errorMessage(rules.error)}</Alert>
      ) : rules.data.length === 0 ? (
        <Card>
          <EmptyState icon={<Repeat className="h-5 w-5" />} title="No recurring invoices yet">
            Open an invoice you send regularly and choose “Repeat”.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-4">
          {rules.data.map((r) => (
            <RuleCard key={r.id} rule={r} />
          ))}
        </div>
      )}
    </>
  );
}

function RuleCard({ rule }: { rule: RecurringRule }) {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showRuns, setShowRuns] = useState(false);
  const runs = useQuery({
    queryKey: ['recurring-runs', rule.id],
    queryFn: () => listRecurringRuns(sb, rule.id),
    enabled: showRuns,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['recurring', org.id] });
  const status = useMutation({
    mutationFn: (s: 'active' | 'paused' | 'cancelled') => setRecurringStatus(sb, rule.id, s),
    onSuccess: async (_d, s) => {
      setCancelling(false);
      toast(
        s === 'active'
          ? 'Schedule resumed'
          : s === 'paused'
            ? 'Schedule paused'
            : 'Schedule cancelled',
      );
      await refresh();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  const finished = rule.status === 'cancelled' || rule.status === 'ended';
  const s = STATUS[rule.status];

  return (
    <Card>
      <div className="flex flex-wrap items-start gap-4 p-5">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {rule.name || rule.template?.client_name || 'Recurring invoice'}
            <Badge tone={s.tone}>{s.label}</Badge>
          </p>
          <p className="mt-1 text-sm text-graphite">
            {describeSchedule(rule.unit, rule.every)}
            {rule.template &&
              ` · ${money(rule.template.total_minor, rule.template.currency)}`} ·{' '}
            {rule.mode === 'issue'
              ? rule.send_email
                ? 'issued and emailed'
                : 'issued automatically'
              : 'created as drafts'}
          </p>
          <p className="mt-1 text-sm">
            {rule.status === 'active' && rule.next_run_date ? (
              <>Next invoice {date(rule.next_run_date)}</>
            ) : rule.status === 'paused' ? (
              'Paused'
            ) : (
              'Finished'
            )}
            {rule.end_date && ` · ends ${date(rule.end_date)}`} · {rule.runs_count} created
          </p>
          <p className="mt-1 text-xs text-graphite">
            Based on{' '}
            <Link
              to={`/invoices/${rule.template_invoice_id}`}
              className="font-medium text-brand-ink"
            >
              {rule.template?.number ?? 'an invoice'}
            </Link>
          </p>
          {rule.last_error && (
            <Alert tone="warn" className="mt-3">
              The last run failed and will be retried: {rule.last_error}
            </Alert>
          )}
        </div>
        {!finished && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={status.isPending && status.variables !== 'cancelled'}
              onClick={() => status.mutate(rule.status === 'paused' ? 'active' : 'paused')}
            >
              {rule.status === 'paused' ? 'Resume' : 'Pause'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCancelling(true)}>
              Cancel
            </Button>
          </div>
        )}
      </div>
      <div className="border-t border-rule px-5 py-2">
        <button
          type="button"
          className="text-sm font-medium text-brand-ink"
          aria-expanded={showRuns}
          onClick={() => setShowRuns((v) => !v)}
        >
          {showRuns ? 'Hide history' : 'Show history'}
        </button>
        {showRuns &&
          (runs.isPending ? (
            <Skeleton className="my-2 h-10" />
          ) : runs.error ? (
            <Alert tone="danger">{errorMessage(runs.error)}</Alert>
          ) : runs.data.length === 0 ? (
            <p className="py-2 text-sm text-graphite">Nothing created yet.</p>
          ) : (
            <ul className="divide-y divide-rule py-1 text-sm">
              {runs.data.map((run) => (
                <li key={run.id} className="flex items-center gap-3 py-2">
                  <span className="flex-1">{date(run.run_date)}</span>
                  {run.invoice_id ? (
                    <Link to={`/invoices/${run.invoice_id}`} className="font-medium text-brand-ink">
                      {run.invoice?.number ?? 'Invoice'}
                    </Link>
                  ) : (
                    <span className="text-faint">deleted</span>
                  )}
                  {run.email_message_id && <Badge tone="brand">Emailed</Badge>}
                </li>
              ))}
            </ul>
          ))}
        {rule.last_run_at && (
          <p className="pb-1 text-xs text-faint">Last run {dateTime(rule.last_run_at)}</p>
        )}
      </div>

      {editing && (
        <RecurringDialog
          invoiceId={rule.template_invoice_id}
          rule={rule}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            toast('Schedule saved');
            await refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={cancelling}
        title="Cancel this schedule?"
        confirmLabel="Cancel schedule"
        tone="danger"
        loading={status.isPending}
        onCancel={() => setCancelling(false)}
        onConfirm={() => status.mutate('cancelled')}
      >
        No more invoices will be created. Invoices already created are kept.
      </ConfirmDialog>
    </Card>
  );
}
