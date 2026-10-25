import { expect, test } from '@playwright/test';
import { CLIENT, INVOICE, signedInOwner } from './mock-supabase';

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
