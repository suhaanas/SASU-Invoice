import { describe, expect, it } from 'vitest';
import { createInvoice, effectiveStatus, nextInvoiceNumber } from '../src/core/state';

describe('state helpers', () => {
  it('increments invoice numbers keeping padding and affixes', () => {
    expect(nextInvoiceNumber('INV-001')).toBe('INV-002');
    expect(nextInvoiceNumber('INV-099')).toBe('INV-100');
    expect(nextInvoiceNumber('2026/7')).toBe('2026/8');
    expect(nextInvoiceNumber('A12-B')).toBe('A13-B');
    expect(nextInvoiceNumber('Acme')).toBe('Acme-2');
    expect(nextInvoiceNumber('')).toBe('INV-001');
  });

  it('marks unpaid invoices past due as overdue, never paid ones', () => {
    const s = createInvoice();
    s.meta.dueDate = '2026-01-01';
    expect(effectiveStatus(s, '2026-01-02')).toBe('Overdue');
    expect(effectiveStatus(s, '2026-01-01')).toBe('Unpaid');
    s.meta.status = 'Paid';
    expect(effectiveStatus(s, '2026-06-01')).toBe('Paid');
  });
});
