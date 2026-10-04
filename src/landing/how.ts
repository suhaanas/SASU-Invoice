/**
 * "How it works": three real steps beside a sticky live sheet. As each step
 * scrolls into the middle of the viewport, the sheet regions it refers to are
 * highlighted. On small screens the sheet is not sticky and all regions stay lit.
 */
import { computeTotals } from '../core/calc';
import { buildSheet } from '../ui/sheet';
import { heroInvoiceComplete } from './demo-data';

const REGIONS: Record<string, string[]> = {
  fill: ['from', 'client', 'meta'],
  preview: ['items', 'totals'],
  export: ['totals', 'notes'],
};

export function initHow(): void {
  const holder = document.getElementById('howSheet');
  const steps = [...document.querySelectorAll<HTMLElement>('[data-step]')];
  const toast = document.getElementById('howToast');
  if (!holder || steps.length === 0) return;

  const inv = heroInvoiceComplete();
  inv.totals.amountPaid = 0;
  const sheet = buildSheet(inv, computeTotals(inv));
  holder.replaceChildren(sheet);

  const fit = () => {
    const scale = holder.clientWidth / sheet.offsetWidth;
    sheet.style.transform = `scale(${scale})`;
    holder.style.height = `${Math.ceil(sheet.offsetHeight * scale)}px`;
  };
  new ResizeObserver(fit).observe(holder);

  const activate = (step: HTMLElement) => {
    const key = step.dataset.step ?? '';
    const lit = new Set(REGIONS[key] ?? []);
    steps.forEach((s) => s.classList.toggle('is-active', s === step));
    holder.classList.add('has-focus');
    sheet.querySelectorAll<HTMLElement>('[data-region]').forEach((r) =>
      r.classList.toggle('is-lit', lit.has(r.dataset.region ?? '')),
    );
    if (toast) toast.hidden = key !== 'export';
  };

  const io = new IntersectionObserver(
    (entries) => {
      const hit = entries.find((e) => e.isIntersecting);
      if (hit) activate(hit.target as HTMLElement);
    },
    { rootMargin: '-45% 0px -45% 0px' },
  );
  steps.forEach((s) => io.observe(s));
}
