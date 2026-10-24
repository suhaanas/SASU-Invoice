/**
 * SASU Invoice — editor entry point.
 * State lives in a single store; the form writes into it, everything else
 * (preview, totals, autosave) renders from it.
 */
import '@fontsource-variable/dm-sans';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import './styles/sheet.css';
import './styles/app.css';

import { computeTotals } from './core/calc';
import { DUE_TERMS, dueDateFor, formatDate } from './core/dates';
import { CURRENCIES, LOCALES, formatMoney } from './core/money';
import {
  ACCENTS,
  DOC_TITLES,
  ISSUED_STATUS,
  STATUSES_BY_TYPE,
  blankClient,
  blankItem,
  createInvoice,
  createStore,
  effectiveStatus,
  isLocked,
  sampleInvoice,
  type DiscountType,
  type DocType,
  type InvoiceState,
  type LogoShape,
} from './core/state';
import { LEGAL_MENTIONS, legalWarnings } from './core/legal';
import { creditNoteFor, duplicateDoc, invoiceFromQuote, repeatNextPeriod } from './core/lifecycle';
import { findDuplicate, nextNumber, seriesPrefix, type Prefixes } from './core/numbering';
import { paymentQr } from './core/payment';
import {
  applyProfile,
  clearAllData,
  clientBook,
  loadCurrentId,
  loadLastBackup,
  loadInvoicePrefix,
  loadInvoices,
  loadProfile,
  profileFromInvoice,
  saveCurrentId,
  saveInvoices,
  saveLastBackup,
  saveProfile,
} from './core/storage';
import { documentsToCsv } from './core/csv';
import { initCatalog } from './editor/catalog';
import { initCloudSync } from './editor/cloud';
import { cloudConfig } from './cloud/config';
import { initPwa } from './editor/pwa';
import { NOTE_TONES, suggestNote, type NoteTone } from './core/suggestions';
import type { Profile } from './core/validate';
import { byId, downloadBlob, el, icon, safeFileName } from './ui/dom';
import { downloadBackup, exportPDF, exportPNG, exportPrint, readBackup } from './ui/exports';
import { bindItems, refreshItemTotals, rerenderItems } from './ui/items';
import { LogoError, processLogo, recheckLogo } from './ui/logo';
import { applyAccent, renderPreview, renderSummary } from './ui/render';
import { showToast } from './ui/toast';

// --- Boot -----------------------------------------------------------------

let invoices = loadInvoices();
let profile: Profile | null = loadProfile();
const prefixes: Prefixes = { invoice: loadInvoicePrefix() };

function freshInvoice(type: DocType = 'invoice'): InvoiceState {
  const inv = createInvoice({ docType: type });
  inv.meta.number = nextNumber(type, invoices, undefined, prefixes);
  inv.meta.status = STATUSES_BY_TYPE[type][0]!;
  return profile ? applyProfile(inv, profile) : inv;
}

function initialInvoice(): InvoiceState {
  const id = loadCurrentId();
  const found = invoices.find((i) => i.id === id) ?? invoices[0];
  if (found) return found;
  return profile ? freshInvoice() : sampleInvoice();
}

const store = createStore<InvoiceState>(initialInvoice());

// --- Path binding -----------------------------------------------------------

type Bindable = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

function setPath(obj: unknown, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const target = keys.reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], obj);
  (target as Record<string, unknown>)[last] = value;
}

function numberLimit(path: string, s: InvoiceState): number {
  if (path === 'totals.taxRate') return 100;
  if (path === 'totals.discountValue' && s.totals.discountType === 'percent') return 100;
  return 1e12;
}

function readField(input: Bindable, path: string, s: InvoiceState): unknown {
  if (input instanceof HTMLInputElement && input.type === 'checkbox') return input.checked;
  if (!('num' in input.dataset)) return input.value;
  const n = Number(input.value);
  if (input.value.trim() === '' || !Number.isFinite(n)) return 0;
  return Math.min(numberLimit(path, s), Math.max(0, n));
}

function onFieldInput(e: Event): void {
  const input = e.target as Bindable;
  const path = input.dataset?.bind;
  if (!path) return;
  const before = store.get();
  store.update((s) => {
    if (path.startsWith('ref.') && !s.ref) s.ref = { number: '', date: '' };
    setPath(s, path, readField(input, path, s));
    if (path === 'docType') onDocTypeChange(before, s);
    if (path === 'meta.issueDate' || path === 'meta.dueTerm') {
      const due = dueDateFor(s.meta.issueDate, s.meta.dueTerm);
      if (due) s.meta.dueDate = due;
    }
    if (path === 'meta.dueDate') s.meta.dueTerm = 'custom';
  });
}

/**
 * Switching document type on a draft: move it to the new number series (if it
 * was still using the old series' default numbering) and pick a valid status.
 */
function onDocTypeChange(before: InvoiceState, s: InvoiceState): void {
  const allowed = STATUSES_BY_TYPE[s.docType];
  if (!allowed.includes(s.meta.status)) s.meta.status = allowed[0]!;
  if (s.meta.issuedAt === null && s.meta.number.startsWith(seriesPrefix(before.docType, prefixes))) {
    s.meta.number = nextNumber(s.docType, invoices, s.id, prefixes);
  }
  if (s.docType === 'credit' && !s.ref) s.ref = { number: '', date: '' };
  if (s.docType === 'quote' && !s.meta.validUntil) s.meta.validUntil = s.meta.dueDate;
}

