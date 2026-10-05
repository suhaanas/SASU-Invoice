import { describe, expect, it } from 'vitest';
import { computeTotals } from '../src/core/calc';
import { csvField, documentsToCsv } from '../src/core/csv';
import { companyLine, legalMentionTexts, legalWarnings } from '../src/core/legal';
import { creditNoteFor, duplicateDoc, invoiceFromQuote, repeatNextPeriod } from '../src/core/lifecycle';
import { epcPayload, isValidIban, paymentQr, safePaymentLink, upiPayload } from '../src/core/payment';
import { blankItem, createInvoice, type InvoiceState } from '../src/core/state';
import { parseInvoice } from '../src/core/validate';
import { makeQr } from '../src/ui/qr';

function invoice(over: Partial<InvoiceState> = {}): InvoiceState {
  const inv = createInvoice(over);
  inv.meta.number = 'INV-007';
  inv.meta.currency = 'EUR';
  inv.business.name = 'Mira Studio';
  inv.items = [{ ...blankItem(), desc: 'Design', qty: 2, rate: 250 }];
  return inv;
}

describe('payments', () => {
  it('validates IBANs with the mod-97 checksum', () => {
    expect(isValidIban('FR76 3000 6000 0112 3456 7890 189')).toBe(true);
    expect(isValidIban('DE89370400440532013000')).toBe(true);
    expect(isValidIban('DE89370400440532013001')).toBe(false);
    expect(isValidIban('nonsense')).toBe(false);
  });

  it('builds an EPC069-12 payload in the right field order', () => {
    const r = epcPayload({ beneficiary: 'Mira Studio', iban: 'DE89 3704 0044 0532 0130 00', bic: '', amountMinor: 50000, currency: 'EUR', remittance: 'Invoice INV-007' });
    expect('payload' in r).toBe(true);
    const lines = (r as { payload: string }).payload.split('\n');
    expect(lines).toEqual(['BCD', '002', '1', 'SCT', '', 'Mira Studio', 'DE89370400440532013000', 'EUR500.00', '', '', 'Invoice INV-007']);
  });

  it('refuses EPC for non-euro invoices and over-long payloads', () => {
    expect(epcPayload({ beneficiary: 'A', iban: 'DE89370400440532013000', bic: '', amountMinor: 100, currency: 'USD', remittance: '' })).toHaveProperty('error');
    expect(epcPayload({ beneficiary: 'x'.repeat(71), iban: 'DE89370400440532013000', bic: '', amountMinor: 100, currency: 'EUR', remittance: '' })).toHaveProperty('error');
  });

  it('builds a UPI link for rupee invoices only', () => {
    const r = upiPayload({ upiId: 'mira@okbank', name: 'Mira', amountMinor: 123456, currency: 'INR', note: 'Invoice 7' });
    expect((r as { payload: string }).payload).toBe('upi://pay?pa=mira%40okbank&pn=Mira&am=1234.56&cu=INR&tn=Invoice+7');
    expect(upiPayload({ upiId: 'mira@okbank', name: 'M', amountMinor: 1, currency: 'EUR', note: '' })).toHaveProperty('error');
  });

  it('only accepts https payment links', () => {
    expect(safePaymentLink('https://buy.stripe.com/abc')).toBe('https://buy.stripe.com/abc');
    expect(safePaymentLink('javascript:alert(1)')).toBeNull();
    expect(safePaymentLink('http://paypal.me/x')).toBeNull();
  });

  it('shows a QR only on invoices with a balance due', () => {
    const inv = invoice();
    inv.payment = { method: 'sepa', beneficiary: '', iban: 'DE89370400440532013000', bic: '', upiId: '', link: '' };
    expect(paymentQr(inv, computeTotals(inv))).toHaveProperty('payload');
    inv.totals.amountPaid = 500;
    expect(paymentQr(inv, computeTotals(inv))).toBeNull();
    const quote = invoice({ docType: 'quote' });
    quote.payment = inv.payment;
    expect(paymentQr(quote, computeTotals(quote))).toBeNull();
  });

  it('encodes UTF-8 payloads into a scannable matrix', () => {
    const m = makeQr('BCD\n002\n1\nSCT\n\nCafé Müller\nDE89370400440532013000\nEUR1.00');
    expect(m.size).toBeGreaterThanOrEqual(21);
  });
});

describe('CSV export', () => {
  it('quotes fields and neutralises spreadsheet formulas', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('-5')).toBe("'-5");
    expect(csvField('@cmd')).toBe("'@cmd");
  });

  it('writes one row per line item with document totals', () => {
    const inv = invoice();
    const csv = documentsToCsv([inv]).trim().split('\r\n');
    expect(csv).toHaveLength(2);
    expect(csv[1]).toContain('INV-007');
    expect(csv[1]).toContain('500.00');
  });
});

describe('legal', () => {
  it('prints selected wording and the company line', () => {
    const inv = invoice();
    inv.notes.legalMentions = ['fr-franchise'];
    inv.business.legal = { form: 'SASU', capital: '1 000 €', regNumber: 'SIREN 123 456 789', regPlace: 'RCS Paris' };
    expect(legalMentionTexts(inv)).toEqual(['TVA non applicable, art. 293 B du CGI']);
    expect(companyLine(inv)).toBe('SASU · Capital 1 000 € · SIREN 123 456 789 · RCS Paris');
  });

  it('warns when reverse charge has no client VAT number', () => {
    const inv = invoice();
    inv.notes.legalMentions = ['reverse-charge'];
    expect(legalWarnings(inv).join(' ')).toMatch(/VAT number/);
    inv.client.taxId = 'DE123456789';
    expect(legalWarnings(inv)).toEqual([]);
  });
});

describe('lifecycle', () => {
  const docs = [invoice()];

  it('converts a quote into a referenced invoice draft', () => {
    const q = invoice({ docType: 'quote' });
    q.meta.number = 'QUO-004';
    const inv = invoiceFromQuote(q, docs);
    expect(inv.docType).toBe('invoice');
    expect(inv.meta.number).toBe('INV-008');
    expect(inv.ref?.number).toBe('QUO-004');
    expect(inv.meta.issuedAt).toBeNull();
    expect(inv.id).not.toBe(q.id);
    expect(parseInvoice(inv)).not.toBeNull();
  });

  it('creates a credit note that references the invoice', () => {
    const src = docs[0]!;
    src.meta.issuedAt = 1;
    const cn = creditNoteFor(src, docs);
    expect(cn.docType).toBe('credit');
    expect(cn.meta.number).toBe('CN-001');
    expect(cn.ref).toEqual({ number: 'INV-007', date: src.meta.issueDate });
    expect(cn.meta.status).toBe('Draft');
  });

  it('repeats next month with shifted dates and a fresh number', () => {
    const src = invoice();
    src.meta.issueDate = '2026-01-31';
    src.meta.dueDate = '2026-03-02';
    const next = repeatNextPeriod(src, [src]);
    expect(next.meta.issueDate).toBe('2026-02-28');
    expect(next.meta.dueDate).toBe('2026-04-02');
    expect(next.meta.number).toBe('INV-008');
    expect(next.totals.amountPaid).toBe(0);
  });

  it('duplicates with new ids for every line', () => {
    const src = invoice();
    const copy = duplicateDoc(src, [src]);
    expect(copy.items[0]!.id).not.toBe(src.items[0]!.id);
  });
});
