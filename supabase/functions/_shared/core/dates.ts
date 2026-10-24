// GENERATED from src/core by scripts/sync-functions-core.mjs. Do not edit.
/**
 * Date helpers. Invoice dates are calendar dates (`YYYY-MM-DD`), not instants,
 * so they are always parsed and built in *local* time. `new Date('2026-10-05')`
 * would be read as UTC midnight and render as Oct 4 west of Greenwich.
 */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseISODate(iso: string): Date | null {
  const m = ISO_RE.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const date = new Date(y, mo, d);
  // Reject roll-overs such as 2026-02-31.
  if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) return null;
  return date;
}

export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function addDays(iso: string, days: number): string {
  const date = parseISODate(iso);
  if (!date) return iso;
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/**
 * Add calendar months, clamping to the end of shorter months
 * (Jan 31 + 1 month → Feb 28/29), as billing periods expect.
 */
export function addMonths(iso: string, months: number): string {
  const date = parseISODate(iso);
  if (!date) return iso;
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return toISODate(date);
}

export function formatDate(iso: string, locale: string): string {
  const date = parseISODate(iso);
  if (!date) return '';
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(
    date,
  );
}

/** ISO strings compare correctly as plain strings. */
export function isBefore(a: string, b: string): boolean {
  return a < b;
}

export const DUE_TERMS = [
  { id: 'receipt', label: 'Due on receipt', days: 0 },
  { id: 'net7', label: 'Net 7', days: 7 },
  { id: 'net15', label: 'Net 15', days: 15 },
  { id: 'net30', label: 'Net 30', days: 30 },
  { id: 'net45', label: 'Net 45', days: 45 },
  { id: 'net60', label: 'Net 60', days: 60 },
  { id: 'custom', label: 'Custom date', days: null },
] as const;

export type DueTerm = (typeof DUE_TERMS)[number]['id'];

export const DUE_TERM_IDS = DUE_TERMS.map((t) => t.id) as [DueTerm, ...DueTerm[]];

/** Due date for a term, or null when the term is custom. */
export function dueDateFor(issueDate: string, term: DueTerm): string | null {
  const t = DUE_TERMS.find((x) => x.id === term);
  if (!t || t.days === null) return null;
  return addDays(issueDate, t.days);
}
