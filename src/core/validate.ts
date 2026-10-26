/**
 * Runtime validation for anything that crosses a trust boundary:
 * localStorage (may be stale or tampered with) and imported JSON files.
 * Unknown keys are stripped; out-of-range values are rejected.
 */
import { z } from 'zod';
import { CURRENCY_CODES, LOCALE_CODES } from './money.ts';
import { DUE_TERM_IDS } from './dates.ts';
import {
  DISCOUNT_TYPES,
  DOC_TYPES,
  LOGO_SHAPES,
  OPERATION_CATEGORIES,
  PAYMENT_METHODS,
  STATUSES,
  VAT_CATEGORY_CODES,
  type InvoiceState,
} from './state.ts';

// Our CSP forbids eval; skip zod's JIT (and its `new Function` probe, which
// would otherwise log a CSP violation on every page load).
z.config({ jitless: true });

const MAX_TEXT = 500;
const MAX_LONG_TEXT = 4000;
export const MAX_LOGO_CHARS = 1_500_000;
export const MAX_ITEMS = 500;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const text = (max = MAX_TEXT) => z.string().max(max);
const isoDate = z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);
const money = z.number().finite().min(0).max(1e12);
const percent = z.number().finite().min(0).max(100);

export const logoSchema = z.union([
  z.literal(''),
  z
    .string()
    .max(MAX_LOGO_CHARS)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/),
]);

export const lineItemSchema = z.object({
  id: z.string().min(1).max(64),
  desc: text(MAX_LONG_TEXT),
  qty: z.number().finite().min(0).max(1e9),
  unit: text(20),
  rate: money,
  taxRate: percent.nullable(),
  vatCategory: z.enum(VAT_CATEGORY_CODES).default('S'),
});

export const businessSchema = z.object({
  name: text(),
  address: text(MAX_LONG_TEXT),
  email: text(),
  phone: text(),
  website: text(),
  taxId: text(),
  legal: z
    .object({ form: text(80), capital: text(80), regNumber: text(80), regPlace: text(80) })
    .default({ form: '', capital: '', regNumber: '', regPlace: '' }),
});

export const clientSchema = z.object({
  name: text(),
  company: text(),
  address: text(MAX_LONG_TEXT),
  email: text(),
  phone: text(),
  taxId: text(),
  regNumber: text(80).default(''),
  deliveryAddress: text(MAX_LONG_TEXT).default(''),
});

export const paymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  beneficiary: text(70),
  iban: text(42),
  bic: text(11),
  upiId: text(80),
  link: text(500),
});

const BLANK_PAYMENT = { method: 'none', beneficiary: '', iban: '', bic: '', upiId: '', link: '' } as const;

/**
 * Invoice schema (v2). It also accepts v1 documents written by earlier
 * versions: every field added in v2 has a default, and `version` is upgraded
 * to 2 on parse, so old localStorage data and backups migrate transparently.
 */
export const invoiceSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]).transform(() => 2 as const),
  id: z.string().min(1).max(64),
  docType: z.enum(DOC_TYPES).default('invoice'),
  ref: z.object({ number: text(64), date: isoDate }).nullable().default(null),
  business: businessSchema,
  client: clientSchema,
  meta: z.object({
    number: text(64),
    currency: z.enum(CURRENCY_CODES),
    locale: z.enum(LOCALE_CODES),
    issueDate: isoDate,
    dueTerm: z.enum(DUE_TERM_IDS),
    dueDate: isoDate,
    poNumber: text(64),
    status: z.enum(STATUSES),
    supplyDate: isoDate.default(''),
    supplySameAsIssue: z.boolean().default(true),
    validUntil: isoDate.default(''),
    operation: z.enum(OPERATION_CATEGORIES).default(''),
    issuedAt: z.number().int().nonnegative().nullable().default(null),
  }),
  items: z.array(lineItemSchema).max(MAX_ITEMS),
  totals: z.object({
    discountType: z.enum(DISCOUNT_TYPES),
    discountValue: money,
    taxRate: percent,
    taxLabel: text(30),
    shipping: money,
    amountPaid: money,
  }),
  notes: z.object({
    paymentTerms: text(),
    notes: text(MAX_LONG_TEXT),
    bankDetails: text(MAX_LONG_TEXT),
    footer: text(MAX_LONG_TEXT),
    legalMentions: z.array(text(40)).max(20).default([]),
  }),
  payment: paymentSchema.default({ ...BLANK_PAYMENT }),
  style: z.object({
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    logoShape: z.enum(LOGO_SHAPES),
    logo: logoSchema,
  }),
  updatedAt: z.number().int().nonnegative(),
});

export const profileSchema = z.object({
  business: businessSchema,
  logo: logoSchema,
  logoShape: z.enum(LOGO_SHAPES),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  currency: z.enum(CURRENCY_CODES),
  locale: z.enum(LOCALE_CODES),
  paymentTerms: text(),
  bankDetails: text(MAX_LONG_TEXT),
  footer: text(MAX_LONG_TEXT),
  taxLabel: text(30),
  taxRate: percent,
  legalMentions: z.array(text(40)).max(20).default([]),
  payment: paymentSchema.default({ ...BLANK_PAYMENT }),
});

export const catalogItemSchema = z.object({
  id: z.string().min(1).max(64),
  desc: text(MAX_LONG_TEXT),
  unit: text(20),
  rate: money,
  taxRate: percent.nullable(),
  vatCategory: z.enum(VAT_CATEGORY_CODES).default('S'),
});

export type CatalogItem = z.infer<typeof catalogItemSchema>;

export type Profile = z.infer<typeof profileSchema>;

/** A backup file: either one invoice or a full export. */
export const backupSchema = z.object({
  app: z.literal('sasu-invoice'),
  exportedAt: z.string().max(40),
  invoices: z.array(invoiceSchema).max(10_000),
  profile: profileSchema.nullable(),
  catalog: z.array(catalogItemSchema).max(2000).default([]),
});

export type Backup = z.infer<typeof backupSchema>;

// Compile-time guard: the schema and the TS interface must stay in sync.
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const _invoiceSchemaMatchesType: Equals<z.infer<typeof invoiceSchema>, InvoiceState> = true;
void _invoiceSchemaMatchesType;

export function parseInvoice(data: unknown): InvoiceState | null {
  const r = invoiceSchema.safeParse(data);
  return r.success ? r.data : null;
}
