const { defineConfig, devices } = require('@playwright/test');
const { adminStorageStatePath, opsStorageStatePath } = require('./tests/e2e/helpers/storageState');

const baseURL = process.env.E2E_BASE_URL || 'https://driftdwells.com';

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 45_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
    actionTimeout: 12_000,
    navigationTimeout: 30_000
  },
  projects: [
    {
      name: 'setup-admin',
      testMatch: /.*auth\.admin\.setup\.js/
    },
    {
      name: 'setup-ops',
      testMatch: /.*auth\.ops\.setup\.js/
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 }
      },
      testIgnore: ['**/admin-auth/**', '**/ops/**', '**/permissions/operator-boundary.spec.js', '**/setup/**']
    },
    {
      name: 'chromium-admin-auth',
      testMatch: ['**/admin-auth/**/*.spec.js'],
      dependencies: ['setup-admin'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        storageState: adminStorageStatePath
      }
    },
    {
      name: 'chromium-ops',
      testMatch: ['**/ops/**/*.spec.js'],
      dependencies: ['setup-ops'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        storageState: opsStorageStatePath
      }
    },
    {
      name: 'chromium-permissions-operator',
      testMatch: ['**/permissions/operator-boundary.spec.js'],
      dependencies: ['setup-ops'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        storageState: opsStorageStatePath
      }
    },
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 7']
      },
      testIgnore: ['**/admin-auth/**', '**/ops/**', '**/permissions/**', '**/api/**', '**/setup/**']
    }
  ]
});
