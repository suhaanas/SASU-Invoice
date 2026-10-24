import { CURRENCIES, type CurrencyCode, type LocaleCode } from '../../core/money';

/** Launch markets first, then other common countries. */
const COUNTRY_CODES = [
  'GB',
  'US',
  'CA',
  'AU',
  'SG',
  'NZ',
  'IE',
  'AE',
  'AT',
  'BE',
  'CH',
  'DE',
  'DK',
  'ES',
  'FI',
  'FR',
  'HK',
  'IN',
  'IT',
  'JP',
  'LK',
  'MY',
  'NL',
  'NO',
  'PT',
  'SE',
  'ZA',
] as const;

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

export const COUNTRIES = COUNTRY_CODES.map((code) => ({
  code,
  name: regionNames.of(code) ?? code,
}));

export { CURRENCIES };

const COUNTRY_CURRENCY: Partial<Record<string, CurrencyCode>> = {
  GB: 'GBP',
  US: 'USD',
  CA: 'CAD',
  AU: 'AUD',
  SG: 'SGD',
  NZ: 'NZD',
  IE: 'EUR',
  AE: 'AED',
  AT: 'EUR',
  BE: 'EUR',
  CH: 'CHF',
  DE: 'EUR',
  ES: 'EUR',
  FI: 'EUR',
  FR: 'EUR',
  IN: 'INR',
  IT: 'EUR',
  JP: 'JPY',
  LK: 'LKR',
  NL: 'EUR',
  PT: 'EUR',
  ZA: 'ZAR',
};

export const currencyForCountry = (country: string): CurrencyCode | undefined =>
  COUNTRY_CURRENCY[country];

/** Number/date format the editor should default to for a country. */
export function localeForCountry(country: string | null): LocaleCode {
  switch (country) {
    case 'GB':
    case 'IE':
    case 'SG':
    case 'NZ':
    case 'AE':
    case 'LK':
    case 'HK':
    case 'MY':
    case 'ZA':
      return 'en-GB';
    case 'AU':
      return 'en-AU';
    case 'IN':
      return 'en-IN';
    case 'FR':
    case 'BE':
      return 'fr-FR';
    case 'DE':
    case 'AT':
    case 'CH':
      return 'de-DE';
    case 'ES':
      return 'es-ES';
    case 'JP':
      return 'ja-JP';
    default:
      return 'en-US';
  }
}

export function timezones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
}

export const browserTimezone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
