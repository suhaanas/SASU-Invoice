import { expect, test } from '@playwright/test';

test.describe('dashboard (signed out)', () => {
  test('protected pages send you to sign in', async ({ page }) => {
    await page.goto('/dashboard/invoices');
    await expect(page).toHaveURL(/\/dashboard\/login\?next=%2Finvoices/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('wrong credentials show a clear message', async ({ page }) => {
    await page.route('**/auth/v1/token**', (route) =>
      route.fulfill({
        status: 400,
        json: {
          code: 'invalid_credentials',
          error_code: 'invalid_credentials',
          msg: 'Invalid login credentials',
        },
      }),
    );
    await page.goto('/dashboard/login');
    await page.getByLabel('Email').fill('owner@studio.test');
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText(/don’t match|Invalid login/);
  });

  test('registration validates before calling the server', async ({ page }) => {
    let called = false;
    await page.route('**/auth/v1/signup**', (route) => {
      called = true;
      return route.abort();
    });
    await page.goto('/dashboard/register');
    await page.getByLabel('Work email').fill('owner@studio.test');
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('alert')).toContainText('at least 10 characters');
    expect(called).toBe(false);
  });

  test('open redirects are refused after sign-in', async ({ page }) => {
    await page.goto('/dashboard/login?next=//evil.test');
    await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/dashboard/register?next=%2F',
    );
  });
});

test.describe('Google sign-in', () => {
  const settings = (google: boolean) => ({ external: { email: true, google } });

  test('the Google button appears once Google is switched on', async ({ page }) => {
    await page.route('**/auth/v1/settings', (route) => route.fulfill({ json: settings(true) }));
    let authorize = '';
    await page.route('**/auth/v1/authorize**', (route) => {
      authorize = route.request().url();
      return route.fulfill({ status: 200, contentType: 'text/html', body: 'google' });
    });
    await page.goto('/dashboard/login?next=%2Finvoices');
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await expect.poll(() => authorize).toContain('provider=google');
    const redirect = new URL(authorize).searchParams.get('redirect_to') ?? '';
    expect(redirect).toMatch(/\/dashboard\/invoices$/);
  });

  test('without Google, only email sign-in is offered', async ({ page }) => {
    await page.route('**/auth/v1/settings', (route) => route.fulfill({ json: settings(false) }));
    await page.goto('/dashboard/register');
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
  });

  test('a failed Google sign-in explains what happened', async ({ page }) => {
    await page.route('**/auth/v1/settings', (route) => route.fulfill({ json: settings(true) }));
    await page.goto('/dashboard/login?error=access_denied&error_description=User+cancelled');
    await expect(page.getByRole('alert')).toContainText('Google sign-in didn’t complete');
  });
});

test('the password field can be revealed', async ({ page }) => {
  await page.goto('/dashboard/login');
  const field = page.getByLabel('Password', { exact: true });
  await field.fill('secret-123');
  await expect(field).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(field).toHaveAttribute('type', 'text');
});