function syncForm(s: InvoiceState): void {
  document.querySelectorAll<Bindable>('[data-bind]').forEach((input) => {
    if (input === document.activeElement) return;
    if (input instanceof HTMLInputElement && input.type === 'checkbox') {
      input.checked = Boolean(getPath(s, input.dataset.bind!));
      return;
    }
    const value = getPath(s, input.dataset.bind!);
    const str = value === null || value === undefined ? '' : String(value);
    if (input.value !== str) input.value = str;
  });
}

// --- Static UI setup --------------------------------------------------------

function fillSelect(select: HTMLSelectElement, options: { value: string; label: string }[]): void {
  select.replaceChildren(...options.map((o) => el('option', { text: o.label, attrs: { value: o.value } })));
}

document.querySelectorAll<HTMLSelectElement>('select[data-options]').forEach((sel) => {
  const kind = sel.dataset.options;
  if (kind === 'currency') fillSelect(sel, CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` })));
  if (kind === 'locale') fillSelect(sel, LOCALES.map((l) => ({ value: l.code, label: l.name })));
  if (kind === 'dueTerm') fillSelect(sel, DUE_TERMS.map((t) => ({ value: t.id, label: t.label })));
});

byId('colorGrid').replaceChildren(
  ...ACCENTS.map((a) => {
    const b = el('button', {
      class: 'swatch',
      attrs: { type: 'button', 'data-color': a.color, 'aria-label': a.name, title: a.name, 'aria-pressed': 'false' },
    });
    b.style.setProperty('--c', a.color);
    return b;
  }),
);

// Legal wording checkboxes
byId('legalMentions').replaceChildren(
  ...LEGAL_MENTIONS.map((m) => {
    const box = el('input', { attrs: { type: 'checkbox', value: m.id, 'data-legal': m.id } });
    return el('label', { class: 'check' }, [box, el('span', { text: m.label })]);
  }),
);
byId('legalMentions').addEventListener('change', (e) => {
  const box = e.target as HTMLInputElement;
  const id = box.dataset.legal;
  if (!id) return;
  store.update((s) => {
    const set = new Set(s.notes.legalMentions);
    if (box.checked) set.add(id);
    else set.delete(id);
    s.notes.legalMentions = LEGAL_MENTIONS.map((m) => m.id).filter((x) => set.has(x));
  });
});

// Accordions
document.querySelectorAll<HTMLButtonElement>('.sec-header').forEach((btn) => {
  btn.addEventListener('click', () => {
    const body = byId(btn.getAttribute('aria-controls')!);
    const open = !body.classList.contains('open');
    body.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
  });
});

// Mobile tabs
const tabs = document.querySelectorAll<HTMLButtonElement>('.tb-step');
const MOBILE = window.matchMedia('(max-width: 1100px)');

function switchTab(targetId: string): void {
  tabs.forEach((t) => {
    const active = t.dataset.target === targetId;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });
  ['colDetails', 'colPreview', 'colExport'].forEach((id) => byId(id).classList.toggle('active-tab', id === targetId));
  if (MOBILE.matches) byId(targetId).scrollTop = 0;
}
tabs.forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.target!)));
document.querySelectorAll<HTMLElement>('[data-goto]').forEach((b) =>
  b.addEventListener('click', () => switchTab(b.dataset.goto!)),
);
document.querySelectorAll<HTMLElement>('[data-proxy]').forEach((b) =>
  b.addEventListener('click', () => byId(b.dataset.proxy!).click()),
);

// --- Field events -----------------------------------------------------------

document.addEventListener('input', (e) => {
  if ((e.target as HTMLElement).closest('#itemsContainer')) return;
  onFieldInput(e);
});

const catalog = initCatalog(store);
bindItems(store, { onSaveToCatalog: (item) => catalog.saveFrom(item) });

// Logo
const logoInput = byId<HTMLInputElement>('logoInput');
const logoDrop = byId('logoDrop');
logoInput.addEventListener('change', () => {
  const file = logoInput.files?.[0];
  if (file) void addLogo(file);
});
logoDrop.addEventListener('dragover', (e) => {
  if (logoInput.disabled) return;
  e.preventDefault();
  logoDrop.classList.add('is-dragover');
});
logoDrop.addEventListener('dragleave', () => logoDrop.classList.remove('is-dragover'));
logoDrop.addEventListener('drop', (e) => {
  e.preventDefault();
  logoDrop.classList.remove('is-dragover');
  const file = e.dataTransfer?.files[0];
  if (file && !logoInput.disabled) void addLogo(file);
});

async function addLogo(file: File): Promise<void> {
  try {
    const dataUrl = await processLogo(file);
    store.update((s) => (s.style.logo = dataUrl));
    showToast('Logo added');
  } catch (err) {
    showToast(err instanceof LogoError ? err.message : 'Could not load that image.', 'error');
  } finally {
    logoInput.value = '';
  }
}

/** Thumbnail and label of the logo upload control. */
function renderLogoField(logo: string): void {
  const thumb = byId('logoThumb');
  const img = thumb.querySelector('img');
  if (logo) {
    if (img) {
      if (img.src !== logo) img.src = logo;
    } else {
      thumb.replaceChildren(el('img', { attrs: { src: logo, alt: '' } }));
    }
  } else if (img) {
    thumb.replaceChildren(
      icon(['M5 6.5h0', 'M3.5 13l4-4 3.5 3.5 2-2 3.5 3.5'], 18, '0 0 20 20'),
    );
  }
  byId('logoTitle').textContent = logo ? 'Replace logo' : 'Upload logo';
  byId('logoSub').textContent = logo ? 'Click or drop a new file' : 'PNG, JPEG or WebP, up to 2 MB. Or drop it here.';
}
byId('removeLogoBtn').addEventListener('click', () => store.update((s) => (s.style.logo = '')));

// Theme
byId('colorGrid').addEventListener('click', (e) => {
  const sw = (e.target as HTMLElement).closest<HTMLElement>('.swatch');
  if (sw?.dataset.color) store.update((s) => (s.style.accent = sw.dataset.color!));
});
byId<HTMLInputElement>('customColor').addEventListener('input', (e) => {
  const v = (e.target as HTMLInputElement).value;
  if (/^#[0-9a-fA-F]{6}$/.test(v)) store.update((s) => (s.style.accent = v.toLowerCase()));
});

document.querySelectorAll<HTMLButtonElement>('.shape-btn').forEach((btn) =>
  btn.addEventListener('click', () => store.update((s) => (s.style.logoShape = btn.dataset.shape as LogoShape))),
);

document.querySelectorAll<HTMLButtonElement>('[data-discount-type]').forEach((btn) =>
  btn.addEventListener('click', () =>
    store.update((s) => {
      s.totals.discountType = btn.dataset.discountType as DiscountType;
      if (s.totals.discountType === 'percent') s.totals.discountValue = Math.min(100, s.totals.discountValue);
    }),
  ),
);

// Notes suggestion
byId('suggestNoteBtn').addEventListener('click', () => {
  const s = store.get();
  const toneValue = byId<HTMLSelectElement>('noteTone').value;
  const tone: NoteTone = (NOTE_TONES as readonly string[]).includes(toneValue) ? (toneValue as NoteTone) : 'friendly';
  const note = suggestNote(tone, {
    client: s.client.name.split(' ')[0] ?? '',
    business: s.business.name,
    dueDate: formatDate(s.meta.dueDate, s.meta.locale),
    total: formatMoney(computeTotals(s).balance, s.meta.currency, s.meta.locale),
    number: s.meta.number,
  });
  store.update((d) => (d.notes.notes = note));
});

// Client book
const clientPicker = byId<HTMLSelectElement>('clientPicker');
function renderClientPicker(): void {
  const clients = clientBook(invoices);
  byId('clientPickerWrap').hidden = clients.length === 0;
  clientPicker.replaceChildren(
    el('option', { text: 'Choose a previous client…', attrs: { value: '' } }),
    ...clients.map((c, i) =>
      el('option', { text: [c.name, c.company].filter(Boolean).join(' — '), attrs: { value: String(i) } }),
    ),
  );
}
clientPicker.addEventListener('change', () => {
  const c = clientBook(invoices)[Number(clientPicker.value)];
  if (c) store.update((s) => (s.client = { ...blankClient(), ...c }));
  clientPicker.value = '';
});

// --- Exports ----------------------------------------------------------------

document.querySelectorAll<HTMLElement>('[data-action="pdf"]').forEach((b) =>
  b.addEventListener('click', () => void exportPDF(store.get())),
);
document.querySelectorAll<HTMLElement>('[data-action="png"]').forEach((b) =>
  b.addEventListener('click', () => {
    switchTab('colPreview');
    void exportPNG(store.get());
  }),
);
document.querySelectorAll<HTMLElement>('[data-action="print"]').forEach((b) => b.addEventListener('click', exportPrint));

// --- Persistence ------------------------------------------------------------

const indicator = byId('saveIndicator');
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;
/** Set while resetting to the sample after a wipe, so it isn't re-saved. */
let suppressSave = false;

/** Optional cloud copy (null unless enabled for this browser in the dashboard). */
const cloudSync = initCloudSync(
  (status) => {
    indicator.classList.remove('error');
    if (status.kind === 'syncing') indicator.textContent = 'Saved · syncing…';
    else if (status.kind === 'synced') indicator.textContent = 'Saved · synced to cloud';
    else indicator.textContent = status.message;
  },
  ({ id, amountPaid, status }) => {
    if (store.get().id !== id) return;
    store.update((d) => {
      d.totals.amountPaid = amountPaid;
      d.meta.status = status;
    });
    showToast('Amount paid and status follow the payments recorded in the dashboard');
  },
);

function persist(): void {
  clearTimeout(saveTimer);
  if (!dirty) return;
  dirty = false;
  const current = { ...store.get(), updatedAt: Date.now() };
  invoices = [current, ...invoices.filter((i) => i.id !== current.id)];
  const ok = saveInvoices(invoices);
  saveCurrentId(current.id);
  if (current.business.name.trim()) {
    profile = profileFromInvoice(current);
    saveProfile(profile);
  }
  indicator.textContent = ok ? 'Saved' : 'Not saved: browser storage is full or disabled';
  indicator.classList.toggle('error', !ok);
  if (ok && !persistAsked) void requestPersistence();
  renderDataPanel();
  cloudSync?.queue(current);
}

function scheduleSave(): void {
  dirty = true;
  indicator.textContent = 'Saving…';
  indicator.classList.remove('error');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 400);
}

window.addEventListener('pagehide', persist);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persist();
});

/** Replace the editor contents with another invoice. */
function load(inv: InvoiceState): void {
  persist();
  rerenderItems(inv); // before store.set, so the render pass can apply the lock state
  store.set(inv);
  saveCurrentId(inv.id);
  renderClientPicker();
  scheduleSave();
}

// --- Issue & lock -------------------------------------------------------------

function issueCurrent(): void {
  const s = store.get();
  if (isLocked(s)) return;
  const title = DOC_TITLES[s.docType].toLowerCase();
  let number = s.meta.number.trim();
  if (!number) number = nextNumber(s.docType, invoices, s.id, prefixes);
  const dup = findDuplicate({ ...s, meta: { ...s.meta, number } }, invoices);
  if (dup) {
    showToast(`Number ${number} is already used by another ${title}. Change it before issuing.`, 'error');
    byId('f-number').focus();
    return;
  }
  if (!confirm(`Issue ${title} #${number}? It will be locked so the issued version can't change by accident.`)) return;
  store.update((d) => {
    d.meta.number = number;
    d.meta.issuedAt = Date.now();
    if (d.meta.status === 'Draft') d.meta.status = ISSUED_STATUS[d.docType];
  });
  persist();
  showToast(`${DOC_TITLES[s.docType]} #${number} issued`);
}

byId('issueBtn').addEventListener('click', issueCurrent);
byId('unlockBtn').addEventListener('click', () => {
  if (
    !confirm(
      'Unlock this document for editing? Changing an invoice you already sent can cause problems with your client or accountant. A credit note is usually the right way to correct it.',
    )
  ) {
    return;
  }
  store.update((d) => (d.meta.issuedAt = null));
});
byId('creditFromLockBtn').addEventListener('click', () => {
  const s = store.get();
  persist();
  load(creditNoteFor(s, invoices));
  showToast(`Credit note started for #${s.meta.number}`);
});

// --- Invoice management -----------------------------------------------------

byId('newBtn').addEventListener('click', () => {
  persist();
  const type = store.get().docType === 'receipt' ? 'invoice' : store.get().docType;
  load(freshInvoice(type));
  switchTab('colDetails');
  showToast(`New ${DOC_TITLES[type].toLowerCase()} started`);
});

byId('clearBtn').addEventListener('click', () => {
  const s = store.get();
  if (isLocked(s)) {
    showToast('This document is issued and locked. Unlock it or create a credit note.', 'error');
    return;
  }
  if (!confirm('Clear this document? Your business details and style are kept.')) return;
  const blank = createInvoice({ id: s.id, docType: s.docType, business: s.business, style: s.style, payment: s.payment });
  blank.meta = { ...blank.meta, number: s.meta.number, currency: s.meta.currency, locale: s.meta.locale };
  blank.notes = {
    ...blank.notes,
    paymentTerms: s.notes.paymentTerms,
    bankDetails: s.notes.bankDetails,
    footer: s.notes.footer,
    legalMentions: [...s.notes.legalMentions],
    notes: '',
  };
  blank.totals = { ...blank.totals, taxLabel: s.totals.taxLabel, taxRate: s.totals.taxRate };
  blank.items = [blankItem()];
  load(blank);
  showToast('Invoice cleared');
});

const dialog = byId<HTMLDialogElement>('invoicesDialog');

const invoiceSearch = byId<HTMLInputElement>('invoiceSearch');

type DrawerFilter = 'all' | 'unpaid' | 'overdue' | 'paid' | 'quotes';
let drawerFilter: DrawerFilter = 'all';

function matchesFilter(inv: InvoiceState, f: DrawerFilter): boolean {
  const st = effectiveStatus(inv);
  if (f === 'all') return true;
  if (f === 'quotes') return inv.docType === 'quote';
  if (inv.docType !== 'invoice') return false;
  if (f === 'unpaid') return st === 'Unpaid' || st === 'Overdue';
  if (f === 'overdue') return st === 'Overdue';
  return st === 'Paid';
}

/** Outstanding balance per currency across unpaid and overdue invoices. */
function outstandingSummary(): string {
  const byCurrency = new Map<string, { minor: number; locale: string; count: number; overdue: number }>();
  for (const inv of invoices) {
    if (inv.docType !== 'invoice') continue;
    const st = effectiveStatus(inv);
    if (st !== 'Unpaid' && st !== 'Overdue') continue;
    const bal = computeTotals(inv).balance;
    const e = byCurrency.get(inv.meta.currency) ?? { minor: 0, locale: inv.meta.locale, count: 0, overdue: 0 };
    e.minor += bal;
    e.count += 1;
    if (st === 'Overdue') e.overdue += 1;
    byCurrency.set(inv.meta.currency, e);
  }
  if (byCurrency.size === 0) return 'Nothing outstanding.';
  const amounts = [...byCurrency.entries()].map(([cur, e]) => formatMoney(e.minor, cur, e.locale));
  const count = [...byCurrency.values()].reduce((n, e) => n + e.count, 0);
  const overdue = [...byCurrency.values()].reduce((n, e) => n + e.overdue, 0);
  return `Outstanding ${amounts.join(' and ')} on ${count} invoice${count === 1 ? '' : 's'}${overdue ? `, ${overdue} overdue` : ''}.`;
}

function renderInvoiceList(): void {
  persist();
  const q = invoiceSearch.value.trim().toLowerCase();
  const sorted = [...invoices]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((inv) => matchesFilter(inv, drawerFilter))
    .filter(
      (inv) =>
        !q ||
        [inv.meta.number, inv.client.name, inv.client.company].some((v) => v.toLowerCase().includes(q)),
    );
  byId('drawerSummary').textContent = outstandingSummary();
  document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.filter === drawerFilter)),
  );
  const currentId = store.get().id;
  const list = byId('invoiceList');
  if (sorted.length === 0) {
    const text = q || drawerFilter !== 'all'
      ? 'No documents match.'
      : 'No saved documents yet. They appear here as you work.';
    list.replaceChildren(el('li', { class: 'dlg-empty', text }));
    return;
  }
  const btn = (act: string, label: string, cls = 'mini-btn') =>
    el('button', { class: cls, text: label, attrs: { type: 'button', 'data-act': act } });
  list.replaceChildren(
    ...sorted.map((inv) => {
      const t = computeTotals(inv);
      const who = inv.client.company || inv.client.name || 'No client';
      const st = effectiveStatus(inv);
      const owed = inv.docType === 'invoice' && (st === 'Unpaid' || st === 'Overdue');
      const actions = el('div', { class: 'dlg-actions' }, [
        btn('open', 'Open'),
        inv.docType === 'quote' && st !== 'Declined' ? btn('convert', 'Convert to invoice') : null,
        owed ? btn('remind', 'Remind') : null,
        owed ? btn('paid', 'Mark paid') : null,
        inv.docType === 'invoice' && inv.meta.issuedAt !== null ? btn('credit', 'Credit note') : null,
        btn('repeat', 'Repeat next month'),
        btn('dup', 'Duplicate'),
        btn('del', 'Delete', 'mini-btn danger'),
      ]);
      return el('li', { class: `dlg-item${inv.id === currentId ? ' current' : ''}`, attrs: { 'data-id': inv.id } }, [
        el('div', { class: 'dlg-main' }, [
          el('span', { class: 'dlg-num' }, [
            `#${inv.meta.number}`,
            el('span', { class: 'dlg-type', text: DOC_TITLES[inv.docType] }),
            inv.meta.issuedAt !== null ? el('span', { class: 'dlg-lock', text: 'Issued' }) : null,
          ]),
          el('span', { class: 'dlg-who', text: who }),
          el('span', { class: 'dlg-date', text: formatDate(inv.meta.issueDate, inv.meta.locale) }),
        ]),
        el('div', { class: 'dlg-side' }, [
          el('span', { class: 'dlg-total', text: formatMoney(owed ? t.balance : t.total, inv.meta.currency, inv.meta.locale) }),
          el('span', { class: `inv-status ${st.toLowerCase()}`, text: st }),
        ]),
        actions,
      ]);
    }),
  );
}

