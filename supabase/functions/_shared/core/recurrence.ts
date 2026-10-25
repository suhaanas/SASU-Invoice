// GENERATED from src/core by scripts/sync-functions-core.mjs. Do not edit.
/**
 * Recurring invoices: schedule maths and building the next document from a
 * template. Shared by the dashboard (previews) and the scheduler (Edge
 * Function), and mirrored in SQL (app.recurring_date) — every date is
 * start + k periods, never "previous date + period", so month-ends don't drift
 * (31 Jan → 28 Feb → 31 Mar).
 */
import { addDays, addMonths, dueDateFor, parseISODate } from './dates.ts';
import { uid, type InvoiceState } from './state.ts';

export const RECURRENCE_UNITS = ['week', 'month', 'year'] as const;
export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];

export const RECURRENCE_PRESETS = [
  { id: 'weekly', label: 'Weekly', unit: 'week', every: 1 },
  { id: 'monthly', label: 'Monthly', unit: 'month', every: 1 },
  { id: 'quarterly', label: 'Quarterly', unit: 'month', every: 3 },
  { id: 'yearly', label: 'Annually', unit: 'year', every: 1 },
] as const satisfies readonly { id: string; label: string; unit: RecurrenceUnit; every: number }[];

/** The k-th occurrence (k = 0 is the start date). */
export function occurrenceDate(
  start: string,
  unit: RecurrenceUnit,
  every: number,
  k: number,
): string {
  if (unit === 'week') return addDays(start, 7 * every * k);
  return addMonths(start, (unit === 'year' ? 12 : 1) * every * k);
}

/** Next `count` dates from occurrence `from`, stopping at the end date. */
export function upcomingDates(
  rule: { startDate: string; unit: RecurrenceUnit; every: number; endDate: string | null },
  from: number,
  count: number,
): string[] {
  const out: string[] = [];
  for (let k = from; out.length < count && k < from + 1000; k++) {
    const d = occurrenceDate(rule.startDate, rule.unit, rule.every, k);
    if (rule.endDate && d > rule.endDate) break;
    out.push(d);
  }
  return out;
}

export function describeSchedule(unit: RecurrenceUnit, every: number): string {
  const preset = RECURRENCE_PRESETS.find((p) => p.unit === unit && p.every === every);
  if (preset) return preset.label;
  return `Every ${every} ${unit}s`;
}

/** Whole days from a to b (ISO dates). */
function daysBetween(a: string, b: string): number | null {
  const x = parseISODate(a);
  const y = parseISODate(b);
  if (!x || !y) return null;
  return Math.round(
    (Date.UTC(y.getFullYear(), y.getMonth(), y.getDate()) -
      Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())) /
      86_400_000,
  );
}

/**
 * The invoice for one run: the template's content and terms, dated `runDate`,
 * with fresh ids, nothing paid, and a number the server assigns.
 */
export function buildRecurringDocument(
  template: InvoiceState,
  runDate: string,
  opts: { issue: boolean; now: number; id?: string },
): InvoiceState {
  const doc = structuredClone(template);
  doc.id = opts.id ?? uid();
  doc.docType = 'invoice';
  doc.ref = null;
  doc.items = doc.items.map((it) => ({ ...it, id: uid() }));
  const m = doc.meta;
  // Keep the template's payment term (Net 30…); for custom terms keep the same gap.
  const gap = daysBetween(template.meta.issueDate, template.meta.dueDate);
  m.dueDate =
    m.dueTerm !== 'custom'
      ? (dueDateFor(runDate, m.dueTerm) ?? runDate)
      : gap !== null && gap >= 0
        ? addDays(runDate, gap)
        : runDate;
  m.issueDate = runDate;
  m.supplySameAsIssue = true;
  m.supplyDate = '';
  m.validUntil = addMonths(runDate, 1);
  m.number = 'PENDING';
  m.status = opts.issue ? 'Unpaid' : 'Draft';
  m.issuedAt = opts.issue ? opts.now : null;
  doc.totals.amountPaid = 0;
  doc.updatedAt = opts.now;
  return doc;
}
