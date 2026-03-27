const { test, expect } = require('@playwright/test');
const { getAdminCreds } = require('../helpers/auth');
const adminCreds = getAdminCreds();
const hasAdminCreds = Boolean(adminCreds.username && adminCreds.password);

async function performAdminLogin(page) {
  const creds = getAdminCreds();
  test.skip(!creds.username || !creds.password, 'Missing E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD');

  await page.goto('/admin/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/username/i).fill(creds.username);
  await page.getByLabel(/password/i).fill(creds.password);
  await page.getByRole('button', { name: /sign in|signing in/i }).click();
  await expect(page).toHaveURL(/\/admin\/bookings$|\/ops$/);
}

test.describe('admin auth', () => {
  test('valid login', async ({ browser, baseURL }) => {
    test.skip(!hasAdminCreds, 'Missing admin credentials');
    const ctx = await browser.newContext({ baseURL });
    const page = await ctx.newPage();
    await performAdminLogin(page);
    await expect(page).toHaveURL(/\/admin\/bookings$|\/ops$/);
    await ctx.close();
  });

  test('protected admin route redirects when unauthenticated', async ({ page }) => {
    await page.goto('/admin/bookings');
    const token = await page.evaluate(() => localStorage.getItem('adminToken'));
    if (token) {
      test.skip(true, 'This project is authenticated by storageState; unauth checks live in permissions suite.');
    }
    await expect(page).toHaveURL(/\/admin\/login$|\/ops$/);
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

  test('protected route access after login and refresh persistence', async ({ page }) => {
    test.skip(!hasAdminCreds, 'Missing admin credentials');
    await page.goto('/admin/bookings');
    await expect(page.getByRole('link', { name: /bookings/i })).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/\/admin\/bookings$/);
    await expect(page.getByRole('button', { name: /logout/i })).toBeVisible();
  });

  test('logout and redirect after logout', async ({ page }) => {
    test.skip(!hasAdminCreds, 'Missing admin credentials');
    await page.goto('/admin/bookings');
    await expect(page.getByRole('button', { name: /logout/i })).toBeVisible();
    await page.getByRole('button', { name: /logout/i }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.goto('/admin/bookings');
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test('session expiration behavior (best-effort token removal)', async ({ page }) => {
    test.skip(!hasAdminCreds, 'Missing admin credentials');
    await page.goto('/admin/bookings');
    await page.evaluate(() => {
      localStorage.removeItem('adminToken');
    });
    await page.goto('/admin/bookings');
    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});
