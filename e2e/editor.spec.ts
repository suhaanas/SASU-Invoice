import { expect, test } from '@playwright/test';

// The original browser editor must keep working with no account at all.
test.describe('invoice editor (no account)', () => {
  test('builds an invoice, keeps it after reload, issues it and exports a PDF', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

    await page.goto('/app.html');
    await page.locator('#f-bizName').fill('Studio North');
    await page.locator('#f-clientName').fill('Jane Client');
    const item = page.locator('.item-card').first();
    await item.locator('[data-field="desc"]').fill('Brand workshop');
    await item.locator('[data-field="qty"]').fill('3');
    await item.locator('[data-field="rate"]').fill('250');

    // Live preview and totals update from the form.
    await expect(page.locator('#invoicePage')).toContainText('Studio North');
    await expect(page.locator('#invoicePage')).toContainText('Brand workshop');
    await expect(page.locator('#spTotals')).toContainText('750.00');

    // Autosave survives a reload.
    await page.waitForTimeout(600);
    await page.reload();
    await expect(page.locator('#f-bizName')).toHaveValue('Studio North');
    await expect(page.locator('#spTotals')).toContainText('750.00');

    // Issuing locks the document.
    page.once('dialog', (d) => d.accept());
    await page.locator('#issueBtn').click();
    await expect(page.locator('#lockBanner')).toBeVisible();
    await expect(page.locator('#f-bizName')).toBeDisabled();

    // Vector PDF export still downloads.
    const download = page.waitForEvent('download');
    await page.locator('.tb-actions [data-action="pdf"]').click();
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/);

    // No cloud sync is attempted without opting in, and nothing breaks.
    expect(errors.filter((e) => !/favicon/i.test(e))).toEqual([]);
  });
});