/** Open the user's mail app with a drafted reminder, or copy it if there is no email. */
async function sendReminder(inv: InvoiceState): Promise<void> {
  const t = computeTotals(inv);
  const body = suggestNote('reminder', {
    client: inv.client.name.split(' ')[0] ?? '',
    business: inv.business.name,
    dueDate: formatDate(inv.meta.dueDate, inv.meta.locale),
    total: formatMoney(t.balance, inv.meta.currency, inv.meta.locale),
    number: inv.meta.number,
  });
  const signed = `${body}\n\n${inv.business.name}`.trim();
  const subject = `Payment reminder: invoice #${inv.meta.number}`;
  const email = inv.client.email.trim();
  if (email && /^[^\s@]+@[^\s@]+$/.test(email)) {
    const href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(signed)}`;
    const a = el('a', { attrs: { href } });
    a.click();
    showToast('Reminder opened in your mail app');
    return;
  }
  try {
    await navigator.clipboard.writeText(`${subject}\n\n${signed}`);
    showToast('No client email saved, so the reminder was copied instead');
  } catch {
    showToast('Add the client’s email to send a reminder', 'error');
  }
}

function openInvoices(): void {
  invoiceSearch.value = '';
  renderInvoiceList();
  dialog.showModal();
  invoiceSearch.focus();
}
byId('invoicesBtn').addEventListener('click', openInvoices);
invoiceSearch.addEventListener('input', renderInvoiceList);
byId('closeInvoicesBtn').addEventListener('click', () => dialog.close());
byId('drawerFilters').addEventListener('click', (e) => {
  const f = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-filter]')?.dataset.filter;
  if (!f) return;
  drawerFilter = f as DrawerFilter;
  renderInvoiceList();
});

/** Edit a saved document that isn't the one open in the editor. */
function updateDoc(id: string, mutate: (d: InvoiceState) => void): void {
  if (id === store.get().id) {
    store.update(mutate);
    persist();
    return;
  }
  invoices = invoices.map((d) => {
    if (d.id !== id) return d;
    const copy = structuredClone(d);
    mutate(copy);
    copy.updatedAt = Date.now();
    return copy;
  });
  saveInvoices(invoices);
}
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close(); // backdrop click
});
byId('dlgNewBtn').addEventListener('click', () => {
  dialog.close();
  byId('newBtn').click();
});

byId('invoiceList').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
  const id = btn?.closest<HTMLElement>('.dlg-item')?.dataset.id;
  const inv = invoices.find((i) => i.id === id);
  if (!btn || !inv) return;
  const act = btn.dataset.act;
  const startFrom = (doc: InvoiceState, message: string) => {
    load(doc);
    dialog.close();
    showToast(message);
  };
  if (act === 'open') {
    load(inv);
    dialog.close();
  } else if (act === 'dup') {
    const copy = duplicateDoc(inv, invoices);
    startFrom(copy, `Duplicated as #${copy.meta.number}`);
  } else if (act === 'repeat') {
    const copy = repeatNextPeriod(inv, invoices);
    startFrom(copy, `#${copy.meta.number} created for next month`);
  } else if (act === 'convert') {
    const created = invoiceFromQuote(inv, invoices);
    updateDoc(inv.id, (d) => (d.meta.status = 'Accepted'));
    startFrom(created, `Quote #${inv.meta.number} converted to invoice #${created.meta.number}`);
  } else if (act === 'credit') {
    const cn = creditNoteFor(inv, invoices);
    startFrom(cn, `Credit note #${cn.meta.number} started`);
  } else if (act === 'remind') {
    void sendReminder(inv);
  } else if (act === 'paid') {
    updateDoc(inv.id, (d) => (d.meta.status = 'Paid'));
    renderInvoiceList();
    showToast(`#${inv.meta.number} marked as paid`);
  } else if (act === 'del') {
    const issued = inv.meta.issuedAt !== null;
    const warning = issued
      ? `#${inv.meta.number} was issued. Deleting issued documents leaves a gap in your numbering; a credit note is usually better. Delete anyway?`
      : `Delete #${inv.meta.number}? This cannot be undone.`;
    if (!confirm(warning)) return;
    invoices = invoices.filter((i) => i.id !== inv.id);
    saveInvoices(invoices);
    if (inv.id === store.get().id) {
      dirty = false;
      const next = [...invoices].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? freshInvoice();
      rerenderItems(next);
      store.set(next);
      saveCurrentId(next.id);
    }
    renderInvoiceList();
    renderClientPicker();
  }
});

