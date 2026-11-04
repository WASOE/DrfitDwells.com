/**
 * Ephemeral CI staging. The browser is hard-blocked from production and Stripe.
 * Payment initialization uses the loopback API only. Evidence stores a redacted
 * proof, never a client secret.
 */
const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const {
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CANCELLATION_POLICY_CODE,
  LEGAL_ACCEPTANCE_CANCELLATION_POLICY_VERSION,
  LEGAL_ACCEPTANCE_CANCELLATION_POLICY_URL,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_EN_APPROVED,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
} = require('../../../server/config/legalAcceptance');

const CHECK_IN = '2026-11-16';
const CHECK_OUT = '2026-11-18';
const BLOCKED = /https?:\/\/([^/]*\.)?(driftdwells\.com|stripe\.com)([:/]|$)/;

test.describe.configure({ mode: 'serial' });

function stagingBase() {
  const base = process.env.RELEASE_STAGING_BASE_URL;
  if (!base || process.env.RELEASE_STAGING_STRIPE_MODE !== 'test' || process.env.RELEASE_STAGING_ALLOW_PAYMENT_INIT !== '1') {
    throw new Error('BLOCK deployment: isolated staging URL, Stripe test mode, and payment-init approval are required.');
  }
  const host = new URL(base).hostname;
  if (host === 'driftdwells.com' || host === 'www.driftdwells.com' || host.endsWith('.stripe.com')) {
    throw new Error(`BLOCK deployment: refusing staging origin ${host}.`);
  }
  return base.replace(/\/$/, '');
}

function assertIsolated(url) {
  const host = new URL(url).hostname;
  if (host === 'driftdwells.com' || host === 'www.driftdwells.com' || host === 'stripe.com' || host.endsWith('.stripe.com')) {
    throw new Error(`Refusing request to ${host}.`);
  }
}

function redactClientSecret(secret) {
  if (typeof secret !== 'string' || !secret.startsWith('pi_') || !secret.includes('_secret_') || secret.length < 20) {
    throw new Error('PaymentIntent did not return a test-mode client secret.');
  }
  return { redacted: true, prefix: 'pi_', hasTestSecret: true, length: secret.length };
}

function guestPayload(checkoutId) {
  return {
    checkoutId,
    checkIn: CHECK_IN,
    checkOut: CHECK_OUT,
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'CI',
      lastName: 'Staging',
      email: 'gate@example.com',
      phone: '+359888000000'
    },
    legalAcceptance: {
      acceptedTermsAndCancellation: true,
      acceptedActivityRisk: true,
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      cancellationPolicyCode: LEGAL_ACCEPTANCE_CANCELLATION_POLICY_CODE,
      cancellationPolicyVersion: LEGAL_ACCEPTANCE_CANCELLATION_POLICY_VERSION,
      cancellationPolicyUrl: LEGAL_ACCEPTANCE_CANCELLATION_POLICY_URL,
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT_EN_APPROVED,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
      locale: 'en'
    }
  };
}

test.beforeEach(async ({ page }) => {
  await page.route(BLOCKED, (route) => route.abort('blockedbyclient'));
});

