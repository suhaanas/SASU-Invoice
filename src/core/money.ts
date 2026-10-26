/**
 * Money helpers. All arithmetic happens on integer minor units (cents, paise…)
 * so totals never drift from floating-point error.
 *
 * Every ISO 4217 currency is supported. The number of decimals comes from the
 * ISO 4217 table below, not from Intl: browsers, Node and Deno disagree for
 * some currencies (e.g. HUF, IDR, PKR), and the browser, the server and the
 * database (app.currency_digits) must all compute the same totals.
 */

/** ISO 4217 codes accepted on documents (circulating currencies). */
export const CURRENCY_CODES = [
  'AED',
  'AFN',
  'ALL',
  'AMD',
  'ANG',
  'AOA',
  'ARS',
  'AUD',
  'AWG',
  'AZN',
  'BAM',
  'BBD',
  'BDT',
  'BGN',
  'BHD',
  'BIF',
  'BMD',
  'BND',
  'BOB',
  'BRL',
  'BSD',
  'BTN',
  'BWP',
  'BYN',
  'BZD',
  'CAD',
  'CDF',
  'CHF',
  'CLP',
  'CNY',
  'COP',
  'CRC',
  'CUP',
  'CVE',
  'CZK',
  'DJF',
  'DKK',
  'DOP',
  'DZD',
  'EGP',
  'ERN',
  'ETB',
  'EUR',
  'FJD',
  'FKP',
  'GBP',
  'GEL',
  'GHS',
  'GIP',
  'GMD',
  'GNF',
  'GTQ',
  'GYD',
  'HKD',
  'HNL',
  'HTG',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'IQD',
  'IRR',
  'ISK',
  'JMD',
  'JOD',
  'JPY',
  'KES',
  'KGS',
  'KHR',
  'KMF',
  'KPW',
  'KRW',
  'KWD',
  'KYD',
  'KZT',
  'LAK',
  'LBP',
  'LKR',
  'LRD',
  'LSL',
  'LYD',
  'MAD',
  'MDL',
  'MGA',
  'MKD',
  'MMK',
  'MNT',
  'MOP',
  'MRU',
  'MUR',
  'MVR',
  'MWK',
  'MXN',
  'MYR',
  'MZN',
  'NAD',
  'NGN',
  'NIO',
  'NOK',
  'NPR',
  'NZD',
  'OMR',
  'PAB',
  'PEN',
  'PGK',
  'PHP',
  'PKR',
  'PLN',
  'PYG',
  'QAR',
  'RON',
  'RSD',
  'RUB',
  'RWF',
  'SAR',
  'SBD',
  'SCR',
  'SDG',
  'SEK',
  'SGD',
  'SHP',
  'SLL',
  'SOS',
  'SRD',
  'SSP',
  'STN',
  'SVC',
  'SYP',
  'SZL',
  'THB',
  'TJS',
  'TMT',
  'TND',
  'TOP',
  'TRY',
  'TTD',
  'TWD',
  'TZS',
  'UAH',
  'UGX',
  'USD',
  'UYU',
  'UZS',
  'VES',
  'VND',
  'VUV',
  'WST',
  'XAF',
  'XCD',
  'XOF',
  'XPF',
  'YER',
  'ZAR',
  'ZMW',
  'ZWL',
] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

/** ISO 4217 minor units where they aren't 2. Mirrored in SQL by app.currency_digits. */
export const MINOR_UNITS: Readonly<Record<string, number>> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
};

/** Shown first in currency pickers, in this order. */
const POPULAR: readonly CurrencyCode[] = [
  'USD',
  'EUR',
  'GBP',
  'INR',
  'LKR',
  'JPY',
  'AUD',
  'CAD',
  'CHF',
  'SGD',
  'AED',
  'NZD',
  'ZAR',
];

export function isCurrencyCode(code: string): code is CurrencyCode {
  return (CURRENCY_CODES as readonly string[]).includes(code);
}

function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames('en', { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** All currencies for pickers: the popular ones first, then A–Z by name. */
export const CURRENCIES: readonly { code: CurrencyCode; name: string }[] = [
  ...POPULAR.map((code) => ({ code, name: currencyName(code) })),
  ...CURRENCY_CODES.filter((c) => !POPULAR.includes(c))
    .map((code) => ({ code, name: currencyName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name)),
];

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

/** Number of minor-unit digits for a currency (JPY → 0, USD → 2, KWD → 3). */
export function currencyDigits(currency: string): number {
  return MINOR_UNITS[currency] ?? 2;
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
    const digits = currencyDigits(currency);
    fmt = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
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
  const s = input
    .trim()
    .replace(/^[^\d.-]+/, '')
    .replace(/,/g, '');
  const m = /^(\d{1,13})(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const [, whole = '0', frac = ''] = m;
  if (frac.length > digits) return null;
  return Number(whole) * 10 ** digits + Number(frac.padEnd(digits, '0') || '0');
}