// --- Backup / import / wipe -------------------------------------------------

byId('backupBtn').addEventListener('click', () => {
  persist();
  downloadBackup(invoices, profile, catalog.all());
  saveLastBackup(Date.now());
  renderDataPanel();
  showToast('Backup downloaded');
});
byId('nudgeBackupBtn').addEventListener('click', () => byId('backupBtn').click());

byId('csvBtn').addEventListener('click', () => {
  persist();
  if (invoices.length === 0) {
    showToast('Nothing to export yet', 'error');
    return;
  }
  // BOM so Excel opens accented text as UTF-8.
  const blob = new Blob(['\ufeff', documentsToCsv(invoices)], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, safeFileName(`sasu-invoices-${new Date().toISOString().slice(0, 10)}`, 'csv'));
  showToast('CSV downloaded');
});

const BACKUP_NUDGE_DAYS = 14;

/** Last-backup line, backup reminder and storage-persistence note. */
function renderDataPanel(): void {
  const last = loadLastBackup();
  byId('lastBackup').textContent = last
    ? `Last backup ${new Date(last).toLocaleDateString(undefined, { dateStyle: 'medium' })}.`
    : 'Not backed up yet.';
  const stale = !last || Date.now() - last > BACKUP_NUDGE_DAYS * 86_400_000;
  byId('backupNudge').hidden = !(invoices.length > 0 && stale);
  byId('backupNudgeText').textContent = last
    ? `Your last backup is more than ${BACKUP_NUDGE_DAYS} days old.`
    : 'You haven’t backed up your invoices yet.';
}

