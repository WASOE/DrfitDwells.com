const { test, expect } = require('@playwright/test');

test.describe('public site', () => {
  test('homepage loads with key nav links', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Drift & Dwells/i);

    await expect(page.getByRole('link', { name: /home/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /cabin/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /valley/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /about/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /build/i }).first()).toBeVisible();
  });

  test('key listing pages render images and content', async ({ page }) => {
    await page.goto('/cabin');
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(page.locator('img').first()).toBeVisible();

    await page.goto('/valley');
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(page.locator('img').first()).toBeVisible();
  });

  test('booking button opens booking flow entrypoint', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-chromium', 'Desktop booking CTA assertion');
    await page.goto('/');
    const bookBtn = page.getByRole('button', { name: /^book$/i }).first();
    await bookBtn.click();
    await expect(page.getByRole('heading', { name: /plan your stay/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /search/i }).first()).toBeVisible();
  });

  test('mobile viewport can open menu and booking modal', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile-only sanity check');
    await page.goto('/');
    await page.getByRole('button', { name: /toggle menu/i }).click();
    await expect(page.getByRole('link', { name: /cabin/i }).first()).toBeVisible();
    await page.getByRole('button', { name: /^search$/i }).first().click();
    await expect(page.getByRole('heading', { name: /plan your stay/i })).toBeVisible();
  });
});
