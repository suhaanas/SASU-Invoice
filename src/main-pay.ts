/**
 * SASU Invoice — checkout page (pay.html?_ptxn=…). This is Paddle's "default
 * payment link": Paddle.js reads the transaction id from the URL and opens its
 * checkout. Card details never touch our pages or servers.
 *
 * Paddle.js is only loaded here, from Paddle's CDN (Paddle does not publish
 * versioned builds, so it cannot be pinned or bundled).
 */
import '@fontsource-variable/dm-sans';
import '@fontsource/space-grotesk/700.css';
import './styles/view.css';

import { byId, el } from './ui/dom';

interface PaddleGlobal {
  Environment: { set(env: 'sandbox'): void };
  Initialize(opts: {
    token: string;
    checkout?: { settings?: { displayMode?: 'overlay'; successUrl?: string } };
    eventCallback?: (e: { name?: string }) => void;
  }): void;
}

const token = import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined;
const sandbox = import.meta.env.VITE_PADDLE_ENV !== 'live';
const billingUrl = `${location.origin}/dashboard/settings/billing`;

function message(title: string, text: string): void {
  byId('view').replaceChildren(
    el('h1', { text: title }),
    el('p', { text }),
    el('p', {}, [el('a', { text: 'Back to billing', attrs: { href: billingUrl } })]),
  );
}

function load(): void {
  if (!token || !/^(test|live)_[A-Za-z0-9]+$/.test(token)) {
    return message('Checkout unavailable', 'Online payments are not set up yet.');
  }
  if (!new URLSearchParams(location.search).has('_ptxn')) {
    return message('Nothing to pay', 'Choose a plan from your billing page to start a checkout.');
  }
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
      checkout: { settings: { displayMode: 'overlay', successUrl: `${billingUrl}?checkout=done` } },
      eventCallback: (e) => {
        if (e.name === 'checkout.closed') location.assign(billingUrl);
      },
    });
  };
  document.head.append(script);
}

load();
