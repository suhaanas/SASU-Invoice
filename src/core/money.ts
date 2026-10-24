/**
 * Money helpers. All arithmetic happens on integer minor units (cents, paise…)
 * so totals never drift from floating-point error. The number of decimals per
 * currency comes from Intl (JPY → 0, USD → 2, …).
 */

export const CURRENCIES = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'LKR', name: 'Sri Lankan Rupee' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'ZAR', name: 'South African Rand' },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]['code'];

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code) as [CurrencyCode, ...CurrencyCode[]];

export const LOCALES = [
  { code: 'en-US', name: 'English (US)' },
  { code: 'en-GB', name: 'English (UK)' },
  { code: 'en-IN', name: 'English (India)' },
  { code: 'en-AU', name: 'English (Australia)' },
  { code: 'fr-FR', name: 'Français' },
  { code: 'de-DE', name: 'Deutsch' },
  { code: 'es-ES', name: 'Español' },
  { code: 'ja-JP', name: '日本語' },
] as const;

export type LocaleCode = (typeof LOCALES)[number]['code'];

export const LOCALE_CODES = LOCALES.map((l) => l.code) as [LocaleCode, ...LocaleCode[]];

const digitsCache = new Map<string, number>();

/** Number of minor-unit digits for a currency (JPY → 0, USD → 2). */
export function currencyDigits(currency: string): number {
  let d = digitsCache.get(currency);
  if (d === undefined) {
    d =
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    digitsCache.set(currency, d);
  }
  return d;
}

/**
 * Round half away from zero. `toPrecision(15)` strips binary float noise first,
 * so 1.005 → 1.01 and 2.675 → 2.68 as a human would expect.
 */
export function roundHalfUp(value: number, digits = 0): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  const shifted = Number((Math.abs(value) * factor).toPrecision(15));
  const rounded = Math.round(shifted) / factor;
  return value < 0 ? -rounded : rounded;
}

/** Major units (e.g. 12.34) → integer minor units (1234) for the currency. */
export function toMinor(amount: number, currency: string): number {
  return Math.round(roundHalfUp(amount, currencyDigits(currency)) * 10 ** currencyDigits(currency));
}

/** Integer minor units → major units number. */
export function fromMinor(minor: number, currency: string): number {
  return minor / 10 ** currencyDigits(currency);
}

const formatterCache = new Map<string, Intl.NumberFormat>();

export function formatMoney(minor: number, currency: string, locale: string): string {
  const key = `${locale}|${currency}`;
  let fmt = formatterCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, { style: 'currency', currency });
    formatterCache.set(key, fmt);
  }
  return fmt.format(fromMinor(minor, currency));
}

/** Plain number formatting for quantities and percentages. */
export function formatNumber(value: number, locale: string, maxDigits = 2): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: maxDigits }).format(value);
}

/**
 * Parse an amount typed by a person ("1,234.5", "1234.50", "¥1200") into
 * integer minor units without going through floating point. Returns null when
 * the text isn't a plain non-negative amount with at most the currency's
 * number of decimals. Commas are treated as thousands separators.
 */
export function parseAmount(input: string, currency: string): number | null {
  const digits = currencyDigits(currency);
  const s = input.trim().replace(/^[^\d.-]+/, '').replace(/,/g, '');
  const m = /^(\d{1,13})(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const [, whole = '0', frac = ''] = m;
  if (frac.length > digits) return null;
  return Number(whole) * 10 ** digits + Number(frac.padEnd(digits, '0') || '0');
}
