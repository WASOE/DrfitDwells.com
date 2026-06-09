'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const CleaningPricingPolicy = require('../models/CleaningPricingPolicy');
const {
  ACTIONS,
  evaluatePermission,
  ROLE_ADMIN,
  ROLE_OPERATOR,
  ROLE_CLEANER
} = require('../services/permissionService');
const { resolveModulesForRole } = require('../services/ops/opsModuleRegistry');
const {
  getPricingPolicySettings,
  updatePricingPolicyRules,
  validateRules,
  policyRuleToDto,
  rulesToStoredPolicyRules,
  slugifyRuleKey
} = require('../services/ops/cleaning/cleaningPricingPolicyAdminService');
const { priceDay } = require('../services/ops/cleaning/cleaningPricingService');
const {
  defaultRulesForPropertyKind,
  VALLEY_PAYOUT_RULES
} = require('../data/cleaning/defaultCleaningPricingPolicy');
const {
  getCleaningInventoryTags,
  updateCabinCleaningTags,
  updateCabinTypeCleaningTags
} = require('../services/ops/cleaning/cleaningInventoryTagsService');

let mongoServer;

function normalizeRuleForCompare(rule) {
  return {
    ruleKey: rule.ruleKey,
    type: rule.type,
    label: rule.label,
    enabled: rule.enabled !== false,
    amountType: rule.amountType || 'cleaner_payout',
    amountEUR: rule.amountEUR ?? null,
    requiresCheckouts: Boolean(rule.requiresCheckouts),
    selector: { cleaningTags: [...(rule.selector?.cleaningTags || [])].sort() },
    tiers: (rule.tiers || []).map((tier) => ({ amountEUR: tier.amountEUR }))
  };
}

function normalizeRulesForCompare(rules) {
  return rules.map(normalizeRuleForCompare).sort((a, b) => a.ruleKey.localeCompare(b.ruleKey));
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await CleaningPricingPolicy.deleteMany({});
  await Cabin.deleteMany({});
  await CabinType.deleteMany({});
  await Unit.deleteMany({});
});

test('GET pricing-policy returns checkout-linked default rules per location', async () => {
  const data = await getPricingPolicySettings();

  assert.equal(data.currency, 'EUR');
  assert.deepEqual(data.vocabulary, ['a-frame', 'lux-cabin', 'stone-house']);
  assert.equal(data.cabin.mode, 'needs_activation');
  assert.equal(data.cabin.rules.length, 2);
  assert.equal(data.valley.rules.length, 5);
  assert.ok(data.valley.rules.some((r) => r.type === 'tiered_per_event'));
});

test('PUT creates active policy with real rule shape', async () => {
  const rules = defaultRulesForPropertyKind('cabin').map(policyRuleToDto);
  const data = await updatePricingPolicyRules({ propertyKind: 'cabin', rules });

  assert.equal(data.cabin.mode, 'policy');
  assert.ok(data.cabin.policyId);
  assert.equal(data.cabin.rules.length, 2);

  const stored = await CleaningPricingPolicy.findById(data.cabin.policyId).lean();
  assert.equal(stored.rules[0].type, 'daily_fixed');
  assert.equal(stored.rules[1].type, 'per_event_fixed');
});

test('tiered + per-event + gated daily rules round-trip losslessly', async () => {
  const inputRules = [
    {
      ruleKey: 'transport',
      label: 'Transport',
      type: 'daily_fixed',
      enabled: true,
      amountType: 'cleaner_payout',
      amountEUR: 8,
      requiresCheckouts: true,
      selector: { cleaningTags: [] },
      tiers: []
    },
    {
      ruleKey: 'aframe_clean',
      label: 'A-frame cleaning',
      type: 'tiered_per_event',
      enabled: true,
      amountType: 'cleaner_payout',
      amountEUR: null,
      requiresCheckouts: false,
      selector: { cleaningTags: ['a-frame'] },
      tiers: [{ amountEUR: 20 }, { amountEUR: 10 }]
    },
    {
      ruleKey: 'lux_cabin',
      label: 'Lux cabin',
      type: 'per_event_fixed',
      enabled: true,
      amountType: 'cleaner_payout',
      amountEUR: 25,
      requiresCheckouts: false,
      selector: { cleaningTags: ['lux-cabin'] },
      tiers: []
    }
  ];

  await updatePricingPolicyRules({ propertyKind: 'valley', rules: inputRules });
  const reloaded = await getPricingPolicySettings();

  assert.deepEqual(
    normalizeRulesForCompare(reloaded.valley.rules),
    normalizeRulesForCompare(inputRules)
  );
});

