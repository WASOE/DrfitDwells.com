const { defineConfig, devices } = require('@playwright/test');
const { adminStorageStatePath, opsStorageStatePath } = require('./tests/e2e/helpers/storageState');

const baseURL = process.env.E2E_BASE_URL || 'https://driftdwells.com';

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.RELEASE_BROWSER_JSON
    ? [['list'], ['json', { outputFile: process.env.RELEASE_BROWSER_JSON }]]
    : [['list'], ['html', { open: 'never' }]],
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
      testIgnore: ['**/admin-auth/**', '**/ops/**', '**/permissions/operator-boundary.spec.js', '**/setup/**', '**/release-safety/**']
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
      testIgnore: ['**/admin-auth/**', '**/ops/**', '**/permissions/**', '**/api/**', '**/setup/**', '**/attribution/**', '**/release-safety/**']
    },
    {
      name: 'release-safety',
      testMatch: ['**/release-safety/booking-protection.spec.js'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        baseURL: process.env.RELEASE_GATE_BASE_URL,
        ignoreHTTPSErrors: true
      }
    },
    {
      name: 'release-safety-mobile',
      testMatch: ['**/release-safety/booking-protection.spec.js'],
      use: {
        ...devices['Pixel 7'],
        baseURL: process.env.RELEASE_GATE_BASE_URL,
        ignoreHTTPSErrors: true
      }
    },
    {
      name: 'release-safety-staging',
      testMatch: ['**/release-safety/staging-booking.integration.spec.js'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        baseURL: process.env.RELEASE_STAGING_BASE_URL,
        ignoreHTTPSErrors: true
      }
    }
  ]
});
