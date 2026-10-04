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
  blankClient,
  blankItem,
  createInvoice,
  createStore,
  nextInvoiceNumber,
  sampleInvoice,
  type DiscountType,
  type InvoiceState,
  type LogoShape,
} from './core/state';
import {
  applyProfile,
  clearAllData,
  clientBook,
  loadCurrentId,
  loadInvoices,
  loadProfile,
  profileFromInvoice,
  saveCurrentId,
  saveInvoices,
  saveProfile,
} from './core/storage';
import { NOTE_TONES, suggestNote, type NoteTone } from './core/suggestions';
import type { Profile } from './core/validate';
import { byId, el } from './ui/dom';
import { downloadBackup, exportPDF, exportPNG, exportPrint, readBackup } from './ui/exports';
import { bindItems, refreshItemTotals, rerenderItems } from './ui/items';
import { LogoError, processLogo } from './ui/logo';
import { applyAccent, renderPreview, renderSummary } from './ui/render';
import { showToast } from './ui/toast';

// --- Boot -----------------------------------------------------------------

let invoices = loadInvoices();
let profile: Profile | null = loadProfile();

function freshInvoice(): InvoiceState {
  const inv = createInvoice();
  const latest = [...invoices].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (latest) inv.meta.number = nextInvoiceNumber(latest.meta.number);
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
  if (!('num' in input.dataset)) return input.value;
  const n = Number(input.value);
  if (input.value.trim() === '' || !Number.isFinite(n)) return 0;
  return Math.min(numberLimit(path, s), Math.max(0, n));
}

function onFieldInput(e: Event): void {
  const input = e.target as Bindable;
  const path = input.dataset?.bind;
  if (!path) return;
  store.update((s) => {
    setPath(s, path, readField(input, path, s));
    if (path === 'meta.issueDate' || path === 'meta.dueTerm') {
      const due = dueDateFor(s.meta.issueDate, s.meta.dueTerm);
      if (due) s.meta.dueDate = due;
    }
    if (path === 'meta.dueDate') s.meta.dueTerm = 'custom';
  });
}

function syncForm(s: InvoiceState): void {
  document.querySelectorAll<Bindable>('[data-bind]').forEach((input) => {
    if (input === document.activeElement) return;
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
const MOBILE = window.matchMedia('(max-width: 1200px)');

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

bindItems(store);

// Logo
const logoInput = byId<HTMLInputElement>('logoInput');
logoInput.addEventListener('change', async () => {
  const file = logoInput.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await processLogo(file);
    store.update((s) => (s.style.logo = dataUrl));
    showToast('Logo added');
  } catch (err) {
    showToast(err instanceof LogoError ? err.message : 'Could not load that image.', 'error');
  } finally {
    logoInput.value = '';
  }
});
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
  store.set(inv);
  rerenderItems(inv);
  saveCurrentId(inv.id);
  renderClientPicker();
  scheduleSave();
}

// --- Invoice management -----------------------------------------------------

byId('newBtn').addEventListener('click', () => {
  persist();
  load(freshInvoice());
  switchTab('colDetails');
  showToast('New invoice started');
});

byId('clearBtn').addEventListener('click', () => {
  if (!confirm('Clear this invoice? Your business details and style are kept.')) return;
  const s = store.get();
  const blank = createInvoice({ id: s.id, business: s.business, style: s.style });
  blank.meta = { ...blank.meta, number: s.meta.number, currency: s.meta.currency, locale: s.meta.locale };
  blank.notes = { ...blank.notes, paymentTerms: s.notes.paymentTerms, bankDetails: s.notes.bankDetails, footer: s.notes.footer, notes: '' };
  blank.totals = { ...blank.totals, taxLabel: s.totals.taxLabel, taxRate: s.totals.taxRate };
  blank.items = [blankItem()];
  load(blank);
  showToast('Invoice cleared');
});

const dialog = byId<HTMLDialogElement>('invoicesDialog');

function renderInvoiceList(): void {
  persist();
  const sorted = [...invoices].sort((a, b) => b.updatedAt - a.updatedAt);
  const currentId = store.get().id;
  const list = byId('invoiceList');
  if (sorted.length === 0) {
    list.replaceChildren(el('li', { class: 'dlg-empty', text: 'No saved invoices yet.' }));
    return;
  }
  list.replaceChildren(
    ...sorted.map((inv) => {
      const t = computeTotals(inv);
      const who = inv.client.company || inv.client.name || 'No client';
      const actions = el('div', { class: 'dlg-actions' }, [
        el('button', { class: 'mini-btn', text: 'Open', attrs: { type: 'button', 'data-act': 'open' } }),
        el('button', { class: 'mini-btn', text: 'Duplicate', attrs: { type: 'button', 'data-act': 'dup' } }),
        el('button', { class: 'mini-btn danger', text: 'Delete', attrs: { type: 'button', 'data-act': 'del' } }),
      ]);
      return el('li', { class: `dlg-item${inv.id === currentId ? ' current' : ''}`, attrs: { 'data-id': inv.id } }, [
        el('div', { class: 'dlg-main' }, [
          el('span', { class: 'dlg-num', text: `#${inv.meta.number}` }),
          el('span', { class: 'dlg-who', text: who }),
          el('span', { class: 'dlg-date', text: formatDate(inv.meta.issueDate, inv.meta.locale) }),
        ]),
        el('div', { class: 'dlg-side' }, [
          el('span', { class: 'dlg-total', text: formatMoney(t.total, inv.meta.currency, inv.meta.locale) }),
          el('span', { class: `inv-status ${inv.meta.status.toLowerCase()}`, text: inv.meta.status }),
        ]),
        actions,
      ]);
    }),
  );
}

byId('invoicesBtn').addEventListener('click', () => {
  renderInvoiceList();
  dialog.showModal();
});
byId('closeInvoicesBtn').addEventListener('click', () => dialog.close());
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
  if (act === 'open') {
    load(inv);
    dialog.close();
  } else if (act === 'dup') {
    const copy: InvoiceState = {
      ...structuredClone(inv),
      id: crypto.randomUUID(),
      meta: { ...inv.meta, number: freshInvoice().meta.number, status: 'Draft' },
      items: inv.items.map((it) => ({ ...it, id: crypto.randomUUID() })),
    };
    load(copy);
    dialog.close();
    showToast(`Duplicated as #${copy.meta.number}`);
  } else if (act === 'del') {
    if (!confirm(`Delete invoice #${inv.meta.number}? This cannot be undone.`)) return;
    invoices = invoices.filter((i) => i.id !== inv.id);
    saveInvoices(invoices);
    if (inv.id === store.get().id) {
      dirty = false;
      const next = [...invoices].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? freshInvoice();
      store.set(next);
      rerenderItems(next);
      saveCurrentId(next.id);
    }
    renderInvoiceList();
    renderClientPicker();
  }
});

