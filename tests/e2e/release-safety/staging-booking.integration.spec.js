/**
 * ISOLATED STAGING integration. This is the only suite allowed to exercise
 * quote / finalize-intent / Stripe test-mode initialization, and only against
 * a non-production origin whose Stripe mode is test.
 *
 * Missing configuration fails closed. It is not mocked coverage.
 */
const { test, expect } = require('@playwright/test');

function requireStaging() {
  const base = process.env.RELEASE_STAGING_BASE_URL;
  if (!base || process.env.RELEASE_STAGING_STRIPE_MODE !== 'test') {
    throw new Error('BLOCK deployment: isolated staging URL and RELEASE_STAGING_STRIPE_MODE=test are required.');
  }
  const host = new URL(base).hostname;
  if (host === 'driftdwells.com' || host === 'www.driftdwells.com') {
    throw new Error('BLOCK deployment: staging URL points at production.');
  }
  return base;
}

test('staging search and checkout entry stay off the homepage', async ({ page }) => {
  requireStaging();
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (host === 'driftdwells.com' || host === 'www.driftdwells.com') {
      throw new Error(`Staging test called production: ${request.url()}`);
    }
  });
  await page.goto('/search?checkIn=2026-11-16&checkOut=2026-11-18&adults=2&children=0');
  await expect(page.getByRole('heading', { name: /browse stays/i })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/search/);
  await page.goto('/checkout?checkIn=2026-11-16&checkOut=2026-11-18&adults=2');
  await page.reload();
  expect(new URL(page.url()).pathname).toBe('/checkout');
});

test('staging finalize-intent uses Stripe test mode and does not confirm a charge', async ({ page }) => {
  requireStaging();
  if (process.env.RELEASE_STAGING_ALLOW_PAYMENT_INIT !== '1') {
    throw new Error('BLOCK deployment: RELEASE_STAGING_ALLOW_PAYMENT_INIT=1 is required for test-mode payment initialization.');
  }
  const paymentCalls = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname === 'driftdwells.com' || url.hostname === 'www.driftdwells.com') {
      throw new Error(`Refusing production payment call: ${request.url()}`);
    }
    if (url.pathname.includes('create-payment-intent') || url.pathname.includes('finalize-intent')) {
      paymentCalls.push(`${request.method()} ${url.pathname}`);
    }
  });
  await page.goto('/stays/the-cabin/confirm?checkIn=2026-11-16&checkOut=2026-11-18&adults=2');
  await page.fill('#confirm-first-name', 'Gate');
  await page.fill('#confirm-last-name', 'Staging');
  await page.fill('#confirm-email', 'gate@example.test');
  await page.fill('#confirm-phone', '+359888000000');
  const terms = page.locator('input[type="checkbox"]');
  const count = await terms.count();
  for (let index = 0; index < count; index += 1) {
    await terms.nth(index).check();
  }
  await page.getByRole('button', { name: /confirm and pay/i }).click();
  await expect.poll(() => paymentCalls.join('\n')).toContain('finalize-intent');
  expect(paymentCalls.join('\n')).toContain('create-payment-intent');
  expect(paymentCalls.join('\n')).not.toContain('payment_intents/confirm');
});
