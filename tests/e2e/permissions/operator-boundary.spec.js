const { test, expect } = require('@playwright/test');
const { getOpsCreds } = require('../helpers/auth');

test.describe('operator role boundary', () => {
  test('operator cannot access admin-only routes', async ({ page }) => {
    const creds = getOpsCreds();
    test.skip(!creds.username || !creds.password, 'Missing ops credentials for operator boundary checks');

    await page.goto('/ops');
    await expect(page).toHaveURL(/\/ops$/);

    await page.goto('/admin/bookings');
    await expect(page).toHaveURL(/\/ops$/);
  });
});