/**
 * Ask the browser not to evict our storage, and explain the outcome. Only
 * asks (which may show a prompt in Firefox) after the user has saved work.
 */
let persistAsked = false;
async function requestPersistence(ask = true): Promise<void> {
  const note = byId('storageNote');
  const fallback =
    'Some browsers (notably Safari) delete site data after 7 days without a visit. Install the app or keep a backup.';
  if (!navigator.storage?.persist) {
    note.textContent = fallback;
    return;
  }
  try {
    let persisted = await navigator.storage.persisted();
    if (!persisted && ask && !persistAsked) {
      persistAsked = true;
      persisted = await navigator.storage.persist();
    }
    note.textContent = persisted ? 'This browser has agreed not to clear your data automatically.' : fallback;
  } catch {
    note.textContent = fallback;
  }
}

const importInput = byId<HTMLInputElement>('importInput');
byId('importBtn').addEventListener('click', () => importInput.click());
importInput.addEventListener('change', async () => {
  const file = importInput.files?.[0];
  importInput.value = '';
  if (!file) return;
  try {
    const backup = await readBackup(file);
    const n = backup.invoices.length;
    if (!confirm(`Import ${n} invoice${n === 1 ? '' : 's'}? Invoices with the same ID will be replaced.`)) return;
    persist();
    // Logos from a file are untrusted: run them through the upload checks again.
    let dropped = 0;
    for (const inv of backup.invoices) {
      if (!inv.style.logo) continue;
      const safe = await recheckLogo(inv.style.logo);
      if (!safe) dropped++;
      inv.style.logo = safe;
    }
    if (backup.profile?.logo) backup.profile.logo = await recheckLogo(backup.profile.logo);
    if (backup.catalog.length) catalog.merge(backup.catalog);
    const ids = new Set(backup.invoices.map((i) => i.id));
    invoices = [...backup.invoices, ...invoices.filter((i) => !ids.has(i.id))];
    if (backup.profile) {
      profile = backup.profile;
      saveProfile(profile);
    }
    if (!saveInvoices(invoices)) showToast('Imported, but browser storage is full; some data may not persist.', 'error');
    const first = backup.invoices[0];
    if (first) load(first);
    showToast(
      `Imported ${n} document${n === 1 ? '' : 's'}${dropped ? `; ${dropped} logo${dropped === 1 ? '' : 's'} failed verification and ${dropped === 1 ? 'was' : 'were'} removed` : ''}`,
      dropped ? 'error' : 'ok',
    );
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Import failed.', 'error');
  }
});

