'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProductionEnv } = require('../config/validateProductionEnv');
const contract = require('../../shared/payments/productionPaymentContract.js');

function productionBase(overrides = {}) {
  return {
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb://user:supersecretpassword@127.0.0.1:27017/booking',
    ADMIN_USER: 'ops',
    ADMIN_PASS: 'pass-value',
    ADMIN_JWT_SECRET: '1234567890123456',
    CREATOR_PORTAL_SESSION_SECRET: '12345678901234567890123456789012',
    CORS_ORIGINS: 'https://booking.example.test',
    STRIPE_SECRET_KEY: 'sk_test_not_for_logs',
    STRIPE_WEBHOOK_SECRET: 'whsec_not_for_logs',
    ...overrides
  };
}

test('production startup rejects Checkout V2 when either finalize flag is absent or false', () => {
  const missingPersist = validateProductionEnv(
    productionBase({
      CHECKOUT_SESSION_V2: '1',
      FINALIZE_INTENT_REQUIRED_FOR_PI: '1'
    })
  );
  assert.equal(missingPersist.ok, false);
  assert.ok(missingPersist.errors.some((error) => error.includes('FINALIZE_INTENT_PERSIST is unset')));

  const disabledRequired = validateProductionEnv(
    productionBase({
      CHECKOUT_SESSION_V2: '1',
      FINALIZE_INTENT_PERSIST: '1',
      FINALIZE_INTENT_REQUIRED_FOR_PI: 'false'
    })
  );
  assert.equal(disabledRequired.ok, false);
  assert.ok(
    disabledRequired.errors.some((error) => error.includes('FINALIZE_INTENT_REQUIRED_FOR_PI is disabled'))
  );

  const bothMissing = validateProductionEnv(productionBase({ CHECKOUT_SESSION_V2: 'yes' }));
  assert.equal(bothMissing.errors.filter((error) => error.includes('FINALIZE_INTENT_')).length, 2);
  const joined = bothMissing.errors.join('\n');
  assert.equal(joined.includes('supersecretpassword'), false);
  assert.equal(joined.includes('sk_test_not_for_logs'), false);
  assert.equal(joined.includes('whsec_not_for_logs'), false);
});

test('non-production Checkout V2 without finalize flags stays valid', () => {
  for (const NODE_ENV of ['development', 'test']) {
    const result = validateProductionEnv({
      NODE_ENV,
      CHECKOUT_SESSION_V2: '1'
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  }
});

test('aligned production Checkout V2 configuration passes payment contract checks', () => {
  const result = validateProductionEnv(
    productionBase({
      CHECKOUT_SESSION_V2: '1',
      FINALIZE_INTENT_PERSIST: 'on',
      FINALIZE_INTENT_REQUIRED_FOR_PI: 'yes'
    })
  );
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('production without Checkout V2 does not require finalize flags', () => {
  const result = validateProductionEnv(productionBase({ CHECKOUT_SESSION_V2: '0' }));
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('manifest comparison fails on a capability mismatch and passes when aligned', () => {
  const manifest = contract.buildReleaseManifestContract(
    {
      VITE_CHECKOUT_SESSION_V2: '1',
      VITE_FINALIZE_INTENT_PERSIST: '1',
      VITE_FINALIZE_INTENT_REQUIRED_FOR_PI: '1',
      VITE_FRONTEND_RELEASE: 'frontend-2026-10-27',
      VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_public',
      APP_RELEASE: 'api-2026-10-27'
    },
    { applicationCommit: 'abc123' }
  );
  assert.equal(manifest.paymentContractVersion, contract.PRODUCTION_PAYMENT_CONTRACT_VERSION);
  assert.equal(manifest.checkoutSessionV2, true);
  assert.equal(manifest.finalizeIntentPersist, true);
  assert.equal(manifest.finalizeIntentRequiredForPi, true);
  assert.equal(manifest.frontendRelease, 'frontend-2026-10-27');
  assert.equal(manifest.applicationRelease, 'api-2026-10-27');

  const mismatch = contract.compareManifestToRuntime({
    manifest,
    health: { status: 'OK', applicationRelease: 'api-2026-10-27', frontendRelease: 'frontend-2026-10-27' },
    capabilities: {
      checkoutSessionV2: true,
      finalizeIntentPersist: false,
      finalizeIntentRequiredForPi: true,
      paymentContractVersion: manifest.paymentContractVersion,
      frontendReleaseHint: 'frontend-2026-10-27',
      applicationRelease: 'api-2026-10-27'
    }
  });
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.mismatches.some((item) => item.field === 'finalizeIntentPersist'));

  const aligned = contract.compareManifestToRuntime({
    manifest,
    health: { status: 'OK', applicationRelease: 'api-2026-10-27', frontendRelease: 'frontend-2026-10-27' },
    capabilities: {
      checkoutSessionV2: true,
      finalizeIntentPersist: true,
      finalizeIntentRequiredForPi: true,
      paymentContractVersion: manifest.paymentContractVersion,
      frontendReleaseHint: 'frontend-2026-10-27',
      applicationRelease: 'api-2026-10-27'
    }
  });
  assert.equal(aligned.ok, true);
});
