/**
 * Feature demos. Each one runs the editor's real code (calc engine, money
 * formatter, phrase library, sheet renderer), so the landing page can never
 * drift from what the app actually does.
 */
import { computeTotals } from '../core/calc';
import { CURRENCIES, LOCALES, formatMoney, toMinor, type CurrencyCode } from '../core/money';
import { suggestDescription } from '../core/suggestions';
import { el } from '../ui/dom';
import { buildSheet, totalRows } from '../ui/sheet';
import { featureInvoice, heroInvoiceComplete } from './demo-data';

/** Facts that come straight from the app's own constants. */
function initFacts(): void {
  const facts: Record<string, string> = {
    currencies: String(CURRENCIES.length),
    locales: String(LOCALES.length),
  };
  document.querySelectorAll<HTMLElement>('[data-fact]').forEach((node) => {
    const v = facts[node.dataset.fact ?? ''];
    if (v) node.textContent = v;
  });
}

function initTotals(): void {
  const out = document.getElementById('totalsDemo');
  const paid = document.getElementById('paidRange') as HTMLInputElement | null;
  if (!out || !paid) return;
  const state = featureInvoice();

  const render = () => {
    const t = computeTotals(state);
    const max = Math.floor(t.total / 100); // demo invoice is in USD (2 decimals)
    paid.max = String(max);
    if (Number(paid.value) > max) paid.value = String(max);
    out.replaceChildren(
      ...totalRows(state, t).map((r) =>
        el('div', { class: `trow${r.kind ? ` trow-${r.kind}` : ''}` }, [
          el('span', { text: r.label }),
          el('span', { class: 'num', text: r.value }),
        ]),
      ),
    );
  };

  document.querySelectorAll<HTMLButtonElement>('[data-discount]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const [type, value] = (btn.dataset.discount ?? 'percent:0').split(':');
      state.totals.discountType = type === 'fixed' ? 'fixed' : 'percent';
      state.totals.discountValue = Number(value) || 0;
      document
        .querySelectorAll<HTMLButtonElement>('[data-discount]')
        .forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      render();
    }),
  );

  const taxToggle = document.getElementById('taxToggle') as HTMLInputElement | null;
  taxToggle?.addEventListener('change', () => {
    state.totals.taxRate = taxToggle.checked ? 20 : 0;
    state.totals.taxLabel = 'VAT';
    render();
  });

  paid.addEventListener('input', () => {
    state.totals.amountPaid = Number(paid.value) || 0;
    render();
  });

  render();
}

function initSuggest(): void {
  const form = document.getElementById('suggestForm') as HTMLFormElement | null;
  const input = document.getElementById('suggestInput') as HTMLInputElement | null;
  const out = document.getElementById('suggestOut');
  if (!form || !input || !out) return;

  const run = () => {
    const next = suggestDescription(input.value);
    out.textContent = next ?? 'Type a few words first, like “logo” or “seo audit”.';
    out.classList.toggle('is-empty', !next);
    if (next) out.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    run();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-suggest]').forEach((chip) =>
    chip.addEventListener('click', () => {
      input.value = chip.dataset.suggest ?? '';
      run();
    }),
  );
  run();
}

function initFormats(): void {
  const list = document.getElementById('formatList');
  if (!list) return;
  const pairs: [CurrencyCode, string, string][] = [
    ['USD', 'en-US', 'United States'],
    ['EUR', 'de-DE', 'Germany'],
    ['EUR', 'fr-FR', 'France'],
    ['GBP', 'en-GB', 'United Kingdom'],
    ['INR', 'en-IN', 'India'],
    ['JPY', 'ja-JP', 'Japan'],
  ];
  const amount = 12345.67;
  list.replaceChildren(
    ...pairs.map(([cur, loc, where]) => {
      const minor = toMinor(amount, cur);
      return el('li', {}, [
        el('span', { class: 'fmt-where', text: where }),
        el('span', { class: 'num', text: formatMoney(minor, cur, loc) }),
      ]);
    }),
  );
}

/** Three real sheets stacked, to show multi-page vector output. */
function initPdfStack(): void {
  const stack = document.getElementById('pdfStack');
  if (!stack) return;
  const inv = heroInvoiceComplete();
  inv.meta.status = 'Unpaid';
  const sheet = buildSheet(inv, computeTotals(inv));
  const pages = [0, 1, 2].map((i) =>
    el('div', { class: `pdf-page pdf-page-${i + 1}`, attrs: { 'aria-hidden': 'true' } }, [
      i === 0 ? sheet : el('div', { class: 'pdf-blank' }),
      el('span', { class: 'pdf-folio', text: `Page ${i + 1} of 3` }),
    ]),
  );
  // Page 1 goes last in the DOM so it sits on top of the stack.
  stack.replaceChildren(...pages.reverse());
}

export function initFeatures(): void {
  initFacts();
  initTotals();
  initSuggest();
  initFormats();
  initPdfStack();
}