test('saved valley policy prices €81 day via priceDay', async () => {
  const rules = defaultRulesForPropertyKind('valley').map(policyRuleToDto);
  await updatePricingPolicyRules({ propertyKind: 'valley', rules });

  const policy = await CleaningPricingPolicy.findOne({ propertyKind: 'valley', isActive: true }).lean();
  const checkouts = [
    { bookingId: 'b1', cabinName: 'AF-01', propertyKind: 'valley', cleaningTags: ['a-frame'] },
    { bookingId: 'b2', cabinName: 'AF-02', propertyKind: 'valley', cleaningTags: ['a-frame'] },
    { bookingId: 'b3', cabinName: 'AF-03', propertyKind: 'valley', cleaningTags: ['a-frame'] },
    { bookingId: 'b4', cabinName: 'Lux', propertyKind: 'valley', cleaningTags: ['lux-cabin'] }
  ];

  const priced = priceDay(checkouts, { propertyKind: 'valley', rules: policy.rules });
  assert.equal(priced.totalAmountEUR, 81);
});

test('seed rules and editor save produce structurally identical valley policy', async () => {
  const seedDto = defaultRulesForPropertyKind('valley').map(policyRuleToDto);
  await updatePricingPolicyRules({ propertyKind: 'valley', rules: seedDto });

  const stored = await CleaningPricingPolicy.findOne({ propertyKind: 'valley' }).lean();
  const storedDto = stored.rules.map(policyRuleToDto);
  const seedNormalized = normalizeRulesForCompare(
    VALLEY_PAYOUT_RULES.map((rule) => policyRuleToDto(rule))
  );
  const storedNormalized = normalizeRulesForCompare(storedDto);

  assert.deepEqual(storedNormalized, seedNormalized);
});

test('validation rejects tiered rule without selector tags', () => {
  assert.throws(
    () =>
      validateRules([
        {
          ruleKey: 'bad',
          label: 'Bad tiered',
          type: 'tiered_per_event',
          enabled: true,
          selector: { cleaningTags: [] },
          tiers: [{ amountEUR: 20 }, { amountEUR: 10 }]
        }
      ]),
    /at least one selector tag/i
  );
});

test('validation rejects off-vocabulary selector tags', () => {
  assert.throws(
    () =>
      validateRules([
        {
          ruleKey: 'bad',
          label: 'Bad tag',
          type: 'per_event_fixed',
          enabled: true,
          amountEUR: 10,
          selector: { cleaningTags: ['mystery-tag'] },
          tiers: []
        }
      ]),
    /unknown tags/i
  );
});

test('validation rejects requiresCheckouts on non-daily rules', () => {
  assert.throws(
    () =>
      validateRules([
        {
          ruleKey: 'bad',
          label: 'Bad gate',
          type: 'per_event_fixed',
          enabled: true,
          amountEUR: 10,
          requiresCheckouts: true,
          selector: { cleaningTags: [] },
          tiers: []
        }
      ]),
    /requiresCheckouts is only valid for daily_fixed/i
  );
});

