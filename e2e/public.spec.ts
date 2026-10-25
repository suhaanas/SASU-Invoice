import { expect, test } from '@playwright/test';

test('landing page links to pricing, and pricing shows the plans', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Pricing' }).first().click();
  await expect(page.getByRole('heading', { name: /Simple pricing/ })).toBeVisible();
  // The placeholder backend isn't reachable, so the built-in plan list is used.
  await page.route('**/rest/v1/plans**', (route) => route.abort());
  await expect(page.getByRole('region', { name: 'Pro plan' })).toContainText('$12');
  await expect(page.getByRole('region', { name: 'Business plan' })).toContainText('$29');
});

test('production security headers are served', async ({ request }) => {
  const res = await request.get('/app.html');
  const csp = res.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain('unsafe-eval');
  expect(csp).toContain("frame-ancestors 'none'");
  expect(res.headers()['x-frame-options']).toBe('DENY');
});

test('the client invoice view renders a shared invoice and offers opt-out', async ({ page }) => {
  const doc = {
    version: 2,
    id: '11111111-2222-3333-4444-555555555555',
    docType: 'invoice',
    ref: null,
    business: {
      name: 'Studio North',
      address: '',
      email: 'hi@studio.test',
      phone: '',
      website: '',
      taxId: '',
      legal: { form: '', capital: '', regNumber: '', regPlace: '' },
    },
    client: {
      name: 'Jane Client',
      company: '',
      address: '',
      email: '',
      phone: '',
      taxId: '',
      regNumber: '',
      deliveryAddress: '',
    },
    meta: {
      number: 'INV-042',
      currency: 'GBP',
      locale: 'en-GB',
      issueDate: '2026-10-01',
      dueTerm: 'net30',
      dueDate: '2099-10-31',
      poNumber: '',
      status: 'Unpaid',
      supplyDate: '',
      supplySameAsIssue: true,
      validUntil: '',
      operation: '',
      issuedAt: 1,
    },
    items: [
      {
        id: 'a',
        desc: 'Brand workshop',
        qty: 3,
        unit: '',
        rate: 250,
        taxRate: null,
        vatCategory: 'S',
      },
    ],
    totals: {
      discountType: 'percent',
      discountValue: 0,
      taxRate: 0,
      taxLabel: 'VAT',
      shipping: 0,
      amountPaid: 250,
    },
    notes: { paymentTerms: '', notes: '', bankDetails: '', footer: '', legalMentions: [] },
    payment: { method: 'none', beneficiary: '', iban: '', bic: '', upiId: '', link: '' },
    style: { accent: '#5b5ef4', logoShape: 'square', logo: '' },
    updatedAt: 1,
  };
  let optedOut = false;
  await page.route('**/rest/v1/rpc/get_shared_invoice', (route) =>
    route.fulfill({
      json: {
        document: doc,
        status: 'Unpaid',
        currency: 'GBP',
        totalMinor: 75000,
        paidMinor: 25000,
        balanceMinor: 50000,
        dueDate: '2099-10-31',
        payments: [{ paidOn: '2026-10-10', amountMinor: 25000 }],
      },
    }),
  );
  await page.route('**/rest/v1/rpc/opt_out_reminders', (route) => {
    optedOut = true;
    return route.fulfill({ json: true });
  });
  await page.goto(`/invoice.html#t=${'a'.repeat(64)}`);
  await expect(page.getByRole('heading', { name: /Invoice INV-042/ })).toBeVisible();
  await expect(page.locator('.view-amount')).toHaveText('£500.00');
  await expect(page.getByText('Partially paid')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  expect((await download).suggestedFilename()).toMatch(/INV-042.*\.pdf$/);
  await page.getByRole('button', { name: 'Stop automatic reminder emails' }).click();
  await expect(page.getByText(/won’t receive automatic payment reminders/)).toBeVisible();
  expect(optedOut).toBe(true);
});

test('an incomplete client link explains itself', async ({ page }) => {
  await page.goto('/invoice.html#t=short');
  await expect(page.getByRole('heading', { name: 'Link incomplete' })).toBeVisible();
});