// --- Backup / import / wipe -------------------------------------------------

byId('backupBtn').addEventListener('click', () => {
  persist();
  downloadBackup(invoices, profile);
  showToast('Backup downloaded');
});

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
    const ids = new Set(backup.invoices.map((i) => i.id));
    invoices = [...backup.invoices, ...invoices.filter((i) => !ids.has(i.id))];
    if (backup.profile) {
      profile = backup.profile;
      saveProfile(profile);
    }
    if (!saveInvoices(invoices)) showToast('Imported, but browser storage is full; some data may not persist.', 'error');
    const first = backup.invoices[0];
    if (first) load(first);
    showToast(`Imported ${n} invoice${n === 1 ? '' : 's'}`);
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
  const inv = sampleInvoice();
  suppressSave = true;
  store.set(inv);
  suppressSave = false;
  rerenderItems(inv);
  renderClientPicker();
  indicator.textContent = '';
  showToast('All local data deleted');
});

// --- Preview scaling ----------------------------------------------------------
// CSS can't divide a length by a length, so fit the A4 sheet to the column here.

const sheet = byId('invoicePage');
const scroller = sheet.parentElement!;
function fitSheet(): void {
  const avail = scroller.clientWidth - (window.innerWidth <= 700 ? 24 : 80);
  const scale = Math.min(1, Math.max(0.2, avail / sheet.offsetWidth));
  const root = document.documentElement.style;
  root.setProperty('--sheet-scale', String(scale));
  root.setProperty('--sheet-gap', `${sheet.offsetHeight * (scale - 1)}px`);
}
new ResizeObserver(fitSheet).observe(scroller);
new ResizeObserver(fitSheet).observe(sheet);

// --- Render loop ------------------------------------------------------------

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
  document.title = `${s.meta.number ? `#${s.meta.number} · ` : ''}Invoice Editor | SASU Invoice`;
}

store.subscribe((s) => {
  renderAll(s);
  if (!suppressSave) scheduleSave();
});

rerenderItems(store.get());
renderAll(store.get());
renderClientPicker();
if (MOBILE.matches) switchTab('colDetails');
