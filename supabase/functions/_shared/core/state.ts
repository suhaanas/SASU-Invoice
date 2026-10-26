// GENERATED from src/core by scripts/sync-functions-core.mjs. Do not edit.
/**
 * Invoice data model and a minimal observable store.
 * The UI renders from this state; DOM inputs only ever write into it.
 */
import type { CurrencyCode, LocaleCode } from './money.ts';
import { dueDateFor, isBefore, todayISO, type DueTerm } from './dates.ts';

export const DOC_TYPES = ['invoice', 'quote', 'credit', 'receipt', 'proforma'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TITLES: Record<DocType, string> = {
  invoice: 'Invoice',
  quote: 'Quote',
  credit: 'Credit note',
  receipt: 'Receipt',
  proforma: 'Proforma invoice',
};

export const STATUSES = [
  'Draft',
  'Unpaid',
  'Paid',
  'Overdue',
  'Cancelled',
  'Sent',
  'Accepted',
  'Declined',
  'Expired',
  'Issued',
] as const;
export type Status = (typeof STATUSES)[number];

/** Statuses a user can pick for each document type. */
export const STATUSES_BY_TYPE: Record<DocType, readonly Status[]> = {
  invoice: ['Draft', 'Unpaid', 'Paid', 'Overdue', 'Cancelled'],
  quote: ['Draft', 'Sent', 'Accepted', 'Declined', 'Expired'],
  credit: ['Draft', 'Issued'],
  receipt: ['Paid'],
  proforma: ['Draft', 'Sent'],
};

/** Status a document moves to when it is issued. */
export const ISSUED_STATUS: Record<DocType, Status> = {
  invoice: 'Unpaid',
  quote: 'Sent',
  credit: 'Issued',
  receipt: 'Paid',
  proforma: 'Sent',
};

/**
 * VAT category codes (UNCL5305, as used by EN 16931):
 * S standard, Z zero-rated, E exempt, AE reverse charge, K intra-EU supply,
 * G export outside the EU, O outside the scope of VAT.
 */
export const VAT_CATEGORIES = [
  { code: 'S', label: 'Standard rate' },
  { code: 'Z', label: 'Zero rated' },
  { code: 'E', label: 'Exempt' },
  { code: 'AE', label: 'Reverse charge' },
  { code: 'K', label: 'Intra-EU supply' },
  { code: 'G', label: 'Export outside the EU' },
  { code: 'O', label: 'Outside scope of VAT' },
] as const;
export type VatCategory = (typeof VAT_CATEGORIES)[number]['code'];
export const VAT_CATEGORY_CODES = VAT_CATEGORIES.map((c) => c.code) as [VatCategory, ...VatCategory[]];

export const PAYMENT_METHODS = ['none', 'sepa', 'upi', 'link'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const OPERATION_CATEGORIES = ['', 'goods', 'services', 'mixed'] as const;
export type OperationCategory = (typeof OPERATION_CATEGORIES)[number];

export const LOGO_SHAPES = ['square', 'rounded', 'circle'] as const;
export type LogoShape = (typeof LOGO_SHAPES)[number];

export const DISCOUNT_TYPES = ['percent', 'fixed'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export interface LineItem {
  id: string;
  desc: string;
  qty: number;
  unit: string;
  /** Major units, as typed by the user. */
  rate: number;
  /** Per-line tax %; null means "use the invoice tax rate". */
  taxRate: number | null;
  vatCategory: VatCategory;
}

export interface Business {
  name: string;
  address: string;
  email: string;
  phone: string;
  website: string;
  taxId: string;
  /** Company registration details printed under the address. */
  legal: {
    form: string;
    capital: string;
    regNumber: string;
    regPlace: string;
  };
}

export interface Client {
  name: string;
  company: string;
  address: string;
  email: string;
  phone: string;
  taxId: string;
  /** Company ID (e.g. French SIREN), required on French B2B invoices from 2026–27. */
  regNumber: string;
  deliveryAddress: string;
}

export interface Payment {
  method: PaymentMethod;
  beneficiary: string;
  iban: string;
  bic: string;
  upiId: string;
  link: string;
}

export interface InvoiceState {
  version: 2;
  id: string;
  docType: DocType;
  /** The invoice a credit note corrects, or the quote an invoice came from. */
  ref: { number: string; date: string } | null;
  business: Business;
  client: Client;
  meta: {
    number: string;
    currency: CurrencyCode;
    locale: LocaleCode;
    issueDate: string;
    dueTerm: DueTerm;
    dueDate: string;
    poNumber: string;
    status: Status;
    supplyDate: string;
    supplySameAsIssue: boolean;
    validUntil: string;
    operation: OperationCategory;
    /** Epoch ms when the document was issued (and locked); null while a draft. */
    issuedAt: number | null;
  };
  items: LineItem[];
  totals: {
    discountType: DiscountType;
    discountValue: number;
    taxRate: number;
    taxLabel: string;
    shipping: number;
    amountPaid: number;
  };
  notes: {
    paymentTerms: string;
    notes: string;
    bankDetails: string;
    footer: string;
    /** IDs of legal wording presets (see legal.ts). */
    legalMentions: string[];
  };
  payment: Payment;
  style: {
    accent: string;
    logoShape: LogoShape;
    /** Re-encoded data URL (PNG/JPEG/WebP only) or ''. */
    logo: string;
  };
  updatedAt: number;
}

export const ACCENTS = [
  { color: '#5b5ef4', name: 'Indigo' },
  { color: '#0d9488', name: 'Teal' },
  { color: '#ea580c', name: 'Orange' },
  { color: '#e11d48', name: 'Rose' },
  { color: '#7c3aed', name: 'Violet' },
  { color: '#0284c7', name: 'Sky' },
  { color: '#059669', name: 'Emerald' },
  { color: '#1e293b', name: 'Slate' },
] as const;

export function uid(): string {
  return crypto.randomUUID();
}

export function blankItem(): LineItem {
  return { id: uid(), desc: '', qty: 1, unit: '', rate: 0, taxRate: null, vatCategory: 'S' };
}

export function blankBusiness(): Business {
  return {
    name: '',
    address: '',
    email: '',
    phone: '',
    website: '',
    taxId: '',
    legal: { form: '', capital: '', regNumber: '', regPlace: '' },
  };
}

export function blankClient(): Client {
  return {
    name: '',
    company: '',
    address: '',
    email: '',
    phone: '',
    taxId: '',
    regNumber: '',
    deliveryAddress: '',
  };
}

export function blankPayment(): Payment {
  return { method: 'none', beneficiary: '', iban: '', bic: '', upiId: '', link: '' };
}

export function createInvoice(overrides: Partial<InvoiceState> = {}): InvoiceState {
  const issueDate = todayISO();
  const base: InvoiceState = {
    version: 2,
    id: uid(),
    docType: 'invoice',
    ref: null,
    business: blankBusiness(),
    client: blankClient(),
    meta: {
      number: 'INV-001',
      currency: 'USD',
      locale: 'en-US',
      issueDate,
      dueTerm: 'net30',
      dueDate: dueDateFor(issueDate, 'net30') ?? issueDate,
      poNumber: '',
      status: 'Draft',
      supplyDate: '',
      supplySameAsIssue: true,
      validUntil: dueDateFor(issueDate, 'net30') ?? issueDate,
      operation: '',
      issuedAt: null,
    },
    items: [blankItem()],
    totals: {
      discountType: 'percent',
      discountValue: 0,
      taxRate: 0,
      taxLabel: 'Tax',
      shipping: 0,
      amountPaid: 0,
    },
    notes: {
      paymentTerms: 'Payment due within 30 days',
      notes: 'Thank you for your business!',
      bankDetails: '',
      footer: '',
      legalMentions: [],
    },
    payment: blankPayment(),
    style: { accent: ACCENTS[0].color, logoShape: 'square', logo: '' },
    updatedAt: Date.now(),
  };
  return { ...base, ...overrides };
}

/** The example invoice shown to first-time visitors. */
export function sampleInvoice(): InvoiceState {
  const inv = createInvoice();
  inv.business = {
    ...blankBusiness(),
    name: 'Your Company Name',
    address: '123 Business Ave, Suite 100\nNew York, NY 10001',
    email: 'hello@yourcompany.com',
    phone: '+1 (555) 123-4567',
    website: 'www.yourcompany.com',
  };
  inv.client = {
    ...blankClient(),
    name: 'John Smith',
    company: '',
    address: '456 Client Street\nLos Angeles, CA 90001',
    email: 'client@email.com',
  };
  inv.items = [{ ...blankItem(), desc: 'Web Design Services', qty: 1, rate: 1000 }];
  return inv;
}

/**
 * Status shown on the document: an unpaid invoice past its due date shows as
 * Overdue, and a sent quote past its validity date shows as Expired.
 */
export function effectiveStatus(state: InvoiceState, today = todayISO()): Status {
  const { status, dueDate, validUntil } = state.meta;
  if (state.docType === 'invoice' && status === 'Unpaid' && dueDate && isBefore(dueDate, today)) {
    return 'Overdue';
  }
  if (state.docType === 'quote' && status === 'Sent' && validUntil && isBefore(validUntil, today)) {
    return 'Expired';
  }
  return status;
}

/** The date goods or services were supplied (falls back to the issue date). */
export function supplyDate(state: InvoiceState): string {
  return state.meta.supplySameAsIssue || !state.meta.supplyDate
    ? state.meta.issueDate
    : state.meta.supplyDate;
}

export const isLocked = (state: InvoiceState): boolean => state.meta.issuedAt !== null;

/** "INV-009" → "INV-010"; "2026/7" → "2026/8"; "Acme" → "Acme-2". */
export function nextInvoiceNumber(current: string): string {
  const m = /^(.*?)(\d+)(\D*)$/.exec(current);
  if (!m) return current ? `${current}-2` : 'INV-001';
  const [, prefix = '', digits = '', suffix = ''] = m;
  const next = String(Number(digits) + 1).padStart(digits.length, '0');
  return `${prefix}${next}${suffix}`;
}

// --- Store ---------------------------------------------------------------

type Listener<T> = (state: T) => void;

export interface Store<T> {
  get(): T;
  set(next: T): void;
  update(mutator: (draft: T) => void): void;
  subscribe(listener: Listener<T>): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener<T>>();
  const emit = () => listeners.forEach((l) => l(state));
  return {
    get: () => state,
    set(next) {
      state = next;
      emit();
    },
    update(mutator) {
      const draft = structuredClone(state);
      mutator(draft);
      state = draft;
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
