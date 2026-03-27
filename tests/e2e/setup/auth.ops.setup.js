const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { getOpsCreds } = require('../helpers/auth');
const { authDir, opsStorageStatePath } = require('../helpers/storageState');

test('authenticate as ops and store state', async ({ page }) => {
  const creds = getOpsCreds();

  fs.mkdirSync(authDir, { recursive: true });
  if (fs.existsSync(opsStorageStatePath)) {
    fs.unlinkSync(opsStorageStatePath);
  }

  if (!creds.username || !creds.password) {
    await page.context().storageState({ path: opsStorageStatePath });
    return;
  }

  await page.goto('/admin/login');
  await page.getByLabel(/username/i).fill(creds.username);
  await page.getByLabel(/password/i).fill(creds.password);
  await page.getByRole('button', { name: /sign in|signing in/i }).click();
  await expect(page).toHaveURL(/\/ops$|\/admin\/bookings$/);

  await page.context().storageState({ path: opsStorageStatePath });
  expect(fs.existsSync(opsStorageStatePath)).toBeTruthy();
});
