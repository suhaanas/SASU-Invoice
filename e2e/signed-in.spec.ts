import { expect, test } from '@playwright/test';
import { BASE, CLIENT, INVOICE, ORG, signedInOwner } from './mock-supabase';

/**
 * Every signed-in dashboard screen renders with realistic data and without
 * runtime errors (backend mocked; see mock-supabase.ts).
 */
const SCREENS: [string, string | RegExp][] = [
  ['/', 'Studio North'],
  ['/invoices', 'Invoices'],
  [`/invoices/${INVOICE}`, /INV-041/],
  ['/clients', 'Clients'],
  [`/clients/${CLIENT}`, /Acme Ltd/],
  ['/reminders', 'RecoverFlow AI'],
  ['/recurring', 'Recurring invoices'],
  ['/reports', 'Reports'],
  ['/browser', 'This browser'],
  ['/search?q=acme', 'Search'],
  ['/settings/organization', 'Business settings'],
  ['/settings/team', 'Team'],
  ['/settings/account', 'Account'],
  ['/settings/billing', 'Billing'],
  ['/admin', 'Platform admin'],
];

for (const [path, heading] of SCREENS) {
  test(`renders ${path}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
        errors.push(`console: ${m.text()}`);
    });
    await signedInOwner(page);
    await page.goto(`/dashboard${path}`);
    await expect(page.getByRole('heading', { level: 1, name: heading }).first()).toBeVisible();
    // Let queries settle, then make sure nothing is stuck in an error state.
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Something went wrong. Please try again.')).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(`${path.replace(/[^a-z0-9]+/gi, '_') || 'home'}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}

test('the overview shows real figures per currency', async ({ page }) => {
  await signedInOwner(page);
  await page.goto('/dashboard/');
  await expect(page.getByText('£2,400.00').first()).toBeVisible();
  await expect(page.getByText('Partially paid').first()).toBeVisible();
  await expect(page.getByRole('img', { name: /Invoiced vs received/ })).toBeVisible();
});

test('the mobile layout uses a navigation drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedInOwner(page);
  await page.goto('/dashboard/invoices');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page
    .getByRole('dialog', { name: 'Navigation' })
    .getByRole('link', { name: 'Clients' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

test('AI features show "Coming soon" while the AI switch is off', async ({ page }) => {
  await signedInOwner(page);
  await page.goto('/dashboard/');
  await expect(page.getByText('What needs attention')).toBeVisible();
  await expect(page.getByText('Coming soon').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Explain/ })).toHaveCount(0);
  await page.goto(`/dashboard/invoices/${INVOICE}`);
  await expect(page.getByRole('button', { name: /Analyze/ })).toHaveCount(0);
  await expect(page.getByText(/Soon you’ll be able to paste a client’s reply/)).toBeVisible();
});

test('the getting-started checklist shows what is left and can be hidden', async ({ page }) => {
  await signedInOwner(page);
  await page.goto('/dashboard/');
  const checklist = page.getByRole('region', { name: 'Get set up' });
  await expect(page.getByRole('heading', { name: 'Get set up' })).toBeVisible();
  // The fixture has business details, clients, invoices and reminders, but no logo.
  await expect(checklist.getByText('Upload your logo (to do)')).toBeAttached();
  await expect(checklist.getByText('Add your business details (done)')).toBeAttached();
  await expect(checklist.getByRole('link', { name: 'Upload logo' })).toHaveAttribute(
    'href',
    '/dashboard/settings/organization',
  );
  await page.getByRole('button', { name: 'Hide checklist' }).click();
  await expect(page.getByRole('heading', { name: 'Get set up' })).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Studio North', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Get set up' })).toBeHidden();
});

test('a new account sets up its workspace in one short form', async ({ page }) => {
  await signedInOwner(page);
  let created = false;
  // No memberships until the organization is created.
  await page.route(`${BASE}/rest/v1/organization_members**`, (route, req) =>
    created || req.method() !== 'GET' ? route.fallback() : route.fulfill({ json: [] }),
  );
  let body: Record<string, unknown> = {};
  await page.route(`${BASE}/rest/v1/rpc/create_organization`, (route) => {
    body = route.request().postDataJSON() as Record<string, unknown>;
    created = true;
    return route.fulfill({ json: ORG });
  });
  await page.goto('/dashboard/');
  await expect(page).toHaveURL(/\/dashboard\/onboarding/);
  await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();
  await page.getByLabel('Company or trading name').fill('Harbour Design');
  await page.getByLabel('Country').selectOption('LK');
  await expect(page.getByLabel('Default currency')).toHaveValue('LKR');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { name: 'You’re all set' })).toBeVisible();
  expect(body).toMatchObject({ p_name: 'Harbour Design', p_country: 'LK', p_currency: 'LKR' });
  await expect(page.getByRole('link', { name: /Create your first invoice/ })).toHaveAttribute(
    'href',
    '/app.html',
  );
});
