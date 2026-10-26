/**
 * SASU Invoice — checkout page (pay.html?_ptxn=…). This is Paddle's "default
 * payment link". We show our own order summary and embed Paddle's checkout
 * inline next to it; card details are entered in Paddle's frame and never
 * touch our pages or servers.
 *
 * Paddle.js is only loaded here, from Paddle's CDN (Paddle does not publish
 * versioned builds, so it cannot be pinned or bundled).
 */
import '@fontsource-variable/dm-sans';
import '@fontsource/space-grotesk/700.css';
import './styles/view.css';
import './styles/pay.css';

import { takeCheckoutPrefill } from './cloud/checkout';
import { byId, el } from './ui/dom';

interface CheckoutData {
  currency_code?: string;
  items?: {
    product?: { name?: string };
    billing_cycle?: { interval?: string; frequency?: number } | null;
    totals?: { total?: number };
  }[];
  totals?: { subtotal?: number; tax?: number; total?: number };
}

interface PaddleGlobal {
  Environment: { set(env: 'sandbox'): void };
  Initialize(opts: {
    token: string;
    eventCallback?: (e: { name?: string; data?: CheckoutData }) => void;
  }): void;
  Checkout: {
    open(opts: {
      transactionId: string;
      customer?: { email?: string; address?: { countryCode: string } };
      settings: Record<string, unknown>;
    }): void;
  };
}

const token = import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined;
const sandbox = import.meta.env.VITE_PADDLE_ENV !== 'live';
const billingUrl = `${location.origin}/dashboard/settings/billing`;

function message(title: string, text: string): void {
  byId('payLayout').hidden = true;
  const view = byId('view');
  view.hidden = false;
  view.replaceChildren(
    el('h1', { text: title }),
    el('p', { text }),
    el('p', {}, [el('a', { text: 'Back to billing', attrs: { href: billingUrl } })]),
  );
}

function money(amount: number | undefined, currency: string | undefined): string {
  if (amount === undefined || !currency) return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

/** Fill the order summary from Paddle's checkout data (prices, tax, total). */
function showSummary(data: CheckoutData | undefined): void {
  const item = data?.items?.[0];
  if (!data || !item) return;
  const currency = data.currency_code;
  const interval = item.billing_cycle?.interval;
  byId('sumPlan').textContent = item.product?.name ?? 'SASU Invoice';
  byId('sumPrice').textContent =
    money(item.totals?.total, currency) + (interval ? ` / ${interval}` : '');
  byId('sumSubtotal').textContent = money(data.totals?.subtotal, currency);
  byId('sumTax').textContent = money(data.totals?.tax, currency);
  byId('sumTotal').textContent = money(data.totals?.total, currency);
  byId('summaryTotals').hidden = false;
}

function load(): void {
  const params = new URLSearchParams(location.search);
  const transactionId = params.get('_ptxn') ?? '';
  if (!token || !/^(test|live)_[A-Za-z0-9]+$/.test(token)) {
    return message('Checkout unavailable', 'Online payments are not set up yet.');
  }
  if (!/^txn_[a-z0-9]+$/.test(transactionId)) {
    return message('Nothing to pay', 'Choose a plan from your billing page to start a checkout.');
  }
  // We open the checkout ourselves (inline, prefilled), so stop Paddle.js
  // from also opening its default overlay for ?_ptxn=.
  history.replaceState(null, '', location.pathname);
  const prefill = takeCheckoutPrefill();

  const script = document.createElement('script');
  script.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
  script.async = true;
  script.onerror = () =>
    message(
      'Checkout unavailable',
      'The payment page could not load. Check your connection and try again.',
    );
  script.onload = () => {
    const Paddle = (window as unknown as { Paddle?: PaddleGlobal }).Paddle;
    if (!Paddle) return message('Checkout unavailable', 'The payment page could not load.');
    if (sandbox) Paddle.Environment.set('sandbox');
    Paddle.Initialize({
      token,
      eventCallback: (e) => {
        if (e.name === 'checkout.loaded') byId('payLoading').hidden = true;
        if (e.name === 'checkout.loaded' || e.name === 'checkout.updated') showSummary(e.data);
        if (e.name === 'checkout.completed') location.assign(`${billingUrl}?checkout=done`);
      },
    });
    Paddle.Checkout.open({
      transactionId,
      ...(prefill
        ? {
            customer: {
              ...(prefill.email ? { email: prefill.email } : {}),
              ...(prefill.country ? { address: { countryCode: prefill.country } } : {}),
            },
          }
        : {}),
      settings: {
        displayMode: 'inline',
        variant: 'one-page',
        frameTarget: 'pay-frame',
        frameInitialHeight: 480,
        frameStyle: 'width: 100%; min-width: 312px; background-color: transparent; border: none;',
        theme: 'light',
        locale: 'en',
        showAddDiscounts: false,
        successUrl: `${billingUrl}?checkout=done`,
      },
    });
  };
  document.head.append(script);
}

load();
