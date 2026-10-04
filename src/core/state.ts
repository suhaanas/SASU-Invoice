/**
 * Invoice data model and a minimal observable store.
 * The UI renders from this state; DOM inputs only ever write into it.
 */
import type { CurrencyCode, LocaleCode } from './money';
import { dueDateFor, isBefore, todayISO, type DueTerm } from './dates';

export const STATUSES = ['Draft', 'Unpaid', 'Paid', 'Overdue'] as const;
export type Status = (typeof STATUSES)[number];

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
}

export interface Business {
  name: string;
  address: string;
  email: string;
  phone: string;
  website: string;
  taxId: string;
}

export interface Client {
  name: string;
  company: string;
  address: string;
  email: string;
  phone: string;
  taxId: string;
}

export interface InvoiceState {
  version: 1;
  id: string;
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
  };
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
  return { id: uid(), desc: '', qty: 1, unit: '', rate: 0, taxRate: null };
}

export function blankBusiness(): Business {
  return { name: '', address: '', email: '', phone: '', website: '', taxId: '' };
}

export function blankClient(): Client {
  return { name: '', company: '', address: '', email: '', phone: '', taxId: '' };
}

export function createInvoice(overrides: Partial<InvoiceState> = {}): InvoiceState {
  const issueDate = todayISO();
  const base: InvoiceState = {
    version: 1,
    id: uid(),
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
      status: 'Unpaid',
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
    },
    style: { accent: ACCENTS[0].color, logoShape: 'square', logo: '' },
    updatedAt: Date.now(),
  };
  return { ...base, ...overrides };
}

/** The example invoice shown to first-time visitors. */
export function sampleInvoice(): InvoiceState {
  const inv = createInvoice();
  inv.business = {
    name: 'Your Company Name',
    address: '123 Business Ave, Suite 100\nNew York, NY 10001',
    email: 'hello@yourcompany.com',
    phone: '+1 (555) 123-4567',
    website: 'www.yourcompany.com',
    taxId: '',
  };
  inv.client = {
    name: 'John Smith',
    company: '',
    address: '456 Client Street\nLos Angeles, CA 90001',
    email: 'client@email.com',
    phone: '',
    taxId: '',
  };
  inv.items = [{ ...blankItem(), desc: 'Web Design Services', qty: 1, rate: 1000 }];
  return inv;
}

/** Status shown on the invoice: Unpaid flips to Overdue once the due date has passed. */
export function effectiveStatus(state: InvoiceState, today = todayISO()): Status {
  if (state.meta.status === 'Unpaid' && state.meta.dueDate && isBefore(state.meta.dueDate, today)) {
    return 'Overdue';
  }
  return state.meta.status;
}

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
