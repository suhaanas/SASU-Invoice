import { describe, expect, it } from 'vitest';
import { backupSchema, parseInvoice } from '../src/core/validate';
import { createInvoice, sampleInvoice } from '../src/core/state';

describe('validation', () => {
  it('accepts a valid invoice and strips unknown keys', () => {
    const inv = { ...sampleInvoice(), evil: '<script>' } as unknown;
    const parsed = parseInvoice(inv);
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty('evil');
  });

  it('rejects out-of-range or wrongly typed data', () => {
    const bad = createInvoice();
    expect(parseInvoice({ ...bad, totals: { ...bad.totals, taxRate: 150 } })).toBeNull();
    expect(parseInvoice({ ...bad, meta: { ...bad.meta, currency: 'XXX' } })).toBeNull();
    expect(parseInvoice({ ...bad, items: [{ ...bad.items[0], qty: '1' }] })).toBeNull();
    expect(parseInvoice({ ...bad, style: { ...bad.style, accent: 'red;}body{display:none' } })).toBeNull();
    expect(parseInvoice(null)).toBeNull();
  });

  it('only accepts raster data-URL logos (no SVG, no remote URLs)', () => {
    const inv = createInvoice();
    const withLogo = (logo: string) => parseInvoice({ ...inv, style: { ...inv.style, logo } });
    expect(withLogo('data:image/png;base64,iVBORw0KGgo=')).not.toBeNull();
    expect(withLogo('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(withLogo('https://evil.example/x.png')).toBeNull();
    expect(withLogo('javascript:alert(1)')).toBeNull();
  });

  it('validates backup files', () => {
    const ok = backupSchema.safeParse({ app: 'sasu-invoice', exportedAt: new Date().toISOString(), invoices: [createInvoice()], profile: null });
    expect(ok.success).toBe(true);
    expect(backupSchema.safeParse({ app: 'other', exportedAt: '', invoices: [], profile: null }).success).toBe(false);
  });
});
