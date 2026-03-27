const { test, expect } = require('@playwright/test');

test.describe('permissions and security sanity', () => {
  test('protected pages are blocked without authentication', async ({ page }) => {
    await page.goto('/ops');
    await expect(page).toHaveURL(/\/admin\/login$/);

    await page.goto('/admin/bookings');
    await expect(page).toHaveURL(/\/admin\/login$/);

    await page.goto('/maintenance');
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test('protected API denies missing token', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/api/ops/dashboard`);
    expect(res.status()).toBe(401);
  });
});
