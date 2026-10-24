/**
 * SASU Invoice — client invoice view (invoice.html#t=<token>).
 * What a client sees from a share link: the document exactly as the business
 * issued it, the amount still due, a PDF download, and ways to pay or reply.
 * The token stays in the URL fragment, so it is never sent to Netlify or in a
 * Referer header; only the database function sees it.
 */
import '@fontsource-variable/dm-sans';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import './styles/sheet.css';
import './styles/view.css';

import { computeTotals } from './core/calc';
import { formatDate } from './core/dates';
import { formatMoney } from './core/money';
import { safePaymentLink } from './core/payment';
import { DOC_TITLES, type InvoiceState } from './core/state';
import { parseInvoice } from './core/validate';
import { cloudConfig } from './cloud/config';
import { byId, el } from './ui/dom';
import { exportPDF } from './ui/exports';
import { applyAccent } from './ui/render';
import { buildSheet } from './ui/sheet';

interface Shared {
  document: unknown;
  status: string;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  dueDate: string | null;
  payments: { paidOn: string; amountMinor: number }[];
}

const root = byId('view');

function message(title: string, text: string): void {
  root.replaceChildren(
    el('div', { class: 'view-card view-message' }, [el('h1', { text: title }), el('p', { text })]),
  );
}

async function rpc(name: string, token: string): Promise<Response> {
  return fetch(`${cloudConfig!.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: cloudConfig!.anonKey,
      Authorization: `Bearer ${cloudConfig!.anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_token: token }),
    referrerPolicy: 'no-referrer',
  });
}

async function fetchShared(token: string): Promise<Shared | null> {
  const res = await rpc('get_shared_invoice', token);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Shared | null;
}

/** "Stop reminder emails": the client's own choice, honoured for all their invoices. */
function optOutControl(token: string): HTMLElement {
  const wrap = el('p', { class: 'view-note' });
  const btn = el('button', {
    class: 'view-link',
    text: 'Stop automatic reminder emails',
    attrs: { type: 'button' },
  });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const res = await rpc('opt_out_reminders', token);
      const ok = res.ok && ((await res.json()) as boolean) === true;
      wrap.replaceChildren(
        ok
          ? 'Done. You won’t receive automatic payment reminders from this sender. You may still hear from them directly.'
          : 'This link can’t be used to change reminders any more. Please contact the sender.',
      );
    } catch {
      btn.disabled = false;
      wrap.append(' Couldn’t save that; please try again.');
    }
  });
  wrap.append('Prefer not to get payment reminders by email? ', btn);
  return wrap;
}

/** Status as the client should read it. */
function clientStatus(s: Shared, today: string): { label: string; tone: string } {
  if (s.status === 'Cancelled') return { label: 'Cancelled', tone: '' };
  if (s.balanceMinor <= 0 && s.totalMinor > 0) return { label: 'Paid', tone: 'paid' };
  if (s.dueDate && s.dueDate < today) return { label: 'Overdue', tone: 'overdue' };
  if (s.paidMinor > 0) return { label: 'Partially paid', tone: 'partial' };
  return { label: 'Due', tone: '' };
}

function fitSheet(frame: HTMLElement, sheet: HTMLElement): void {
  const scale = Math.min(1, frame.clientWidth / sheet.offsetWidth);
  sheet.style.transform = scale < 1 ? `scale(${scale})` : '';
  frame.style.height = `${sheet.offsetHeight * scale}px`;
}

function render(shared: Shared, doc: InvoiceState, token: string): void {
  const totals = computeTotals(doc);
  const { currency, locale } = doc.meta;
  const m = (minor: number) => formatMoney(minor, currency, locale);
  const today = new Date().toISOString().slice(0, 10);
  const status = clientStatus(shared, today);
  const title = `${DOC_TITLES[doc.docType]} ${doc.meta.number}`;
  document.title = `${title} | ${doc.business.name || 'SASU Invoice'}`;
  applyAccent(doc.style.accent);

  const actions = el('div', { class: 'view-actions' });
  const pdf = el('button', { class: 'view-btn', text: 'Download PDF', attrs: { type: 'button' } });
  pdf.addEventListener('click', () => void exportPDF(doc));
  actions.append(pdf);
  const payLink = doc.payment.method === 'link' ? safePaymentLink(doc.payment.link) : null;
  if (payLink && shared.balanceMinor > 0 && status.label !== 'Cancelled') {
    actions.prepend(
      el('a', {
        class: 'view-btn primary',
        text: 'Pay online',
        attrs: { href: payLink, target: '_blank', rel: 'noopener noreferrer' },
      }),
    );
  }
  if (doc.business.email.trim()) {
    const mail = `mailto:${encodeURIComponent(doc.business.email.trim())}?subject=${encodeURIComponent(title)}`;
    actions.append(
      el('a', {
        class: 'view-btn',
        text: `Contact ${doc.business.name || 'the sender'}`,
        attrs: { href: mail },
      }),
    );
  }

  const summary = el('section', { class: 'view-card', attrs: { 'aria-label': 'Summary' } }, [
    el('div', { class: 'view-summary' }, [
      el('div', {}, [
        el('p', { class: 'view-from', text: `From ${doc.business.name || 'the sender'}` }),
        el('h1', { class: 'view-title' }, [
          document.createTextNode(title),
          el('span', { class: `view-pill ${status.tone}`, text: status.label }),
        ]),
      ]),
      el('div', {}, [
        el('p', { class: 'view-amount', text: m(shared.balanceMinor) }),
        el('p', {
          class: 'view-meta',
          text:
            shared.balanceMinor > 0
              ? `Amount due${shared.dueDate ? ` by ${formatDate(shared.dueDate, locale)}` : ''} · total ${m(totals.total)}`
              : `Total ${m(totals.total)}`,
        }),
      ]),
    ]),
    actions,
  ]);
  if (shared.payments.length > 0) {
    summary.append(
      el(
        'ul',
        { class: 'view-payments', attrs: { 'aria-label': 'Payments received' } },
        shared.payments.map((p) =>
          el('li', {}, [
            el('span', { text: `Payment received ${formatDate(p.paidOn, locale)}` }),
            el('span', { text: m(p.amountMinor) }),
          ]),
        ),
      ),
    );
  }

  const sheet = buildSheet(doc, totals);
  sheet.classList.add('inv-sheet');
  sheet.id = 'invoicePage';
  const frame = el('div', { class: 'view-sheet-frame' }, [sheet]);
  root.replaceChildren(
    summary,
    frame,
    el('p', {
      class: 'view-note',
      text: 'This page was shared with you privately. If you think you received it by mistake, please let the sender know.',
    }),
  );
  if (shared.balanceMinor > 0) root.append(optOutControl(token));
  fitSheet(frame, sheet);
  new ResizeObserver(() => fitSheet(frame, sheet)).observe(frame);
}

async function boot(): Promise<void> {
  const token = new URLSearchParams(location.hash.slice(1)).get('t') ?? '';
  if (!cloudConfig) return message('Unavailable', 'Shared invoices aren’t available on this site.');
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return message(
      'Link incomplete',
      'This link looks incomplete. Copy the full link from the message you received.',
    );
  }
  try {
    const shared = await fetchShared(token);
    const doc = shared ? parseInvoice(shared.document) : null;
    if (!shared || !doc) {
      return message(
        'Link expired',
        'This link has expired or was turned off. Ask the sender for a new one.',
      );
    }
    render(shared, doc, token);
  } catch {
    message('Couldn’t load the invoice', 'Check your connection and reload the page.');
  }
}

void boot();