byId('wipeBtn').addEventListener('click', () => {
  if (!confirm('Delete ALL invoices, clients and your business profile from this browser? This cannot be undone. Download a backup first if you need one.')) return;
  clearTimeout(saveTimer);
  dirty = false;
  clearAllData();
  invoices = [];
  profile = null;
  catalog.clear();
  const inv = sampleInvoice();
  rerenderItems(inv);
  suppressSave = true;
  store.set(inv);
  suppressSave = false;
  renderClientPicker();
  indicator.textContent = '';
  showToast('All local data deleted');
});

// --- Preview scaling ----------------------------------------------------------
// CSS can't divide a length by a length, so fit the A4 sheet to the column here.

const sheet = byId('invoicePage');
const scroller = sheet.closest<HTMLElement>('.preview-scroll')!;
let zoom: 'fit' | 'actual' = 'fit';
function fitSheet(): void {
  const avail = scroller.clientWidth - (window.innerWidth <= 700 ? 24 : 80);
  const scale = zoom === 'actual' ? 1 : Math.min(1, Math.max(0.2, avail / sheet.offsetWidth));
  const root = document.documentElement.style;
  root.setProperty('--sheet-scale', String(scale));
  root.setProperty('--sheet-gap', `${sheet.offsetHeight * (scale - 1)}px`);
}
new ResizeObserver(fitSheet).observe(scroller);
new ResizeObserver(fitSheet).observe(sheet);

