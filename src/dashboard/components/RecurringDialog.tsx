/** Create or edit a recurring schedule, with a preview of the next dates. */
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { RECURRENCE_PRESETS, upcomingDates, type RecurrenceUnit } from '../../core/recurrence';
import {
  createRecurring,
  errorMessage,
  todayIn,
  updateRecurring,
  type RecurringRule,
} from '../lib/api';
import { useSupabase } from '../lib/auth';
import { date } from '../lib/format';
import { useActiveOrg } from '../lib/org';
import { Alert, Button, Field, Input, Select } from './ui';

export function RecurringDialog({
  invoiceId,
  rule,
  onClose,
  onSaved,
}: {
  invoiceId: string;
  rule?: RecurringRule;
  onClose: () => void;
  onSaved: () => void;
}) {
  const sb = useSupabase();
  const { org } = useActiveOrg();
  const ref = useRef<HTMLDialogElement>(null);
  const today = todayIn(org.timezone);
  const presetOf = (u: RecurrenceUnit, e: number) =>
    RECURRENCE_PRESETS.find((p) => p.unit === u && p.every === e)?.id ?? 'custom';
  const [preset, setPreset] = useState<string>(rule ? presetOf(rule.unit, rule.every) : 'monthly');
  const [unit, setUnit] = useState<RecurrenceUnit>(rule?.unit ?? 'month');
  const [every, setEvery] = useState(String(rule?.every ?? 1));
  const [start, setStart] = useState(rule?.next_run_date ?? today);
  const [end, setEnd] = useState(rule?.end_date ?? '');
  const [mode, setMode] = useState<'draft' | 'issue'>(rule?.mode ?? 'draft');
  const [sendEmail, setSendEmail] = useState(rule?.send_email ?? false);
  const [name, setName] = useState(rule?.name ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);

  const n = Number(every);
  const valid = Number.isInteger(n) && n >= 1 && n <= 52;
  const preview = valid
    ? upcomingDates({ startDate: start, unit, every: n, endDate: end || null }, 0, 4)
    : [];

  const save = useMutation({
    mutationFn: () => {
      const input = {
        unit,
        every: n,
        startDate: start,
        endDate: end || null,
        mode,
        sendEmail: mode === 'issue' && sendEmail,
        name: name.trim(),
      };
      return rule
        ? updateRecurring(sb, rule.id, input)
        : createRecurring(sb, invoiceId, input).then(() => undefined);
    },
    onSuccess: onSaved,
    onError: (err) => setError(errorMessage(err)),
  });

  const submit = () => {
    if (!valid) return setError('Repeat every 1–52 periods.');
    if (!rule && start < today) return setError('Start today or later.');
    if (end && end < start) return setError('The end date is before the first invoice.');
    setError(null);
    save.mutate();
  };

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!save.isPending) onClose();
      }}
      className="m-auto w-[min(520px,calc(100vw-32px))] rounded-xl border border-rule bg-paper p-0 shadow-2xl backdrop:bg-ink/40"
      aria-labelledby="recurring-title"
    >
      <div className="border-b border-rule px-5 py-4">
        <h2 id="recurring-title" className="font-display text-lg font-bold">
          {rule ? 'Edit schedule' : 'Repeat this invoice'}
        </h2>
        <p className="text-sm text-graphite">
          Each run copies this invoice’s lines and terms with a new number and date.
        </p>
      </div>
      <div className="space-y-4 p-5">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Name (optional)">
          {(p) => (
            <Input
              {...p}
              maxLength={120}
              placeholder="Monthly retainer"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Repeats">
            {(p) => (
              <Select
                {...p}
                value={preset}
                onChange={(e) => {
                  setPreset(e.target.value);
                  const pr = RECURRENCE_PRESETS.find((x) => x.id === e.target.value);
                  if (pr) {
                    setUnit(pr.unit);
                    setEvery(String(pr.every));
                  }
                }}
              >
                {RECURRENCE_PRESETS.map((p2) => (
                  <option key={p2.id} value={p2.id}>
                    {p2.label}
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </Select>
            )}
          </Field>
          {preset === 'custom' && (
            <div className="flex items-end gap-2">
              <Field label="Every">
                {(p) => (
                  <Input
                    {...p}
                    inputMode="numeric"
                    className="w-20"
                    value={every}
                    onChange={(e) => setEvery(e.target.value)}
                  />
                )}
              </Field>
              <Select
                aria-label="Unit"
                className="w-auto"
                value={unit}
                onChange={(e) => setUnit(e.target.value as RecurrenceUnit)}
              >
                <option value="week">weeks</option>
                <option value="month">months</option>
                <option value="year">years</option>
              </Select>
            </div>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={rule ? 'Next invoice' : 'First invoice'}>
            {(p) => (
              <Input
                {...p}
                type="date"
                min={today}
                disabled={!!rule}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            )}
          </Field>
          <Field label="End (optional)">
            {(p) => (
              <Input
                {...p}
                type="date"
                min={start}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            )}
          </Field>
        </div>
        <fieldset className="space-y-2 text-sm">
          <legend className="mb-1 text-[13px] font-semibold">Each new invoice is</legend>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="mode"
              className="mt-1 accent-brand"
              checked={mode === 'draft'}
              onChange={() => setMode('draft')}
            />
            <span>A draft for you to review and issue</span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="mode"
              className="mt-1 accent-brand"
              checked={mode === 'issue'}
              onChange={() => setMode('issue')}
            />
            <span>Issued automatically</span>
          </label>
          {mode === 'issue' && (
            <label className="ml-6 flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 accent-brand"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
              />
              <span>…and emailed to the client</span>
            </label>
          )}
        </fieldset>
        {preview.length > 0 && (
          <p className="text-xs text-graphite">
            Next: {preview.map((d) => date(d)).join(' · ')}
            {preview.length === 4 && ' …'}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-rule px-5 py-3">
        <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button onClick={submit} loading={save.isPending}>
          {rule ? 'Save schedule' : 'Start repeating'}
        </Button>
      </div>
    </dialog>
  );
}
