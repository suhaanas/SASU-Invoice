/**
 * Hero: a real invoice, rendered by the editor's own `buildSheet`, that fills
 * itself in once (the page's single orchestrated animation) and ends with a
 * "Paid" stamp. The currency switch re-renders it through the real formatter.
 */
import { computeTotals } from '../core/calc';
import { formatMoney, roundHalfUp, type CurrencyCode, type LocaleCode } from '../core/money';
import { blankItem, type InvoiceState } from '../core/state';
import { buildSheet } from '../ui/sheet';
import { HERO_CLIENT, HERO_LINES, heroInvoice, heroInvoiceComplete } from './demo-data';
import { countUp, reducedMotion, sleep, whenVisible } from './motion';

/** Illustrative conversions from the GBP demo prices, rounded to tidy numbers. */
const CURRENCY_VIEWS: Record<
  string,
  { currency: CurrencyCode; locale: LocaleCode; rate: number; step: number }
> = {
  GBP: { currency: 'GBP', locale: 'en-GB', rate: 1, step: 1 },
  USD: { currency: 'USD', locale: 'en-US', rate: 1.3, step: 5 },
  EUR: { currency: 'EUR', locale: 'fr-FR', rate: 1.15, step: 5 },
  INR: { currency: 'INR', locale: 'en-IN', rate: 110, step: 100 },
  LKR: { currency: 'LKR', locale: 'en-GB', rate: 390, step: 500 },
  JPY: { currency: 'JPY', locale: 'ja-JP', rate: 195, step: 1000 },
};

let currencyKey = 'GBP';

function view(base: InvoiceState): InvoiceState {
  const v = CURRENCY_VIEWS[currencyKey] ?? CURRENCY_VIEWS.GBP!;
  if (v.rate === 1) return base;
  return {
    ...base,
    meta: { ...base.meta, currency: v.currency, locale: v.locale },
    items: base.items.map((it) => ({
      ...it,
      rate: roundHalfUp((it.rate * v.rate) / v.step) * v.step,
    })),
  };
}

export function initHero(): void {
  const desk = document.getElementById('heroDesk');
  const holder = document.getElementById('heroSheet');
  const field = document.getElementById('heroField');
  const fieldLabel = document.getElementById('heroFieldLabel');
  const stamp = document.getElementById('heroStamp');
  const replay = document.getElementById('heroReplay') as HTMLButtonElement | null;
  if (!desk || !holder || !field || !fieldLabel || !stamp || !replay) return;

  let state = heroInvoice();
  let sheet: HTMLElement | null = null;

  const fit = () => {
    if (!sheet) return;
    const scale = holder.clientWidth / sheet.offsetWidth;
    sheet.style.transform = `scale(${scale})`;
    holder.style.height = `${Math.ceil(sheet.offsetHeight * scale)}px`;
  };

  const render = () => {
    const v = view(state);
    sheet = buildSheet(v, computeTotals(v));
    holder.replaceChildren(sheet);
    fit();
  };
  new ResizeObserver(fit).observe(holder);

  /** Overwrite the visible grand total while it counts up. */
  const grandCell = () => holder.querySelector<HTMLElement>('.itm-grand span:last-child');

  const typeInto = async (
    label: string,
    text: string,
    perChar: number,
    onChar: (s: string) => void,
  ) => {
    fieldLabel.textContent = label;
    field.textContent = '';
    for (let i = 1; i <= text.length; i++) {
      const s = text.slice(0, i);
      field.textContent = s;
      onChar(s);
      await sleep(perChar);
    }
  };

  const showStamp = () => {
    stamp.hidden = false;
    if (reducedMotion()) return;
    stamp.animate(
      [
        { opacity: 0, transform: 'rotate(-14deg) scale(1.9)' },
        { opacity: 1, transform: 'rotate(-9deg) scale(0.96)', offset: 0.7 },
        { opacity: 1, transform: 'rotate(-9deg) scale(1)' },
      ],
      { duration: 380, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'both' },
    );
  };

  const finish = () => {
    state = heroInvoiceComplete();
    state.meta.status = 'Paid';
    render();
    fieldLabel.textContent = 'Status';
    field.textContent = 'Marked as paid';
    stamp.hidden = false;
    replay.hidden = false;
  };

  let running = false;
  const play = async () => {
    if (running) return;
    running = true;
    replay.hidden = true;
    stamp.hidden = true;
    state = heroInvoice();
    render();

    await typeInto('Bill to', HERO_CLIENT, 55, (s) => {
      state.client.name = s;
      render();
    });
    await sleep(350);

    for (const line of HERO_LINES) {
      const before = computeTotals(view(state)).total;
      fieldLabel.textContent = 'Line item';
      field.textContent = line.desc;
      state.items.push({ ...blankItem(), ...line });
      render();
      const after = computeTotals(view(state)).total;
      const { currency, locale } = view(state).meta;
      await countUp(before, after, 650, (v) => {
        const cell = grandCell();
        if (cell) cell.textContent = formatMoney(v, currency, locale);
      });
      render();
      await sleep(450);
    }

    await sleep(600);
    fieldLabel.textContent = 'Status';
    field.textContent = 'Marked as paid';
    state.meta.status = 'Paid';
    render();
    showStamp();
    replay.hidden = false;
    running = false;
  };

  replay.addEventListener('click', () => void play());

  // Currency switch: re-render the same invoice through the real formatter.
  document.querySelectorAll<HTMLButtonElement>('[data-currency]').forEach((btn) => {
    btn.addEventListener('click', () => {
      currencyKey = btn.dataset.currency ?? 'GBP';
      document
        .querySelectorAll<HTMLButtonElement>('[data-currency]')
        .forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      render();
    });
  });

  if (reducedMotion()) {
    finish();
    return;
  }
  render();
  void whenVisible(desk).then(play);
}
