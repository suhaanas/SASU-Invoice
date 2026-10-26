/**
 * localStorage persistence. Everything read back is re-validated with zod, and
 * every access is wrapped because storage can be disabled, full, or throw in
 * private windows. Nothing ever leaves the browser.
 */
import {
  catalogItemSchema,
  invoiceSchema,
  profileSchema,
  type CatalogItem,
  type Profile,
} from './validate.ts';
import type { Client, InvoiceState } from './state.ts';

const KEYS = {
  invoices: 'sasu:v3:invoices',
  current: 'sasu:v3:current',
  profile: 'sasu:v3:profile',
  catalog: 'sasu:v3:catalog',
  quarantine: 'sasu:v3:quarantine',
  lastBackup: 'sasu:v3:lastBackupAt',
  invoicePrefix: 'sasu:v3:invoicePrefix',
} as const;

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load saved invoices. Older (v1) records are migrated by the schema. Records
 * that fail validation are moved to a quarantine key rather than deleted, so a
 * bug or a bad edit never silently destroys someone's invoice.
 */
export function loadInvoices(): InvoiceState[] {
  const data = read(KEYS.invoices);
  if (!Array.isArray(data)) return [];
  const out: InvoiceState[] = [];
  const rejected: unknown[] = [];
  for (const entry of data) {
    const r = invoiceSchema.safeParse(entry);
    if (r.success) out.push(r.data);
    else rejected.push(entry);
  }
  if (rejected.length > 0) {
    const prior = read(KEYS.quarantine);
    write(KEYS.quarantine, [...(Array.isArray(prior) ? prior : []), ...rejected].slice(-200));
    write(KEYS.invoices, out);
  }
  return out;
}

export function quarantineCount(): number {
  const q = read(KEYS.quarantine);
  return Array.isArray(q) ? q.length : 0;
}

export function loadCatalog(): CatalogItem[] {
  const data = read(KEYS.catalog);
  if (!Array.isArray(data)) return [];
  return data.flatMap((d) => {
    const r = catalogItemSchema.safeParse(d);
    return r.success ? [r.data] : [];
  });
}

export function saveCatalog(items: CatalogItem[]): boolean {
  return write(KEYS.catalog, items);
}

export function loadLastBackup(): number | null {
  const v = read(KEYS.lastBackup);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function saveLastBackup(at: number): void {
  write(KEYS.lastBackup, at);
}

/** Custom invoice-number prefix chosen during cloud onboarding ('' = default). */
export function loadInvoicePrefix(): string {
  const v = read(KEYS.invoicePrefix);
  return typeof v === 'string' && /^[\w\-/.#]{1,20}$/.test(v) ? v : '';
}

export function saveInvoicePrefix(prefix: string): void {
  write(KEYS.invoicePrefix, prefix);
}

export function saveInvoices(list: InvoiceState[]): boolean {
  return write(KEYS.invoices, list);
}

export function loadCurrentId(): string | null {
  const v = read(KEYS.current);
  return typeof v === 'string' ? v : null;
}

export function saveCurrentId(id: string): void {
  write(KEYS.current, id);
}

export function loadProfile(): Profile | null {
  const r = profileSchema.safeParse(read(KEYS.profile));
  return r.success ? r.data : null;
}

export function saveProfile(profile: Profile): boolean {
  return write(KEYS.profile, profile);
}

export function clearAllData(): void {
  try {
    Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

export function profileFromInvoice(inv: InvoiceState): Profile {
  return {
    business: inv.business,
    logo: inv.style.logo,
    logoShape: inv.style.logoShape,
    accent: inv.style.accent,
    currency: inv.meta.currency,
    locale: inv.meta.locale,
    paymentTerms: inv.notes.paymentTerms,
    bankDetails: inv.notes.bankDetails,
    footer: inv.notes.footer,
    taxLabel: inv.totals.taxLabel,
    taxRate: inv.totals.taxRate,
    legalMentions: inv.notes.legalMentions,
    payment: inv.payment,
  };
}

/** Apply a saved business profile onto a fresh invoice. */
export function applyProfile(inv: InvoiceState, p: Profile): InvoiceState {
  return {
    ...inv,
    business: { ...p.business },
    meta: { ...inv.meta, currency: p.currency, locale: p.locale },
    totals: { ...inv.totals, taxLabel: p.taxLabel, taxRate: p.taxRate },
    notes: {
      ...inv.notes,
      paymentTerms: p.paymentTerms,
      bankDetails: p.bankDetails,
      footer: p.footer,
      legalMentions: [...p.legalMentions],
    },
    payment: { ...p.payment },
    style: { accent: p.accent, logoShape: p.logoShape, logo: p.logo },
  };
}

/** Unique clients across saved invoices, most recently used first. */
export function clientBook(invoices: InvoiceState[]): Client[] {
  const seen = new Map<string, Client>();
  [...invoices]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .forEach((inv) => {
      const c = inv.client;
      if (!c.name.trim() && !c.company.trim()) return;
      const key = `${c.name.trim().toLowerCase()}|${c.company.trim().toLowerCase()}`;
      if (!seen.has(key)) seen.set(key, { ...c });
    });
  return [...seen.values()];
}
