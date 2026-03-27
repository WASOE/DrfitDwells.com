const { test, expect } = require('@playwright/test');
const { getOpsCreds } = require('../helpers/auth');
const opsCreds = getOpsCreds();
const hasOpsCreds = Boolean(opsCreds.username && opsCreds.password);

async function performOpsLogin(page) {
  const creds = getOpsCreds();
  test.skip(!creds.username || !creds.password, 'Missing E2E_OPS_USERNAME / E2E_OPS_PASSWORD');

  await page.goto('/admin/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/username/i).fill(creds.username);
  await page.getByLabel(/password/i).fill(creds.password);
  await page.getByRole('button', { name: /sign in|signing in/i }).click();
  await expect(page).toHaveURL(/\/ops$|\/admin\/bookings$/);
}

test.describe('ops area', () => {
  test('valid login', async ({ browser, baseURL }) => {
    test.skip(!hasOpsCreds, 'Missing ops credentials');
    const ctx = await browser.newContext({ baseURL });
    const page = await ctx.newPage();
    await performOpsLogin(page);
    await expect(page).toHaveURL(/\/ops$|\/admin\/bookings$/);
    await ctx.close();
  });

  test('unauthenticated ops route redirects to admin login', async ({ page }) => {
    await page.goto('/ops/reservations');
    const token = await page.evaluate(() => localStorage.getItem('adminToken'));
    if (token) {
      test.skip(true, 'This project is authenticated by storageState; unauth checks live in permissions suite.');
    }
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test('invalid login', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL });
    const page = await ctx.newPage();
    await page.goto('/admin/login', { waitUntil: 'domcontentloaded' });
    await page.getByLabel(/username/i).fill('invalid-user');
    await page.getByLabel(/password/i).fill('invalid-pass');
    await page.getByRole('button', { name: /sign in|signing in/i }).click();
    await expect(page.getByText(/invalid credentials|login failed|network error/i)).toBeVisible();
    await ctx.close();
  });

  test('authenticated access and session persistence', async ({ page }) => {
    test.skip(!hasOpsCreds, 'Missing ops credentials');
    await page.goto('/ops');
    await expect(page.getByText(/ops console/i)).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/\/ops$/);
  });

  test('reservations list loads and filters/search work', async ({ page }) => {
    test.skip(!hasOpsCreds, 'Missing ops credentials');
    await page.goto('/ops/reservations');
    await expect(page.getByRole('heading', { name: /reservations workspace/i })).toBeVisible();

    await page.getByTestId('ops-filter-status').selectOption('pending');
    await page.getByTestId('ops-filter-search').fill('qa');
    await expect(page).toHaveURL(/status=pending/);
    await expect(page).toHaveURL(/search=qa/);
  });

  test('booking details open when a row exists', async ({ page }) => {
    test.skip(!hasOpsCreds, 'Missing ops credentials');
    await page.goto('/ops/reservations');
    const rows = page.getByTestId('ops-reservation-row');
    if (await rows.count()) {
      await rows.first().click();
      await expect(page).toHaveURL(/\/ops\/reservations\/.+/);
    }
  });

  test('ops logout clears session', async ({ page }) => {
    test.skip(!hasOpsCreds, 'Missing ops credentials');
    await page.goto('/ops');
    const logoutBtn = page.getByRole('button', { name: /logout/i }).first();
    test.skip((await logoutBtn.count()) === 0, 'No explicit ops logout button visible in current deployment');
    await logoutBtn.click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.goto('/ops');
    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});
