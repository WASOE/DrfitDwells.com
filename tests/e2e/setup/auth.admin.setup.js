const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { getAdminCreds } = require('../helpers/auth');
const { authDir, adminStorageStatePath } = require('../helpers/storageState');

test('authenticate as admin and store state', async ({ page }) => {
  const creds = getAdminCreds();

  fs.mkdirSync(authDir, { recursive: true });
  if (fs.existsSync(adminStorageStatePath)) {
    fs.unlinkSync(adminStorageStatePath);
  }

  if (!creds.username || !creds.password) {
    await page.context().storageState({ path: adminStorageStatePath });
    return;
  }

  await page.goto('/admin/login');
  await page.getByLabel(/username/i).fill(creds.username);
  await page.getByLabel(/password/i).fill(creds.password);
  await page.getByRole('button', { name: /sign in|signing in/i }).click();

  await expect(page).toHaveURL(/\/admin\/bookings$|\/ops$/);
  await page.context().storageState({ path: adminStorageStatePath });
  expect(fs.existsSync(adminStorageStatePath)).toBeTruthy();
});
