/**
 * Line-item editor. The list is rebuilt only on structural changes (add,
 * remove, reorder, load), so typing never loses focus; per-keystroke updates
 * just refresh the amount cells.
 */
import { computeTotals, type Totals } from '../core/calc';
import { formatMoney } from '../core/money';
import { blankItem, type InvoiceState, type LineItem, type Store } from '../core/state';
import { suggestDescription } from '../core/suggestions';
import { MAX_ITEMS } from '../core/validate';
import { byId, el, icon } from './dom';
import { showToast } from './toast';

type NumField = 'qty' | 'rate' | 'taxRate';
type TextField = 'desc' | 'unit';

const LIMITS: Record<NumField, number> = { qty: 1e9, rate: 1e12, taxRate: 100 };

const ICONS = {
  up: ['M8 13V3M4 7l4-4 4 4'],
  down: ['M8 3v10M4 9l4 4 4-4'],
  dup: ['M5 5h8v8H5z', 'M3 11V3h8'],
  del: ['M3 3l10 10M13 3L3 13'],
  wand: ['M8 1v4M8 11v4M1 8h4M11 8h4M3 3l2.5 2.5M10.5 10.5L13 13M3 13l2.5-2.5M10.5 5.5L13 3'],
};

export function parseNum(raw: string, field: NumField): number | null {
  if (raw.trim() === '') return field === 'taxRate' ? null : 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return field === 'taxRate' ? null : 0;
  return Math.min(LIMITS[field], Math.max(0, n));
}

function numberInput(item: LineItem, field: NumField, label: string, placeholder = ''): HTMLElement {
  const value = item[field];
  const input = el('input', {
    class: `ir-${field}`,
    attrs: {
      type: 'number',
      min: '0',
      step: 'any',
      inputmode: 'decimal',
      'data-field': field,
      placeholder,
      ...(field === 'taxRate' ? { max: '100' } : {}),
    },
  });
  input.value = value === null ? '' : String(value);
  return el('label', { class: 'ic-f' }, [el('span', { text: label }), input]);
}

function itemRow(item: LineItem, index: number, count: number): HTMLLIElement {
  const n = index + 1;
  const desc = el('input', {
    class: 'ir-desc',
    attrs: {
      type: 'text',
      maxlength: '4000',
      placeholder: 'Item description',
      'aria-label': `Item ${n} description`,
      'data-field': 'desc',
    },
  });
  desc.value = item.desc;

  const unit = el('input', {
    class: 'ir-unit',
    attrs: { type: 'text', maxlength: '20', placeholder: 'hrs', 'data-field': 'unit' },
  });
  unit.value = item.unit;

  const btn = (action: string, label: string, paths: string[], disabled = false) => {
    const b = el('button', {
      class: `ic-btn ic-${action}`,
      attrs: { type: 'button', 'data-action': action, 'aria-label': `${label} item ${n}`, title: label },
    });
    b.append(icon(paths, 13));
    b.disabled = disabled;
    return b;
  };

  const suggest = el('button', {
    class: 'suggest-chip',
    attrs: {
      type: 'button',
      'data-action': 'suggest',
      title: 'Suggest professional wording (click again for another)',
      'aria-label': `Suggest wording for item ${n}`,
    },
  });
  suggest.append(icon(ICONS.wand, 11), 'Suggest');

  return el('li', { class: 'item-card', attrs: { 'data-id': item.id } }, [
    el('div', { class: 'ic-top' }, [
      el('span', { class: 'ic-idx', text: String(n), attrs: { 'aria-hidden': 'true' } }),
      el('div', { class: 'ir-desc-wrap' }, [desc, suggest]),
    ]),
    el('div', { class: 'ic-grid' }, [
      numberInput(item, 'qty', 'Qty'),
      el('label', { class: 'ic-f' }, [el('span', { text: 'Unit' }), unit]),
      numberInput(item, 'rate', 'Rate'),
      numberInput(item, 'taxRate', 'Tax %', '—'),
      el('div', { class: 'ic-f ic-amount' }, [
        el('span', { text: 'Amount' }),
        el('output', { class: 'ir-total', attrs: { 'aria-label': `Item ${n} amount` } }),
      ]),
    ]),
    el('div', { class: 'ic-actions' }, [
      btn('up', 'Move up', ICONS.up, index === 0),
      btn('down', 'Move down', ICONS.down, index === count - 1),
      btn('dup', 'Duplicate', ICONS.dup),
      btn('del', 'Delete', ICONS.del),
    ]),
  ]);
}