test('inventory tag write/read and inheritance on cabinId booking', async () => {
  const cabin = await Cabin.create({
    name: 'Stone House',
    description: 'test',
    location: 'The Valley',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/cabin.jpg',
    propertyKind: 'valley'
  });

  const updated = await updateCabinCleaningTags(cabin._id, ['stone-house', 'invalid-tag']);
  assert.deepEqual(updated.cleaningTags, ['stone-house']);

  const listing = await getCleaningInventoryTags({ propertyKind: 'valley' });
  assert.ok(listing.inventory.some((row) => row.id === String(cabin._id)));
  assert.equal(listing.untaggedValleyCount, 0);

  const { getCleaningSchedule } = require('../services/ops/readModels/cleaningReadModel');
  const Booking = require('../models/Booking');
  const crypto = require('crypto');
  const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');
  const day = normalizeDateToSofiaDayStart('2026-09-15');
  await Booking.create({
    checkIn: new Date(day.getTime() - 86400000),
    checkOut: new Date(day.getTime() + 43200000),
    adults: 2,
    children: 0,
    cabinId: cabin._id,
    guestInfo: {
      firstName: 'Tag',
      lastName: 'Test',
      email: `tag.${crypto.randomBytes(4).toString('hex')}@example.com`,
      phone: '+359881234567'
    },
    status: 'confirmed',
    totalPrice: 200,
    subtotalPrice: 200,
    discountAmount: 0,
    totalValueCents: 20000,
    giftVoucherAppliedCents: 0,
    stripePaidAmountCents: 20000,
    stripePaymentIntentId: `pi_${crypto.randomBytes(6).toString('hex')}`
  });

  const schedule = await getCleaningSchedule({ date: day, propertyKind: 'valley' });
  assert.equal(schedule.checkouts[0].cleaningTags[0], 'stone-house');
});

test('untagged valley cabin is flagged in inventory listing', async () => {
  await Cabin.create({
    name: 'Untagged Valley Unit',
    description: 'test',
    location: 'The Valley',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/cabin.jpg',
    propertyKind: 'valley',
    cleaningTags: []
  });

  const listing = await getCleaningInventoryTags({ propertyKind: 'valley' });
  assert.equal(listing.untaggedValleyCount, 1);
  assert.ok(listing.untaggedValley.some((row) => row.name === 'Untagged Valley Unit'));
});

test('cabin type tags can be updated', async () => {
  const cabinType = await CabinType.create({
    name: 'A-frames',
    slug: 'a-frames-test',
    description: 'test',
    location: 'The Valley',
    capacity: 4,
    pricePerNight: 120,
    imageUrl: 'https://example.com/type.jpg',
    propertyKind: 'valley'
  });
  await Unit.create({
    cabinTypeId: cabinType._id,
    unitNumber: 'AF-01',
    displayName: 'AF-01',
    isActive: true
  });

  const updated = await updateCabinTypeCleaningTags(cabinType._id, ['a-frame']);
  assert.deepEqual(updated.cleaningTags, ['a-frame']);
});

test('slugifyRuleKey produces stable keys', () => {
  assert.equal(slugifyRuleKey('Fuel / transport per visit'), 'fuel_transport_per_visit');
});

test('permissions: admin can write settings, operator and cleaner cannot', () => {
  const operatorModules = resolveModulesForRole(ROLE_OPERATOR);
  const cleanerModules = resolveModulesForRole(ROLE_CLEANER);

  assert.equal(
    evaluatePermission({
      role: ROLE_ADMIN,
      modules: resolveModulesForRole(ROLE_ADMIN),
      action: ACTIONS.OPS_CLEANING_SETTINGS_WRITE
    }).allowed,
    true
  );
  assert.equal(
    evaluatePermission({
      role: ROLE_OPERATOR,
      modules: operatorModules,
      action: ACTIONS.OPS_CLEANING_SETTINGS_WRITE
    }).allowed,
    false
  );
  assert.equal(
    evaluatePermission({
      role: ROLE_CLEANER,
      modules: cleanerModules,
      action: ACTIONS.OPS_CLEANING_SETTINGS_WRITE
    }).allowed,
    false
  );
});

test('rulesToStoredPolicyRules never produces optional_addon or quantity types', () => {
  const stored = rulesToStoredPolicyRules(
    defaultRulesForPropertyKind('valley').map(policyRuleToDto)
  );
  assert.ok(stored.every((rule) => ['daily_fixed', 'per_event_fixed', 'tiered_per_event'].includes(rule.type)));
  assert.ok(stored.every((rule) => rule.type !== 'optional_addon'));
  assert.ok(stored.every((rule) => rule.type !== 'quantity'));
});
