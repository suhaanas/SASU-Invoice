import { beforeEach, describe, expect, it } from 'vitest';
import { addMonths } from '../src/core/dates';
import { findDuplicate, nextNumber } from '../src/core/numbering';
import { createInvoice } from '../src/core/state';
import { loadInvoices, quarantineCount } from '../src/core/storage';
import { parseInvoice } from '../src/core/validate';

/** A record exactly as v3.0 (schema v1) wrote it to localStorage. */
const V1 = {
  version: 1,
  id: 'abc',
  business: { name: 'Acme', address: '', email: '', phone: '', website: '', taxId: '' },
  client: { name: 'Jo', company: '', address: '', email: '', phone: '', taxId: '' },
  meta: {
    number: 'INV-007', currency: 'EUR', locale: 'fr-FR', issueDate: '2026-01-31', dueTerm: 'net30',
    dueDate: '2026-03-02', poNumber: '', status: 'Unpaid',
  },
  items: [{ id: 'i1', desc: 'Design', qty: 1, unit: '', rate: 100, taxRate: null }],
  totals: { discountType: 'percent', discountValue: 0, taxRate: 20, taxLabel: 'TVA', shipping: 0, amountPaid: 0 },
  notes: { paymentTerms: '', notes: '', bankDetails: '', footer: '' },
  style: { accent: '#5b5ef4', logoShape: 'square', logo: '' },
  updatedAt: 1,
};

describe('schema v2 migration', () => {
  it('upgrades v1 records with safe defaults', () => {
    const inv = parseInvoice(V1)!;
    expect(inv.version).toBe(2);
    expect(inv.docType).toBe('invoice');
    expect(inv.meta.issuedAt).toBeNull();
    expect(inv.meta.supplySameAsIssue).toBe(true);
    expect(inv.items[0]!.vatCategory).toBe('S');
    expect(inv.payment.method).toBe('none');
    expect(inv.notes.legalMentions).toEqual([]);
    expect(inv.business.legal.form).toBe('');
  });

  it('round-trips a v2 document', () => {
    const inv = createInvoice({ docType: 'quote' });
    expect(parseInvoice(JSON.parse(JSON.stringify(inv)))).toEqual(inv);
  });

  describe('storage', () => {
    beforeEach(() => localStorage.clear());

    it('quarantines invalid records instead of dropping them', () => {
      localStorage.setItem('sasu:v3:invoices', JSON.stringify([V1, { ...V1, id: 'bad', meta: { ...V1.meta, currency: 'XXX' } }]));
      const loaded = loadInvoices();
      expect(loaded.map((i) => i.id)).toEqual(['abc']);
      expect(quarantineCount()).toBe(1);
    });
  });
});

describe('numbering', () => {
  const doc = (docType: 'invoice' | 'quote', number: string) => {
    const d = createInvoice({ docType });
    d.meta.number = number;
    return d;
  };

  it('continues each series from its highest number', () => {
    const docs = [doc('invoice', 'INV-009'), doc('invoice', 'INV-010'), doc('quote', 'QUO-003')];
    expect(nextNumber('invoice', docs)).toBe('INV-011');
    expect(nextNumber('quote', docs)).toBe('QUO-004');
    expect(nextNumber('credit', docs)).toBe('CN-001');
  });

  it('finds duplicates only within the same document type', () => {
    const a = doc('invoice', 'INV-001');
    expect(findDuplicate(doc('invoice', 'inv-001 '), [a])).toBe(a);
    expect(findDuplicate(doc('quote', 'INV-001'), [a])).toBeUndefined();
  });
});

describe('addMonths', () => {
  it('clamps to month ends', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
  });
});