export function renderItems(state: InvoiceState): void {
  const list = byId('itemsContainer');
  list.replaceChildren(...state.items.map((it, i) => itemRow(it, i, state.items.length)));
}

export function refreshItemTotals(state: InvoiceState, totals: Totals): void {
  const outs = byId('itemsContainer').querySelectorAll<HTMLOutputElement>('.ir-total');
  outs.forEach((o, i) => {
    const line = totals.lines[i];
    o.textContent = line ? formatMoney(line.amountMinor, state.meta.currency, state.meta.locale) : '';
  });
}

/** Rebuild the list and fill in the amount cells. */
export function rerenderItems(state: InvoiceState): void {
  renderItems(state);
  refreshItemTotals(state, computeTotals(state));
}

function focusItem(id: string, selector = '.ir-desc'): void {
  const row = byId('itemsContainer').querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
  row?.querySelector<HTMLElement>(selector)?.focus();
}

export function bindItems(store: Store<InvoiceState>): void {
  const list = byId('itemsContainer');

  list.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    const field = target.dataset.field as NumField | TextField | undefined;
    const id = target.closest<HTMLElement>('.item-card')?.dataset.id;
    if (!field || !id) return;
    store.update((s) => {
      const item = s.items.find((x) => x.id === id);
      if (!item) return;
      if (field === 'desc' || field === 'unit') item[field] = target.value;
      else if (field === 'taxRate') item.taxRate = parseNum(target.value, field);
      else item[field] = parseNum(target.value, field) ?? 0;
    });
  });

  list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    const id = btn?.closest<HTMLElement>('.item-card')?.dataset.id;
    if (!btn || !id) return;
    const idx = store.get().items.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const action = btn.dataset.action;

    if (action === 'suggest') {
      const current = store.get().items[idx]?.desc ?? '';
      const next = suggestDescription(current);
      if (!next) {
        showToast('Type a short description first, e.g. “logo design”.');
        return;
      }
      store.update((s) => {
        const item = s.items[idx];
        if (item) item.desc = next;
      });
      const input = list.querySelector<HTMLInputElement>(`[data-id="${CSS.escape(id)}"] .ir-desc`);
      if (input) input.value = next;
      return;
    }

    if (action === 'up' || action === 'down') {
      const to = action === 'up' ? idx - 1 : idx + 1;
      store.update((s) => {
        const [moved] = s.items.splice(idx, 1);
        if (moved) s.items.splice(to, 0, moved);
      });
      rerenderItems(store.get());
      focusItem(id, `.ic-${action}:not(:disabled), .ir-desc`);
      return;
    }

    if (action === 'dup') {
      if (store.get().items.length >= MAX_ITEMS) return showToast('Item limit reached.', 'error');
      const copy = { ...store.get().items[idx]!, id: crypto.randomUUID() };
      store.update((s) => s.items.splice(idx + 1, 0, copy));
      rerenderItems(store.get());
      focusItem(copy.id);
      return;
    }

    if (action === 'del') {
      store.update((s) => {
        s.items.splice(idx, 1);
        if (s.items.length === 0) s.items.push(blankItem());
      });
      rerenderItems(store.get());
      const items = store.get().items;
      const focusTarget = items[Math.min(idx, items.length - 1)];
      if (focusTarget) focusItem(focusTarget.id);
    }
  });

  byId('addItemBtn').addEventListener('click', () => {
    if (store.get().items.length >= MAX_ITEMS) return showToast('Item limit reached.', 'error');
    const item = blankItem();
    store.update((s) => s.items.push(item));
    rerenderItems(store.get());
    focusItem(item.id);
  });
}