document.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach((btn) =>
  btn.addEventListener('click', () => {
    zoom = btn.dataset.zoom === 'actual' ? 'actual' : 'fit';
    document
      .querySelectorAll<HTMLButtonElement>('[data-zoom]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    byId('colPreview').classList.toggle('zoom-actual', zoom === 'actual');
    fitSheet();
  }),
);

// --- Keyboard shortcuts -------------------------------------------------------

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  const key = e.key.toLowerCase();
  if (key === 's' && !e.shiftKey) {
    e.preventDefault();
    dirty = true;
    persist();
    showToast('Saved in this browser');
  } else if (key === 'k' && !e.shiftKey) {
    e.preventDefault();
    if (dialog.open) dialog.close();
    else openInvoices();
  } else if (key === 'e' && e.shiftKey) {
    e.preventDefault();
    void exportPDF(store.get());
  }
});

// --- Render loop ------------------------------------------------------------

/** Topbar title, status pill and the one-line summaries on each form section. */
function renderChrome(s: InvoiceState, totals: ReturnType<typeof computeTotals>): void {
  const status = effectiveStatus(s);
  byId('docNumber').textContent = `#${s.meta.number || '—'}`;
  byId('docClient').textContent = s.client.company || s.client.name;
  const pill = byId('docStatus');
  pill.textContent = status;
  pill.className = `pill ${status.toLowerCase()}`;

  const money = formatMoney(totals.total, s.meta.currency, s.meta.locale);
  const n = s.items.length;
  const summaries: Record<string, string> = {
    biz: s.business.name,
    inv: [s.meta.currency, s.meta.dueDate ? `due ${formatDate(s.meta.dueDate, s.meta.locale)}` : ''].filter(Boolean).join(', '),
    client: s.client.company || s.client.name || 'Not set',
    items: `${n} ${n === 1 ? 'item' : 'items'}, ${money}`,
    notes: s.notes.bankDetails ? 'Includes bank details' : '',
  };
  document.querySelectorAll<HTMLElement>('[data-summary]').forEach((node) => {
    node.textContent = summaries[node.dataset.summary ?? ''] ?? '';
  });
}

