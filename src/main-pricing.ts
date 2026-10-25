/**
 * SASU Invoice — pricing page. Plans, prices and limits come from the
 * database (public price list) so they can change without a deploy; the
 * built-in list is only a fallback when the backend isn't reachable.
 */
import '@fontsource-variable/dm-sans';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import './styles/view.css';
import './styles/pricing.css';

import { cloudConfig } from './cloud/config';
import { formatMoney } from './core/money';
import { byId, el } from './ui/dom';

interface Plan {
  code: string;
  name: string;
  price_minor: number;
  currency: string;
  billing_interval: 'month' | 'year';
  limits: {
    cloud_invoices: number;
    users: number;
    email_sends_per_month: number;
    ai_requests_per_month: number;
  };
  features: string[];
}

/** Mirrors the seeded plans (supabase/migrations); used only if the live list can't load. */
const FALLBACK: Plan[] = [
  {
    code: 'free',
    name: 'Free',
    price_minor: 0,
    currency: 'USD',
    billing_interval: 'month',
    limits: { cloud_invoices: 0, users: 1, email_sends_per_month: 0, ai_requests_per_month: 0 },
    features: ['local_editor'],
  },
  {
    code: 'pro',
    name: 'Pro',
    price_minor: 1200,
    currency: 'USD',
    billing_interval: 'month',
    limits: {
      cloud_invoices: 100,
      users: 1,
      email_sends_per_month: 100,
      ai_requests_per_month: 100,
    },
    features: [
      'local_editor',
      'cloud_storage',
      'reminders',
      'ai_basic',
      'recurring',
      'reports_standard',
    ],
  },
  {
    code: 'business',
    name: 'Business',
    price_minor: 2900,
    currency: 'USD',
    billing_interval: 'month',
    limits: {
      cloud_invoices: 500,
      users: 5,
      email_sends_per_month: 600,
      ai_requests_per_month: 600,
    },
    features: [
      'local_editor',
      'cloud_storage',
      'reminders',
      'reminders_advanced',
      'ai_basic',
      'team',
      'priority_support',
    ],
  },
];

const FEATURE_TEXT: Record<string, string> = {
  local_editor: 'Unlimited invoices in your browser, PDF and PNG export',
  cloud_storage: 'Cloud storage, clients and payment tracking',
  reminders: 'RecoverFlow automatic payment reminders',
  reminders_advanced: 'Custom reminder schedules and wording',
  ai_basic: 'AI-written reminders and reply analysis (coming soon)',
  team: 'Team members with roles',
  priority_support: 'Priority support',
};

async function loadPlans(): Promise<Plan[]> {
  if (!cloudConfig) return FALLBACK;
  try {
    const res = await fetch(
      `${cloudConfig.url}/rest/v1/plans?select=code,name,price_minor,currency,billing_interval,limits,features&is_active=eq.true&order=sort_order`,
      { headers: { apikey: cloudConfig.anonKey, Authorization: `Bearer ${cloudConfig.anonKey}` } },
    );
    if (!res.ok) return FALLBACK;
    const plans = (await res.json()) as Plan[];
    return plans.length ? plans : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

function card(plan: Plan): HTMLElement {
  const free = plan.price_minor === 0;
  const limits = plan.limits;
  const lines = [
    ...(free ? [] : [`${limits.cloud_invoices} cloud invoices`]),
    `${limits.users} ${limits.users === 1 ? 'user' : 'users'}`,
    ...(limits.email_sends_per_month ? [`${limits.email_sends_per_month} emails a month`] : []),
    ...(limits.ai_requests_per_month
      ? [`${limits.ai_requests_per_month} AI requests a month`]
      : []),
    ...plan.features.map((f) => FEATURE_TEXT[f]).filter((t): t is string => !!t),
  ];
  const price = formatMoney(plan.price_minor, plan.currency, 'en-US').replace(/\.00$/, '');
  return el(
    'section',
    {
      class: `plan${plan.code === 'pro' ? ' featured' : ''}`,
      attrs: { 'aria-label': `${plan.name} plan` },
    },
    [
      el('h2', { text: plan.name }),
      el('p', { class: 'plan-price' }, [
        document.createTextNode(price),
        el('small', { text: free ? ' forever' : ` / ${plan.billing_interval}` }),
      ]),
      el(
        'ul',
        {},
        lines.map((t) => el('li', { text: t })),
      ),
      el('a', {
        class: `view-btn${plan.code === 'pro' ? ' primary' : ''}`,
        text: free
          ? 'Open the editor'
          : plan.code === 'pro'
            ? 'Start 14-day free trial'
            : `Choose ${plan.name}`,
        attrs: { href: free ? '/app.html' : '/dashboard/register' },
      }),
    ],
  );
}

void loadPlans().then((plans) => byId('plans').replaceChildren(...plans.map(card)));
