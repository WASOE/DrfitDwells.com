const { test, expect } = require('@playwright/test');

test.describe('smoke', () => {
  test('@smoke public homepage and auth entrypoints load', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Drift & Dwells/i);
    await expect(page.getByRole('link', { name: /drift & dwells/i }).first()).toBeVisible();

    await page.goto('/ops');
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.getByRole('heading', { name: /admin login/i })).toBeVisible();

    await page.goto('/admin/login');
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });
});
