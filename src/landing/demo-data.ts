/**
 * Demo invoices for the landing page, built with the same factories the
 * editor uses, so they always validate against the real data model.
 */
import { blankBusiness, blankClient, blankItem, createInvoice, type InvoiceState } from '../core/state';

export interface DemoLine {
  desc: string;
  qty: number;
  unit: string;
  rate: number;
}

export const HERO_LINES: DemoLine[] = [
  { desc: 'Brand identity: logo, palette and type guidelines', qty: 1, unit: '', rate: 1800 },
  { desc: 'Website design, five responsive page templates', qty: 5, unit: 'pages', rate: 420 },
  { desc: 'Launch support and handover call', qty: 3, unit: 'hrs', rate: 95 },
];

export const HERO_CLIENT = 'Northwind Coffee Co.';

/** The hero invoice before the timeline fills it in. */
export function heroInvoice(): InvoiceState {
  const inv = createInvoice();
  inv.business = {
    ...blankBusiness(),
    name: 'Mira Okafor Studio',
    address: '14 Canal Street\nBristol BS1 4RR',
    email: 'hello@miraokafor.studio',
    phone: '',
    website: 'miraokafor.studio',
    taxId: '',
  };
  inv.client = { ...blankClient(), address: '22 Harbour Road\nBristol BS1 5DB' };
  inv.meta = {
    ...inv.meta,
    number: 'INV-0042',
    currency: 'GBP',
    locale: 'en-GB',
    issueDate: '2026-10-05',
    dueTerm: 'net15',
    dueDate: '2026-10-20',
    status: 'Unpaid',
  };
  inv.items = [];
  inv.totals = { ...inv.totals, taxRate: 20, taxLabel: 'VAT' };
  inv.notes = {
    paymentTerms: 'Payment due within 15 days',
    notes: 'Thanks for a lovely project.',
    bankDetails: '',
    footer: '',
    legalMentions: [],
  };
  return inv;
}

/** The hero invoice in its finished state (used for reduced motion). */
export function heroInvoiceComplete(): InvoiceState {
  const inv = heroInvoice();
  inv.client.name = HERO_CLIENT;
  inv.items = HERO_LINES.map((l) => ({ ...blankItem(), ...l }));
  return inv;
}

/** A compact invoice for the feature demos. */
export function featureInvoice(): InvoiceState {
  const inv = createInvoice();
  inv.items = [
    { ...blankItem(), desc: 'Design', qty: 1, rate: 1200 },
    { ...blankItem(), desc: 'Development', qty: 1, rate: 2400 },
  ];
  inv.totals = { ...inv.totals, taxRate: 0, taxLabel: 'Tax' };
  return inv;
}
