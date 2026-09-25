const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PUBLIC_PACKAGE_QUERY,
  createPublicPackageService
} = require('../services/publicPackageService');

const plan = (overrides = {}) => ({
  code: 'christmas-2026',
  internalName: 'Christmas in The Valley 2026',
  version: 1,
  status: 'active',
  type: 'fixed_package',
  packageVisibility: 'public',
  packageType: 'holiday',
  currency: 'EUR',
  packageArrivalDate: '2026-12-24',
  packageDepartureDate: '2026-12-27',
  minNights: 3,
  inventoryMode: 'exclusive',
  paymentTermCode: 'full',
  paymentTermVersion: 1,
  cancellationPolicyCode: 'standard',
  cancellationPolicyVersion: 1,
  inclusions: ['Dinner'],
  accommodations: [
    {
      accommodationKey: 'a-frame',
      entityType: 'cabinType',
      pricingMethod: 'fixed_per_unit',
      fixedPerUnitAmount: 490
    },
    {
      accommodationKey: 'stone-house',
      entityType: 'cabin',
      pricingMethod: 'fixed_per_participant',
      adultPackageAmount: 180,
      childPackageAmount: 90,
      infantPackageAmount: 0
    }
  ],
  ...overrides
});

function serviceWith(rawPlans, quotePackage = async () => ({
  ok: true,
  totalPrice: 490,
  ratePlan: { currency: 'EUR' },
  checkInDate: '2026-12-24',
  checkOutDate: '2026-12-27',
  availableUnitCount: 1,
  packageSnapshot: { ratePlanCode: 'christmas-2026' }
})) {
  return createPublicPackageService({
    loadPlans: async () => rawPlans,
    loadPlan: async (slug) => rawPlans.find((item) => item.code === slug) || null,
    loadEntity: async (row) => ({ slug: row.accommodationKey, capacity: 8 }),
    quotePackage
  });
}

test('public package query restricts records to active fixed packages', () => {
  assert.deepEqual(PUBLIC_PACKAGE_QUERY.status, 'active');
  assert.deepEqual(PUBLIC_PACKAGE_QUERY.type, 'fixed_package');
});

test('list exposes sanitized active packages and fixed dates', async () => {
  const service = serviceWith([
    plan(),
    plan({ code: 'draft-package', status: 'draft' }),
    plan({ code: 'private-package', packageVisibility: 'private' }),
    plan({ code: 'retired-package', status: 'retired' })
  ]);
  const packages = await service.list();
  assert.equal(packages.length, 1);
  assert.equal(packages[0].slug, 'christmas-2026');
  assert.deepEqual(packages[0].dates, { checkIn: '2026-12-24', checkOut: '2026-12-27' });
  assert.equal(packages[0].pricing.fromAmount, 90);
  assert.equal(packages[0].accommodations[0].pricing.fromAmount, 490);
  assert.equal(packages[0].participantRequirements.required, true);
  assert.equal(packages[0]._id, undefined);
});

test('detail hides private packages and rejects missing packages', async () => {
  const service = serviceWith([plan({ packageVisibility: 'private' })]);
  assert.equal((await service.detail('christmas-2026')).code, 'PACKAGE_NOT_FOUND');
  assert.equal((await service.detail('missing')).code, 'PACKAGE_NOT_FOUND');
});

test('quote resolves server-owned identity and rejects client-owned dates and price', async () => {
  let received;
  const service = serviceWith([plan()], async (input) => {
    received = input;
    return {
      ok: true,
      totalPrice: 490,
      ratePlan: { currency: 'EUR' },
      checkInDate: '2026-12-24',
      checkOutDate: '2026-12-27',
      availableUnitCount: 1,
      packageSnapshot: { ratePlanCode: 'christmas-2026' }
    };
  });
  const invalid = await service.quote('christmas-2026', {
    accommodationKey: 'a-frame',
    checkIn: '2099-01-01',
    participants: []
  });
  assert.equal(invalid.code, 'INVALID_PACKAGE_INPUT');
  const result = await service.quote('christmas-2026', {
    accommodationKey: 'a-frame',
    participants: [{ fullName: 'A', dateOfBirth: '1990-01-01' }]
  });
  assert.equal(result.ok, true);
  assert.equal(received.code, 'christmas-2026');
  assert.equal(received.version, 1);
  assert.equal(received.checkIn, '2026-12-24');
  assert.equal(received.checkOut, '2026-12-27');
  assert.equal(received.totalPrice, undefined);
});

test('quote rejects an accommodation outside the package', async () => {
  const result = await serviceWith([plan()]).quote('christmas-2026', {
    accommodationKey: 'unknown',
    participants: []
  });
  assert.equal(result.code, 'INVALID_ACCOMMODATION');
});