/** Per-document-type fields, payment panel, legal wording and the issue/lock state. */
function renderDocState(s: InvoiceState, totals: ReturnType<typeof computeTotals>): void {
  // Status options valid for this document type
  const statusSel = byId<HTMLSelectElement>('f-status');
  const allowed = STATUSES_BY_TYPE[s.docType];
  if (statusSel.dataset.type !== s.docType) {
    fillSelect(statusSel, allowed.map((v) => ({ value: v, label: v })));
    statusSel.dataset.type = s.docType;
    statusSel.value = s.meta.status;
  }

  document.querySelectorAll<HTMLElement>('[data-show]').forEach((node) => {
    node.hidden = !node.dataset.show!.split(' ').includes(s.docType);
  });
  byId('supplyDateWrap').hidden = s.meta.supplySameAsIssue;

  // Payment panel
  document.querySelectorAll<HTMLElement>('[data-pay]').forEach((node) => {
    node.hidden = !node.dataset.pay!.split(' ').includes(s.payment.method);
  });
  const qr = paymentQr(s, totals);
  const payStatus = byId('payStatus');
  payStatus.classList.toggle('error', Boolean(qr && 'error' in qr));
  payStatus.textContent =
    s.payment.method === 'none'
      ? 'Add a QR code your client can scan to pay.'
      : qr === null
        ? s.docType === 'invoice' || s.docType === 'proforma'
          ? 'Nothing left to pay, so no code is shown.'
          : 'Payment codes appear on invoices and proformas only.'
        : 'error' in qr
          ? qr.error
          : 'The code is on the invoice preview and in the PDF.';

  // Legal wording
  document.querySelectorAll<HTMLInputElement>('[data-legal]').forEach((box) => {
    box.checked = s.notes.legalMentions.includes(box.dataset.legal!);
  });
  const warnings = legalWarnings(s);
  const warnBox = byId('legalWarnings');
  warnBox.hidden = warnings.length === 0;
  warnBox.replaceChildren(...warnings.map((w) => el('p', { text: w })));

  // Issue / lock
  const locked = isLocked(s);
  const issueBtn = byId<HTMLButtonElement>('issueBtn');
  issueBtn.hidden = locked;
  issueBtn.textContent = `Issue ${DOC_TITLES[s.docType].toLowerCase()}`;
  byId('lockBanner').hidden = !locked;
  if (locked) {
    const when = new Date(s.meta.issuedAt!).toLocaleDateString(s.meta.locale, { dateStyle: 'medium' });
    byId('lockText').textContent = `${DOC_TITLES[s.docType]} issued on ${when} and locked. To correct it, create a credit note.`;
    byId('creditFromLockBtn').hidden = s.docType !== 'invoice';
  }
  byId('colDetails').classList.toggle('is-locked', locked);
  document
    .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
      '#invoiceForm input, #invoiceForm select, #invoiceForm textarea, #invoiceForm button:not(.sec-header), .inspector .field-grid input, .inspector .combo button, #clearBtn',
    )
    .forEach((node) => {
      if ('lockExempt' in node.dataset) return;
      node.disabled = locked;
    });
}

function renderAll(s: InvoiceState): void {
  const totals = computeTotals(s);
  applyAccent(s.style.accent);
  renderPreview(s, totals);
  renderSummary(s, totals);
  refreshItemTotals(s, totals);
  syncForm(s);

  document.querySelectorAll<HTMLElement>('.swatch').forEach((sw) => {
    const on = sw.dataset.color === s.style.accent;
    sw.classList.toggle('active', on);
    sw.setAttribute('aria-pressed', String(on));
  });
  byId<HTMLInputElement>('customColor').value = s.style.accent;
  document.querySelectorAll<HTMLElement>('.shape-btn').forEach((b) => {
    const on = b.dataset.shape === s.style.logoShape;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll<HTMLElement>('[data-discount-type]').forEach((b) => {
    const on = b.dataset.discountType === s.totals.discountType;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const symbol =
    new Intl.NumberFormat(s.meta.locale, { style: 'currency', currency: s.meta.currency })
      .formatToParts(0)
      .find((p) => p.type === 'currency')?.value ?? s.meta.currency;
  byId('discFixedBtn').textContent = symbol;
  byId<HTMLInputElement>('f-discount').max = s.totals.discountType === 'percent' ? '100' : '';
  byId('removeLogoBtn').hidden = !s.style.logo;
  renderLogoField(s.style.logo);
  renderChrome(s, totals);
  renderDocState(s, totals);
  document.title = `${s.meta.number ? `${s.meta.number} · ` : ''}SASU Invoice`;
}

store.subscribe((s) => {
  renderAll(s);
  if (!suppressSave) scheduleSave();
});

rerenderItems(store.get());
renderAll(store.get());
renderClientPicker();
renderDataPanel();
void requestPersistence(invoices.length > 0);

byId('dashboardLink').hidden = !cloudConfig;
void cloudSync?.openFromUrl().then((doc) => {
  if (!doc) return;
  invoices = [doc, ...invoices.filter((i) => i.id !== doc.id)];
  saveInvoices(invoices);
  load(doc);
  showToast(`Opened #${doc.meta.number} from the cloud`);
});
void cloudSync?.clientFromUrl().then((client) => {
  if (!client) return;
  const inv = freshInvoice();
  inv.client = client;
  load(inv);
  showToast(`New invoice for ${client.company || client.name}`);
});
initPwa();
if (MOBILE.matches) switchTab('colDetails');
