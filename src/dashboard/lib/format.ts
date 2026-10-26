import { formatDate } from '../../core/dates';
import { formatMoney } from '../../core/money';

/** Display locale for the dashboard (number grouping, month names). */
export const LOCALE = 'en-GB';

export const money = (minor: number, currency: string): string =>
  formatMoney(minor, currency, LOCALE);

/** A calendar date ("2026-10-24") as-is, or a timestamp in the viewer's local time. */
export const date = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  if (iso.length === 10) return formatDate(iso, LOCALE);
  return new Intl.DateTimeFormat(LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
};

export const dateTime = (iso: string): string =>
  new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

/** "2026-10" → "Oct" (or "Oct 26" when the series spans years). */
export const monthLabel = (ym: string, withYear = false): string =>
  new Intl.DateTimeFormat(LOCALE, {
    month: 'short',
    ...(withYear ? { year: '2-digit' } : {}),
  }).format(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1));
