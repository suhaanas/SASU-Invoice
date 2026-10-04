import { describe, expect, it } from 'vitest';
import { currencyDigits, formatMoney, roundHalfUp, toMinor } from '../src/core/money';

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