test('search, quote, finalize-intent, and test-mode payment initialization', async ({ page }) => {
  const base = stagingBase();
  const request = async (method, pathname, data) => {
    const url = `${base}${pathname}`;
    assertIsolated(url);
    const response = await page.request.fetch(url, {
      method,
      data: data ? JSON.stringify(data) : undefined,
      headers: data ? { 'content-type': 'application/json' } : undefined,
      failOnStatusCode: false
    });
    return { status: response.status(), body: await response.json() };
  };

  const health = await request('GET', '/api/health');
  expect(health.status).toBe(200);
  expect(health.body.stripeMode).toBe('test');
  expect(health.body.ciStaging).toMatchObject({
    isolated: true,
    databaseName: 'drift-dwells-ci-staging',
    mongoHost: '127.0.0.1',
    stripeApiHost: '127.0.0.1',
    emailsEnabled: false,
    schedulersEnabled: false,
    runId: process.env.GITHUB_RUN_ID || 'local'
  });

  const availability = await request('GET', `/api/availability?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}&adults=2&children=0`);
  expect(availability.status).toBe(200);
  expect(availability.body.success).toBe(true);
  const cabin = (availability.body.data?.cabins || []).find((row) => row.name === 'CI Staging Cabin' && row.available === true);
  expect(cabin, 'synthetic cabin must be available').toBeTruthy();
  const cabinId = String(cabin._id || cabin.id);

  const capabilities = await request('GET', '/api/bookings/checkout-capabilities');
  expect(capabilities.status).toBe(200);
  expect(capabilities.body).toMatchObject({
    checkoutSessionV2: true,
    finalizeIntentPersist: true,
    finalizeIntentRequiredForPi: true
  });
  const release = process.env.VITE_FRONTEND_RELEASE || process.env.GITHUB_SHA;
  if (release) expect(capabilities.body.frontendReleaseHint).toBe(release);

  const quoteBody = { cabinId, checkIn: CHECK_IN, checkOut: CHECK_OUT, adults: 2, children: 0 };
  const quote = await request('POST', '/api/bookings/quote', quoteBody);
  expect(quote.status).toBe(200);
  expect(quote.body.success).toBe(true);

  const checkoutId = crypto.randomUUID();
  const refused = await request('POST', '/api/bookings/create-payment-intent', { ...quoteBody, checkoutId });
  expect(refused.status).toBe(409);
  expect(refused.body.code).toBe('FINALIZE_INTENT_REQUIRED');
  expect(JSON.stringify(refused.body)).not.toContain('_secret_');

  const finalized = await request('PUT', `/api/bookings/checkout-sessions/${checkoutId}/finalize-intent`, {
    ...guestPayload(checkoutId),
    ...quoteBody
  });
  expect(finalized.status).toBe(200);
  expect(finalized.body.success).toBe(true);
  expect(finalized.body.finalizeIntentHash).toEqual(expect.any(String));
  expect(finalized.body.finalizeIntentHash.length).toBeGreaterThan(10);

  const payment = await request('POST', '/api/bookings/create-payment-intent', {
    ...quoteBody,
    ...guestPayload(checkoutId)
  });
  expect(payment.status).toBe(200);
  expect(payment.body.success).toBe(true);
  const redacted = redactClientSecret(payment.body.clientSecret || payment.body.data?.clientSecret);

  const voucherQuote = await request('POST', '/api/gift-vouchers/quote', {
    amountOriginalCents: 2500,
    currency: 'eur',
    deliveryOption: 'send_to_buyer'
  });
  expect(voucherQuote.status).toBe(200);
  expect(voucherQuote.body.success).toBe(true);

  const voucherPayment = await request('POST', '/api/gift-vouchers/create-payment-intent', {
    amountOriginalCents: 2500,
    currency: 'eur',
    deliveryOption: 'send_to_buyer',
    buyerName: 'CI Staging',
    buyerEmail: 'gate@example.com',
    recipientName: 'CI Staging',
    termsAccepted: true
  });
  expect(voucherPayment.status).toBe(200);
  expect(voucherPayment.body.success).toBe(true);
  redactClientSecret(voucherPayment.body.data?.clientSecret);

  const evidence = {
    sha: release,
    workflowRunId: process.env.GITHUB_RUN_ID || 'local',
    originHost: new URL(base).hostname,
    stripeMode: health.body.stripeMode,
    stripeApiHost: health.body.ciStaging.stripeApiHost,
    databaseName: health.body.ciStaging.databaseName,
    responses: [
      { step: 'quote', status: quote.status, success: quote.body.success === true },
      { step: 'finalize-intent', status: finalized.status, success: finalized.body.success === true, finalizeIntentHash: finalized.body.finalizeIntentHash },
      { step: 'create-payment-intent', status: payment.status, success: payment.body.success === true, clientSecret: redacted }
    ],
    checks: {
      availability: true,
      refusedPaymentBeforeFinalize: true,
      voucher: true,
      capabilities: true
    }
  };
  const serialized = JSON.stringify(evidence, null, 2);
  expect(serialized).not.toContain('_secret_');
  expect(serialized).not.toMatch(/sk_(test|live)_/);
  fs.writeFileSync(process.env.RELEASE_STAGING_EVIDENCE || 'staging-evidence.json', `${serialized}\n`);
});

test('checkout navigation stays on the isolated origin', async ({ page }) => {
  const base = stagingBase();
  const search = `${base}/search?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}&adults=2&children=0`;
  assertIsolated(search);
  await page.goto(search);
  await expect(page.getByText('CI Staging Cabin')).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/search(\?|$)/);
  expect(new URL(page.url()).hostname).not.toBe('driftdwells.com');

  await page.goto(`${base}/checkout?stay=1`);
  await page.reload();
  await expect(page).toHaveURL(/\/checkout(\?|$)/);

  await page.goto(`${base}/stays/ci-staging-cabin/confirm?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}&adults=2`);
  await expect(page).not.toHaveURL(/\/$/);
  await expect(page).toHaveURL(/\/stays\/ci-staging-cabin\/confirm/);

  await page.goto(`${base}/gift-vouchers`);
  await expect(page).toHaveURL(/\/gift-vouchers\/?(?:\?|$)/);
  expect(new URL(page.url()).hostname).not.toBe('driftdwells.com');
});
