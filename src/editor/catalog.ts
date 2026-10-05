/**
 * Item catalogue: save frequently billed line items and insert them again.
 * Stored separately from invoices in this browser.
 */
import { blankItem, type InvoiceState, type LineItem, type Store } from '../core/state';
import { loadCatalog, saveCatalog } from '../core/storage';
import type { CatalogItem } from '../core/validate';
import { byId, el } from '../ui/dom';
import { rerenderItems } from '../ui/items';
import { showToast } from '../ui/toast';
import { formatMoney, toMinor } from '../core/money';

export interface CatalogApi {
  saveFrom(item: LineItem): void;
  all(): CatalogItem[];
  merge(items: CatalogItem[]): void;
  clear(): void;
  render(): void;
}

export function initCatalog(store: Store<InvoiceState>): CatalogApi {
  let items = loadCatalog();
  const picker = byId<HTMLSelectElement>('catalogPicker');
  const list = byId('catalogList');

  const persist = () => {
    if (!saveCatalog(items)) showToast('Could not save: browser storage is full.', 'error');
    render();
  };

  function render(): void {
    const { currency, locale } = store.get().meta;
    picker.hidden = items.length === 0;
    byId('catalogPanel').hidden = items.length === 0;
    picker.replaceChildren(
      el('option', { text: 'Insert saved item…', attrs: { value: '' } }),
      ...items.map((it) =>
        el('option', {
          text: `${it.desc.slice(0, 60)} (${formatMoney(toMinor(it.rate, currency), currency, locale)})`,
          attrs: { value: it.id },
        }),
      ),
    );
    list.replaceChildren(
      ...items.map((it) =>
        el('li', { class: 'catalog-row', attrs: { 'data-id': it.id } }, [
          el('span', { class: 'catalog-desc', text: it.desc || 'Untitled item' }),
          el('button', {
            class: 'mini-btn danger',
            text: 'Remove',
            attrs: { type: 'button', 'aria-label': `Remove ${it.desc} from saved items` },
          }),
        ]),
      ),
    );
  }

  picker.addEventListener('change', () => {
    const it = items.find((x) => x.id === picker.value);
    picker.value = '';
    if (!it) return;
    store.update((s) => {
      // Replace a single untouched blank line instead of appending after it.
      const onlyBlank = s.items.length === 1 && !s.items[0]!.desc && !s.items[0]!.rate;
      const line = { ...blankItem(), desc: it.desc, unit: it.unit, rate: it.rate, taxRate: it.taxRate, vatCategory: it.vatCategory };
      s.items = onlyBlank ? [line] : [...s.items, line];
    });
    rerenderItems(store.get());
    showToast('Item added');
  });

  list.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest('button') && (e.target as HTMLElement).closest<HTMLElement>('.catalog-row')?.dataset.id;
    if (!id) return;
    items = items.filter((x) => x.id !== id);
    persist();
  });

  render();

  return {
    saveFrom(item) {
      if (!item.desc.trim()) {
        showToast('Add a description before saving the item.', 'error');
        return;
      }
      const key = (x: { desc: string; rate: number }) => `${x.desc.trim().toLowerCase()}|${x.rate}`;
      if (items.some((x) => key(x) === key(item))) {
        showToast('That item is already saved');
        return;
      }
      items = [
        { id: crypto.randomUUID(), desc: item.desc, unit: item.unit, rate: item.rate, taxRate: item.taxRate, vatCategory: item.vatCategory },
        ...items,
      ].slice(0, 2000);
      persist();
      showToast('Saved to your items');
    },
    all: () => items,
    merge(incoming) {
      const ids = new Set(incoming.map((x) => x.id));
      items = [...incoming, ...items.filter((x) => !ids.has(x.id))].slice(0, 2000);
      persist();
    },
    clear() {
      items = [];
      render();
    },
    render,
  };
}
