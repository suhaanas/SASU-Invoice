import { describe, expect, it } from 'vitest';
import {
  CURRENCIES,
  CURRENCY_CODES,
  currencyDigits,
  formatMoney,
  isCurrencyCode,
  parseAmount,
  roundHalfUp,
  toMinor,
} from '../src/core/money';

describe('money', () => {
  it('knows currency minor-unit digits', () => {
    expect(currencyDigits('USD')).toBe(2);
    expect(currencyDigits('JPY')).toBe(0);
    expect(currencyDigits('INR')).toBe(2);
  });

  it('rounds half up without float artefacts', () => {
    expect(roundHalfUp(1.005, 2)).toBe(1.01);
    expect(roundHalfUp(2.675, 2)).toBe(2.68);
    expect(roundHalfUp(-1.005, 2)).toBe(-1.01);
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(Number.NaN)).toBe(0);
  });

  it('converts to integer minor units per currency', () => {
    expect(toMinor(12.34, 'USD')).toBe(1234);
    expect(toMinor(0.1 + 0.2, 'USD')).toBe(30);
    expect(toMinor(1000.5, 'JPY')).toBe(1001);
    expect(toMinor(1.005, 'EUR')).toBe(101);
  });

  it('formats JPY without decimals and INR with lakh grouping', () => {
    expect(formatMoney(150000, 'JPY', 'en-US')).toBe('¥150,000');
    expect(formatMoney(12345678, 'INR', 'en-IN')).toBe('₹1,23,456.78');
    expect(formatMoney(123456, 'EUR', 'de-DE')).toMatch(/1\.234,56\s€/);
  });
});

describe('parseAmount', () => {
  it('converts typed amounts to minor units exactly', () => {
    expect(parseAmount('1234.56', 'USD')).toBe(123456);
    expect(parseAmount('1,234.5', 'GBP')).toBe(123450);
    expect(parseAmount('0.1', 'EUR')).toBe(10);
    expect(parseAmount('£ 19.99', 'GBP')).toBe(1999);
    expect(parseAmount('1200', 'JPY')).toBe(1200);
    expect(parseAmount('  7 ', 'USD')).toBe(700);
  });

  it('rejects anything ambiguous', () => {
    expect(parseAmount('', 'USD')).toBeNull();
    expect(parseAmount('-5', 'USD')).toBeNull();
    expect(parseAmount('1.234', 'USD')).toBeNull();
    expect(parseAmount('12.5', 'JPY')).toBeNull();
    expect(parseAmount('1e5', 'USD')).toBeNull();
    expect(parseAmount('12abc', 'USD')).toBeNull();
  });
});

describe('every currency', () => {
  it('offers all circulating ISO 4217 currencies, popular ones (incl. LKR) first', () => {
    expect(CURRENCY_CODES.length).toBe(155);
    expect(CURRENCIES.map((c) => c.code).slice(0, 5)).toEqual(['USD', 'EUR', 'GBP', 'INR', 'LKR']);
    expect(new Set(CURRENCIES.map((c) => c.code)).size).toBe(CURRENCY_CODES.length);
    expect(isCurrencyCode('LKR')).toBe(true);
    expect(isCurrencyCode('XOF')).toBe(true);
    expect(isCurrencyCode('ABC')).toBe(false);
  });

  it('uses ISO 4217 decimals, not the runtime’s (which differ between browsers)', () => {
    expect(currencyDigits('LKR')).toBe(2);
    expect(currencyDigits('HUF')).toBe(2);
    expect(currencyDigits('IDR')).toBe(2);
    expect(currencyDigits('KRW')).toBe(0);
    expect(currencyDigits('KWD')).toBe(3);
    expect(toMinor(12.345, 'KWD')).toBe(12345);
    expect(formatMoney(150000, 'LKR', 'en-GB')).toMatch(/^LKR\s1,500\.00$/u);
    expect(formatMoney(123456, 'HUF', 'en-GB')).toMatch(/1,234\.56/);
    expect(formatMoney(1234, 'KWD', 'en-GB')).toMatch(/1\.234/);
  });
});
