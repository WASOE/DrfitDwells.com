/**
 * ISOLATED STAGING integration. This is the only suite allowed to exercise
 * quote, finalize-intent, and Stripe test-mode initialization, and only
 * against a non-production origin whose server reports Stripe test mode.
 *
 * A request being attempted is not a pass. Each response must be HTTP 200
 * with success:true, in the order quote → finalize-intent → create-payment-intent.
 * Missing configuration fails closed. This suite is not mocked coverage.
 */
const fs = require('node:fs');
const path = require('node:path');
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
  if (process.env.RELEASE_STAGING_ALLOW_PAYMENT_INIT !== '1') {
    throw new Error('BLOCK deployment: RELEASE_STAGING_ALLOW_PAYMENT_INIT=1 is required for test-mode payment initialization.');
  }
  return { base, host };
}

function stepOf(url) {
  if (url.includes('/bookings/quote')) return 'quote';
  if (url.includes('/finalize-intent')) return 'finalize-intent';
  if (url.includes('/create-payment-intent')) return 'create-payment-intent';
  return null;
}

function firstOrder(rows) {
  const order = [];
  for (const row of rows) {
    if (!order.includes(row.step)) order.push(row.step);
  }
  return order;
}

test('staging search and checkout stay off the homepage and off production', async ({ page }) => {
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

test('staging quote, finalize-intent, and test payment succeed in order', async ({ page }) => {
  const { host } = requireStaging();
  const sha = process.env.GITHUB_SHA || process.env.VITE_FRONTEND_RELEASE;
  const runId = process.env.GITHUB_RUN_ID;
  if (!sha || !runId) {
    throw new Error('BLOCK deployment: staging evidence requires GITHUB_SHA and GITHUB_RUN_ID.');
  }

  const health = await page.request.get('/api/health');
  expect(health.status()).toBe(200);
  const healthBody = await health.json();
  expect(healthBody.stripeMode).toBe('test');

  const records = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname === 'driftdwells.com' || url.hostname === 'www.driftdwells.com') {
      throw new Error(`Refusing production call: ${request.url()}`);
    }
    if (url.pathname.includes('payment_intents/confirm') || url.pathname.includes('/confirm')) {
      if (url.hostname.includes('stripe.com')) {
        throw new Error(`Refusing Stripe charge confirmation: ${request.url()}`);
      }
    }
  });
  page.on('response', (response) => {
    const step = stepOf(response.url());
    if (!step) return;
    records.push(response.json().then((body) => ({
      step,
      status: response.status(),
      success: body?.success === true,
      finalizeIntentHash: body?.finalizeIntentHash || null,
      clientSecret: typeof body?.clientSecret === 'string' ? body.clientSecret : null
    })).catch(() => ({
      step,
      status: response.status(),
      success: false,
      finalizeIntentHash: null,
      clientSecret: null
    })));
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

  await expect.poll(async () => firstOrder(await Promise.all(records)).join(',')).toBe(
    'quote,finalize-intent,create-payment-intent'
  );
  const settled = await Promise.all(records);
  for (const step of ['quote', 'finalize-intent', 'create-payment-intent']) {
    const row = settled.find((item) => item.step === step);
    expect(row.status, step).toBe(200);
    expect(row.success, step).toBe(true);
  }
  expect(settled.find((item) => item.step === 'finalize-intent').finalizeIntentHash).toBeTruthy();
  const secret = settled.find((item) => item.step === 'create-payment-intent').clientSecret;
  expect(secret).toMatch(/^pi_.*_secret_/);

  const evidence = {
    sha,
    workflowRunId: String(runId),
    originHost: host,
    stripeMode: healthBody.stripeMode,
    responses: ['quote', 'finalize-intent', 'create-payment-intent'].map((step) => {
      const row = settled.find((item) => item.step === step);
      return {
        step,
        status: row.status,
        success: row.success,
        ...(row.finalizeIntentHash ? { finalizeIntentHash: row.finalizeIntentHash } : {}),
        ...(row.clientSecret ? { clientSecret: row.clientSecret } : {})
      };
    })
  };
  const evidencePath = process.env.RELEASE_STAGING_EVIDENCE
    || path.join(process.cwd(), 'staging-evidence.json');
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence)}\n`);
});
