const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SMOKE_PURCHASE_REQUEST_PREFIX,
  VOUCHER_VALUE_CENTS,
  PHYSICAL_FEE_CENTS,
  parseBaseUrl,
  buildSmokePurchaseRequestId,
  isTheCabinListing,
  isAFrameListing,
  smokeBuyerIdentity
} = require('./smokePaymentsInit.cjs');

test('parseBaseUrl defaults to localhost', () => {
  const prev = process.env.SMOKE_BASE_URL;
  delete process.env.SMOKE_BASE_URL;
  assert.equal(parseBaseUrl(), 'http://localhost:5000');
  if (prev) process.env.SMOKE_BASE_URL = prev;
});

test('buildSmokePurchaseRequestId uses gvr_smoke_ prefix', () => {
  const id = buildSmokePurchaseRequestId('run123', 'email checkout');
  assert.match(id, new RegExp(`^${SMOKE_PURCHASE_REQUEST_PREFIX}run123_email_checkout$`));
});

test('isTheCabinListing matches available single cabin only', () => {
  assert.equal(isTheCabinListing({ name: 'The Cabin', available: true }), true);
  assert.equal(isTheCabinListing({ name: 'The Cabin', available: false }), false);
  assert.equal(isTheCabinListing({ name: 'The Cabin', available: true, inventoryMode: 'multi' }), false);
});

test('isAFrameListing matches available multi-unit a-frame', () => {
  assert.equal(
    isAFrameListing({ name: 'A-Frame', slug: 'a-frame', available: true, inventoryMode: 'multi' }),
    true
  );
  assert.equal(isAFrameListing({ name: 'Stone House', available: true }), false);
});

test('smokeBuyerIdentity marks synthetic records', () => {
  const identity = smokeBuyerIdentity('abc');
  assert.match(identity.buyerEmail, /smoke-payments\+abc@example\.com/);
  assert.match(identity.buyerName, /SMOKE PAYMENTS/);
});

test('constants match €50 voucher and €5 postal fee', () => {
  assert.equal(VOUCHER_VALUE_CENTS, 5000);
  assert.equal(PHYSICAL_FEE_CENTS, 500);
});
