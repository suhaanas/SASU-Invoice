/**
 * RecoverFlow AI: automatic payment reminders. Turn them on, shape the
 * schedule and wording, and watch what was sent and whether it arrived.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  DEFAULT_TEMPLATES,
  EMAIL_KIND_LABELS,
  EMAIL_KINDS,
  MAX_BODY,
  MAX_SUBJECT,
  TONE_LABELS,
  TONES,
  defaultKindForOffset,
  fill,
  toneVars,
  unknownPlaceholders,
  type EmailKind,
  type Tone,
} from '../../core/emails';
import { EmailActivity } from '../components/EmailActivity';
import { BLOCK_REASONS } from '../components/InvoiceRecoverFlow';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  cn,
} from '../components/ui';
import {
  askAssistant,
  deleteRule,
  effectivePlanCode,
  errorMessage,
  getSettings,
  getSubscription,
  listEmailMessages,
  listReminderJobs,
  listRules,
  listSuppressions,
  listTemplates,
  monthlyUsage,
  removeSuppression,
  resetTemplate,
  saveRule,
  saveTemplate,
  setRemindersEnabled,
  updateSettings,
  type ReminderRule,
} from '../lib/api';
import { useAuth, useSupabase } from '../lib/auth';
import { dateTime } from '../lib/format';
import { canManage, useActiveOrg } from '../lib/org';
import { useToast } from '../lib/toast';

const REMINDER_KINDS = ['due_soon', 'due_today', 'overdue', 'follow_up'] as const;

function Switch({
  on,
  label,
  disabled,
  onChange,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
        on ? 'bg-brand' : 'bg-field',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
          on ? 'translate-x-5.5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

export function RemindersPage() {
  const sb = useSupabase();
  const active = useActiveOrg();
  const { org } = active;
  const manage = canManage(active);
  const settings = useQuery({
    queryKey: ['settings', org.id],
    queryFn: () => getSettings(sb, org.id),
  });
  const plan = useQuery({
    queryKey: ['subscription', org.id],
    queryFn: () => getSubscription(sb, org.id),
  });
  const usage = useQuery({ queryKey: ['usage', org.id], queryFn: () => monthlyUsage(sb, org.id) });
  const [now] = useState(() => Date.now());

  const code = plan.data ? effectivePlanCode(plan.data.sub, now) : null;
  const current = plan.data?.plans.find((p) => p.code === code);

  return (
    <>
      <PageHeader
        title="RecoverFlow AI"
        description="Polite, automatic payment reminders that stop as soon as an invoice is paid."
      />
      {settings.isPending || plan.isPending ? (
        <Skeleton className="h-64" />
      ) : settings.error || plan.error ? (
        <Alert tone="danger">{errorMessage(settings.error ?? plan.error)}</Alert>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
            <AutomationCard
              enabled={settings.data.reminders_enabled}
              sendHour={settings.data.reminder_send_hour}
              weekdaysOnly={settings.data.reminders_weekdays_only}
              manage={manage}
              planAllows={code !== 'free'}
            />
            <Card>
              <CardHeader
                title="This month"
                description={current ? `${current.name} plan` : undefined}
              />
              <dl className="space-y-3 p-5 text-sm">
                {[
                  [
                    'Emails sent',
                    usage.data?.email_sends ?? 0,
                    current?.limits.email_sends_per_month ?? 0,
                  ],
                  [
                    'AI requests',
                    usage.data?.ai_requests ?? 0,
                    current?.limits.ai_requests_per_month ?? 0,
                  ],
                ].map(([label, used, limit]) => (
                  <div key={label as string}>
                    <div className="flex justify-between">
                      <dt className="text-graphite">{label}</dt>
                      <dd className="font-semibold tabular-nums">
                        {used} / {limit}
                      </dd>
                    </div>
                    <div className="mt-1.5 h-2 rounded-full bg-hover" aria-hidden>
                      <div
                        className={cn(
                          'h-2 rounded-full',
                          (used as number) >= (limit as number) ? 'bg-danger' : 'bg-brand',
                        )}
                        style={{
                          width: `${(limit as number) ? Math.min(100, ((used as number) / (limit as number)) * 100) : 100}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </dl>
            </Card>
          </div>
          <ScheduleCard manage={manage} />
          <TemplatesCard manage={manage} />
          <ActivityCard />
          {manage && <SuppressionsCard />}
        </div>
      )}
    </>
  );
}

function AutomationCard({
  enabled,
  sendHour,
  weekdaysOnly,
  manage,
  planAllows,
}: {
  enabled: boolean;
  sendHour: number;
  weekdaysOnly: boolean;
  manage: boolean;
  planAllows: boolean;
}) {
  const sb = useSupabase();
  const { user } = useAuth();
  const { org } = useActiveOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['settings', org.id] }),
      qc.invalidateQueries({ queryKey: ['rules', org.id] }),
    ]);
  const toggle = useMutation({
    mutationFn: () => setRemindersEnabled(sb, org.id, !enabled),
    onSuccess: async () => {
      toast(enabled ? 'Automatic reminders turned off' : 'Automatic reminders are on');
      await refresh();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  const timing = useMutation({
    mutationFn: (patch: { reminder_send_hour?: number; reminders_weekdays_only?: boolean }) =>
      updateSettings(sb, org.id, user!.id, patch),
    onSuccess: refresh,
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  return (
    <Card>
      <CardHeader
        title="Automatic reminders"
        description={
          enabled
            ? 'On: clients with unpaid invoices get reminders on your schedule.'
            : 'Off: no reminders are sent automatically.'
        }
        action={
          manage && (
            <Switch
              on={enabled}
              label="Automatic reminders"
              disabled={toggle.isPending || (!enabled && !planAllows)}
              onChange={() => toggle.mutate()}
            />
          )
        }
      />
      <div className="space-y-4 p-5 text-sm">
        {!planAllows && <Alert tone="warn">Automatic reminders need a Pro or Business plan.</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Send at (your organization’s time)" hint={`Timezone: ${org.timezone}`}>
            {(p) => (
              <Select
                {...p}
                disabled={!manage}
                value={sendHour}
                onChange={(e) => timing.mutate({ reminder_send_hour: Number(e.target.value) })}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <label className="flex items-center gap-3 self-end pb-2">
            <Switch
              on={weekdaysOnly}
              label="Weekdays only"
              disabled={!manage}
              onChange={() => timing.mutate({ reminders_weekdays_only: !weekdaysOnly })}
            />
            <span>Weekdays only (weekend reminders go out on Monday)</span>
          </label>
        </div>
        <p className="text-xs text-graphite">
          Reminders never go to invoices that are paid, paused, disputed, or whose client opted out
          or bounced. Each invoice gets at most one reminder a day.
        </p>
      </div>
    </Card>
  );
}

function ScheduleCard({ manage }: { manage: boolean }) {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const rules = useQuery({ queryKey: ['rules', org.id], queryFn: () => listRules(sb, org.id) });
  const [adding, setAdding] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['rules', org.id] });
  const save = useMutation({
    mutationFn: (rule: Omit<ReminderRule, 'id'> & { id?: string }) => saveRule(sb, org.id, rule),
    onSuccess: async () => {
      setAdding(false);
      await refresh();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteRule(sb, id),
    onSuccess: refresh,
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  return (
    <Card>
      <CardHeader
        title="Schedule"
        description="When reminders go out, relative to the due date."
        action={
          manage &&
          !adding && (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Add step
            </Button>
          )
        }
      />
      {rules.isPending ? (
        <Skeleton className="m-5 h-24" />
      ) : rules.error ? (
        <div className="p-5">
          <Alert tone="danger">{errorMessage(rules.error)}</Alert>
        </div>
      ) : rules.data.length === 0 && !adding ? (
        <p className="px-5 py-6 text-center text-sm text-graphite">
          No schedule yet. Turning automatic reminders on adds a recommended 5-step schedule.
        </p>
      ) : (
        <ul className="divide-y divide-rule">
          {rules.data.map((r) => (
            <RuleRow
              key={r.id}
              rule={r}
              manage={manage}
              saving={save.isPending}
              onSave={(x) => save.mutate({ ...x, id: r.id })}
              onDelete={() => remove.mutate(r.id)}
            />
          ))}
          {adding && (
            <RuleRow
              rule={{ id: '', offset_days: 21, kind: 'follow_up', tone: 'firm', is_active: true }}
              manage
              isNew
              saving={save.isPending}
              onSave={(x) => save.mutate(x)}
              onDelete={() => setAdding(false)}
            />
          )}
        </ul>
      )}
    </Card>
  );
}

function RuleRow({
  rule,
  manage,
  isNew,
  saving,
  onSave,
  onDelete,
}: {
  rule: ReminderRule;
  manage: boolean;
  isNew?: boolean;
  saving: boolean;
  onSave: (r: Omit<ReminderRule, 'id'>) => void;
  onDelete: () => void;
}) {
  const [days, setDays] = useState(String(Math.abs(rule.offset_days)));
  const [when, setWhen] = useState(
    rule.offset_days < 0 ? 'before' : rule.offset_days === 0 ? 'on' : 'after',
  );
  const [kind, setKind] = useState(rule.kind);
  const [tone, setTone] = useState(rule.tone);
  const [error, setError] = useState<string | null>(null);
  const offset = when === 'on' ? 0 : (when === 'before' ? -1 : 1) * Number(days);
  const dirty = isNew || offset !== rule.offset_days || kind !== rule.kind || tone !== rule.tone;

  const submit = () => {
    const n = Number(days);
    if (when !== 'on' && (!Number.isInteger(n) || n < 1 || n > (when === 'before' ? 60 : 180))) {
      return setError(when === 'before' ? 'Use 1–60 days.' : 'Use 1–180 days.');
    }
    setError(null);
    onSave({ offset_days: offset, kind, tone, is_active: rule.is_active });
  };

  return (
    <li className="flex flex-wrap items-end gap-3 px-5 py-3 text-sm">
      <div className="flex items-end gap-2">
        {when !== 'on' && (
          <Input
            aria-label="Days"
            className="w-20"
            inputMode="numeric"
            disabled={!manage}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        )}
        <Select
          aria-label="When"
          className="w-auto"
          disabled={!manage}
          value={when}
          onChange={(e) => {
            setWhen(e.target.value);
            setKind(
              defaultKindForOffset(
                e.target.value === 'on' ? 0 : e.target.value === 'before' ? -1 : Number(days) || 1,
              ) as ReminderRule['kind'],
            );
          }}
        >
          <option value="before">days before due</option>
          <option value="on">on the due date</option>
          <option value="after">days after due</option>
        </Select>
      </div>
      <Select
        aria-label="Template"
        className="w-auto"
        disabled={!manage}
        value={kind}
        onChange={(e) => setKind(e.target.value as ReminderRule['kind'])}
      >
        {REMINDER_KINDS.map((k) => (
          <option key={k} value={k}>
            {EMAIL_KIND_LABELS[k]}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Tone"
        className="w-auto"
        disabled={!manage}
        value={tone}
        onChange={(e) => setTone(e.target.value as Tone)}
      >
        {TONES.map((t) => (
          <option key={t} value={t}>
            {TONE_LABELS[t]}
          </option>
        ))}
      </Select>
      {manage && (
        <div className="ml-auto flex items-center gap-2">
          {!isNew && (
            <Switch
              on={rule.is_active}
              label="Step active"
              onChange={() =>
                onSave({
                  offset_days: rule.offset_days,
                  kind: rule.kind,
                  tone: rule.tone,
                  is_active: !rule.is_active,
                })
              }
            />
          )}
          {dirty && (
            <Button size="sm" onClick={submit} loading={saving}>
              {isNew ? 'Add' : 'Save'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            aria-label={isNew ? 'Cancel' : 'Delete step'}
          >
            {isNew ? 'Cancel' : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
          </Button>
        </div>
      )}
      {error && <p className="w-full text-xs text-danger">{error}</p>}
    </li>
  );
}

const SAMPLE_VARS = {
  client_name: 'Alex',
  business_name: 'Your business',
  invoice_number: 'INV-042',
  amount_due: '£1,250.00',
  total: '£1,250.00',
  due_date: '1 Nov 2026',
  days_overdue: '7',
  link: 'https://…/invoice.html#t=…',
  signature: 'Your name',
};

function TemplatesCard({ manage }: { manage: boolean }) {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const templates = useQuery({
    queryKey: ['templates', org.id],
    queryFn: () => listTemplates(sb, org.id),
  });
  const [kind, setKind] = useState<EmailKind>('overdue');
  const custom = templates.data?.find((t) => t.kind === kind);

  return (
    <Card>
      <CardHeader
        title="Email wording"
        description="Defaults are ready to use; customise any of them."
      />
      <div
        className="flex flex-wrap gap-1 border-b border-rule px-5 pt-3"
        role="tablist"
        aria-label="Email type"
      >
        {EMAIL_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
              kind === k
                ? 'border-brand text-brand-ink'
                : 'border-transparent text-graphite hover:text-ink',
            )}
          >
            {EMAIL_KIND_LABELS[k]}
            {templates.data?.some((t) => t.kind === k) && (
              <span className="ml-1 text-xs text-faint">(custom)</span>
            )}
          </button>
        ))}
      </div>
      {templates.isPending ? (
        <Skeleton className="m-5 h-40" />
      ) : (
        <TemplateEditor
          key={`${kind}-${custom ? 'c' : 'd'}`}
          kind={kind}
          initial={custom ?? DEFAULT_TEMPLATES[kind]}
          isCustom={!!custom}
          manage={manage}
        />
      )}
    </Card>
  );
}

function TemplateEditor({
  kind,
  initial,
  isCustom,
  manage,
}: {
  kind: EmailKind;
  initial: { subject: string; body: string };
  isCustom: boolean;
  manage: boolean;
}) {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [tone, setTone] = useState<Tone>('professional');
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['templates', org.id] });

  const save = useMutation({
    mutationFn: () =>
      saveTemplate(sb, org.id, { kind, subject: subject.trim(), body: body.trim() }),
    onSuccess: async () => {
      toast('Wording saved');
      await refresh();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const reset = useMutation({
    mutationFn: () => resetTemplate(sb, org.id, kind),
    onSuccess: async () => {
      toast('Back to the default wording');
      await refresh();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const rewrite = useMutation({
    mutationFn: () =>
      askAssistant<{ subject: string; body: string }>(sb, {
        action: 'rewrite',
        orgId: org.id,
        subject,
        body,
        tone,
      }),
    onSuccess: (d) => {
      setSubject(d.subject);
      setBody(d.body);
      setError(null);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const unknown = unknownPlaceholders(`${subject}\n${body}`);
  const submit = () => {
    if (!subject.trim() || !body.trim()) return setError('Add a subject and a message.');
    if (unknown.length) return setError(`Unknown placeholder {{${unknown[0]}}}.`);
    if (!body.includes('{{link}}'))
      return setError('Keep {{link}} in the message so clients can open the invoice.');
    setError(null);
    save.mutate();
  };
  const preview = { ...SAMPLE_VARS, ...toneVars(tone) };

  return (
    <div className="grid md:grid-cols-2">
      <div className="space-y-4 p-5">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Subject">
          {(p) => (
            <Input
              {...p}
              disabled={!manage}
              maxLength={MAX_SUBJECT}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Message"
          hint="Placeholders: {{client_name}} {{invoice_number}} {{amount_due}} {{total}} {{due_date}} {{days_overdue}} {{link}} {{signature}} {{tone_opening}} {{tone_closing}}"
        >
          {(p) => (
            <Textarea
              {...p}
              disabled={!manage}
              rows={12}
              maxLength={MAX_BODY}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          )}
        </Field>
        {manage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={submit} loading={save.isPending}>
              Save wording
            </Button>
            {isCustom && (
              <Button variant="secondary" onClick={() => reset.mutate()} loading={reset.isPending}>
                Use default
              </Button>
            )}
            <span className="ml-auto flex items-center gap-2">
              <Select
                aria-label="Rewrite tone"
                className="h-8 w-auto text-[13px]"
                value={tone}
                onChange={(e) => setTone(e.target.value as Tone)}
              >
                {TONES.map((t) => (
                  <option key={t} value={t}>
                    {TONE_LABELS[t]}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => rewrite.mutate()}
                loading={rewrite.isPending}
              >
                <Sparkles className="h-4 w-4" aria-hidden /> Rewrite
              </Button>
            </span>
          </div>
        )}
      </div>
      <div className="border-t border-rule bg-canvas p-5 md:border-l md:border-t-0">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
          Preview with sample details
        </p>
        <div className="rounded-lg border border-rule bg-paper p-4 text-sm">
          <p className="mb-3 font-semibold">{fill(subject, preview)}</p>
          <p className="whitespace-pre-wrap break-words">{fill(body, preview)}</p>
        </div>
      </div>
    </div>
  );
}

function ActivityCard() {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const messages = useQuery({
    queryKey: ['emails', org.id, 'recent'],
    queryFn: () => listEmailMessages(sb, org.id, { limit: 20 }),
  });
  const jobs = useQuery({
    queryKey: ['reminder-jobs', org.id, 'recent'],
    queryFn: () => listReminderJobs(sb, org.id, { limit: 50 }),
  });
  const problems = (jobs.data ?? []).filter(
    (j) => j.status === 'failed' || (j.status === 'scheduled' && j.attempts > 0),
  );

  return (
    <Card>
      <CardHeader
        title="Recent emails"
        description="Automatic reminders and emails sent by your team."
      />
      {problems.length > 0 && (
        <div className="space-y-2 border-b border-rule p-5">
          {problems.map((j) => (
            <Alert key={j.id} tone={j.status === 'failed' ? 'danger' : 'warn'}>
              <Link to={`/invoices/${j.invoice_id}`} className="font-semibold underline">
                {j.invoice?.number}
              </Link>{' '}
              {j.status === 'failed'
                ? 'reminder failed'
                : `reminder will retry (attempt ${j.attempts})`}
              : {j.last_error}
            </Alert>
          ))}
        </div>
      )}
      {messages.isPending ? (
        <Skeleton className="m-5 h-24" />
      ) : messages.error ? (
        <div className="p-5">
          <Alert tone="danger">{errorMessage(messages.error)}</Alert>
        </div>
      ) : messages.data.length === 0 ? (
        <EmptyState icon={<Sparkles className="h-5 w-5" />} title="No emails yet">
          Send an invoice from its page, or turn on automatic reminders.
        </EmptyState>
      ) : (
        <EmailActivity messages={messages.data} showInvoice />
      )}
    </Card>
  );
}

function SuppressionsCard() {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({
    queryKey: ['suppressions', org.id],
    queryFn: () => listSuppressions(sb, org.id),
  });
  const remove = useMutation({
    mutationFn: (email: string) => removeSuppression(sb, org.id, email),
    onSuccess: async () => {
      toast('Address unblocked');
      await qc.invalidateQueries({ queryKey: ['suppressions', org.id] });
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  if (!list.data || list.data.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Blocked addresses" description={BLOCK_REASONS.suppressed} />
      <ul className="divide-y divide-rule">
        {list.data.map((s) => (
          <li key={s.email} className="flex items-center gap-3 px-5 py-3 text-sm">
            <span className="min-w-0 flex-1 truncate">{s.email}</span>
            <Badge tone="danger">
              {s.reason === 'complained'
                ? 'Marked as spam'
                : s.reason === 'bounced'
                  ? 'Bounced'
                  : 'Blocked'}
            </Badge>
            <span className="text-xs text-faint">{dateTime(s.created_at)}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => remove.mutate(s.email)}
              loading={remove.isPending && remove.variables === s.email}
            >
              Unblock
            </Button>
          </li>
        ))}
      </ul>
      <p className="border-t border-rule px-5 py-3 text-xs text-graphite">
        Only unblock an address after confirming it with your client. Repeated bounces or spam
        reports can stop email delivery for everyone.
      </p>
    </Card>
  );
}
