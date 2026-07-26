'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const SavedBookingQuote = require('../models/SavedBookingQuote');
const BookingFunnelEvent = require('../models/BookingFunnelEvent');

const {
  upsertSavedQuoteFromSuccessfulQuote,
  linkSavedQuoteToCheckout,
  markSavedQuoteConverted,
  scheduleSavedQuoteTask
} = require('../services/savedQuotes/savedQuoteService');
const { evaluateRecoveryEligibility } = require('../services/savedQuotes/recoveryEligibilityService');
const {
  listRecoveryQuotes,
  mapRecoveryListRow,
  aggregateRecoverySupplementaryCounts
} = require('../services/ops/readModels/recoveryReadModel');
const { aggregateConversionSummary } = require('../services/conversion/conversionSummaryService');
const { buildInclusiveDateRange } = require('../services/ops/reporting/reportingFilters');

let mongoServer;

async function createCabin(overrides = {}) {
  return Cabin.create({
    name: overrides.name || `Cabin ${new mongoose.Types.ObjectId()}`,
    description: 'd',
    location: 'Bachevo',
    capacity: 2,
    pricePerNight: 100,
    minNights: 2,
    propertyKind: overrides.propertyKind || 'cabin',
    imageUrl: 'https://example.com/cabin.jpg',
    ...overrides
  });
}

function quoteResultForCabin(cabin, { checkIn, checkOut, totalPrice = 200 } = {}) {
  return {
    ok: true,
    entityType: 'cabin',
    entity: cabin,
    checkInDate: checkIn || new Date('2026-09-01T00:00:00.000Z'),
    checkOutDate: checkOut || new Date('2026-09-03T00:00:00.000Z'),
    baseLodgingPrice: totalPrice,
    subtotalPrice: totalPrice,
    discountAmount: 0,
    totalPrice,
    extrasTotal: 0,
    appliedPromoCode: null,
    promo: { applied: false, snapshot: null },
    voucherAppliedCents: 0,
    remainingDueCents: Math.round(totalPrice * 100)
  };
}

function quoteReq(body = {}) {
  return {
    body: {
      adults: 2,
      children: 0,
      funnelSessionKey: 'sess-a',
      funnelVisitorKey: 'vis-a',
      ...body
    }
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await SavedBookingQuote.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    Cabin.deleteMany({}),
    CabinType.deleteMany({}),
    SavedBookingQuote.deleteMany({}),
    BookingFunnelEvent.deleteMany({})
  ]);
});

test('successful quote creates a saved quote', async () => {
  const cabin = await createCabin();
  const result = await upsertSavedQuoteFromSuccessfulQuote({
    req: quoteReq({ cabinId: String(cabin._id) }),
    result: quoteResultForCabin(cabin)
  });
  assert.equal(result.skipped, false);
  assert.ok(result.savedQuoteId);
  const docs = await SavedBookingQuote.find({}).lean();
  assert.equal(docs.length, 1);
  assert.equal(docs[0].status, 'quoted');
  assert.equal(docs[0].propertyKind, 'cabin');
  assert.equal(docs[0].quotedTotalCents, 20000);
  assert.equal(docs[0].pricingSnapshot.baseCents, 20000);
});

test('identical repeated quote dedupes by fingerprint', async () => {
  const cabin = await createCabin();
  const req = quoteReq({ cabinId: String(cabin._id) });
  const quote = quoteResultForCabin(cabin);
  const first = await upsertSavedQuoteFromSuccessfulQuote({ req, result: quote });
  const second = await upsertSavedQuoteFromSuccessfulQuote({ req, result: quote });
  assert.equal(first.savedQuoteId, second.savedQuoteId);
  assert.equal(await SavedBookingQuote.countDocuments({}), 1);
});

test('different stay dates create a different quote', async () => {
  const cabin = await createCabin();
  const req = quoteReq({ cabinId: String(cabin._id) });
  await upsertSavedQuoteFromSuccessfulQuote({
    req,
    result: quoteResultForCabin(cabin, {
      checkIn: new Date('2026-09-01T00:00:00.000Z'),
      checkOut: new Date('2026-09-03T00:00:00.000Z')
    })
  });
  await upsertSavedQuoteFromSuccessfulQuote({
    req,
    result: quoteResultForCabin(cabin, {
      checkIn: new Date('2026-10-01T00:00:00.000Z'),
      checkOut: new Date('2026-10-03T00:00:00.000Z')
    })
  });
  assert.equal(await SavedBookingQuote.countDocuments({}), 2);
});

test('different visitor identity does not dedupe incorrectly', async () => {
  const cabin = await createCabin();
  const quote = quoteResultForCabin(cabin);
  await upsertSavedQuoteFromSuccessfulQuote({
    req: quoteReq({ funnelSessionKey: 'sess-1', funnelVisitorKey: 'vis-1' }),
    result: quote
  });
  await upsertSavedQuoteFromSuccessfulQuote({
    req: quoteReq({ funnelSessionKey: 'sess-2', funnelVisitorKey: 'vis-2' }),
    result: quote
  });
  assert.equal(await SavedBookingQuote.countDocuments({}), 2);
});

test('checkout links to the saved quote', async () => {
  const cabin = await createCabin();
  const upsert = await upsertSavedQuoteFromSuccessfulQuote({
    req: quoteReq({ cabinId: String(cabin._id) }),
    result: quoteResultForCabin(cabin)
  });
  const linked = await linkSavedQuoteToCheckout({
    checkoutId: 'cko_test_1',
    checkoutSessionId: new mongoose.Types.ObjectId(),
    sessionKey: 'sess-a',
    cabinId: cabin._id,
    checkInDateOnly: '2026-09-01',
    checkOutDateOnly: '2026-09-03',
    adults: 2,
    children: 0,
    quotedTotalCents: 20000,
    guestEmail: 'guest@driftdwells.test'
  });
  assert.equal(linked.skipped, false);
  assert.equal(linked.savedQuoteId, upsert.savedQuoteId);
  const doc = await SavedBookingQuote.findById(upsert.savedQuoteId).lean();
  assert.equal(doc.status, 'checkout_started');
  assert.equal(doc.checkoutId, 'cko_test_1');
  assert.equal(doc.emailNormalized, 'guest@driftdwells.test');
});

test('conversion links booking and suppresses recovery', async () => {
  const cabin = await createCabin();
  const upsert = await upsertSavedQuoteFromSuccessfulQuote({
    req: quoteReq({ cabinId: String(cabin._id) }),
    result: quoteResultForCabin(cabin)
  });
  await linkSavedQuoteToCheckout({
    checkoutId: 'cko_conv',
    sessionKey: 'sess-a',
    cabinId: cabin._id,
    checkInDateOnly: '2026-09-01',
    checkOutDateOnly: '2026-09-03',
    quotedTotalCents: 20000,
    guestEmail: 'guest@driftdwells.test'
  });
  const bookingId = new mongoose.Types.ObjectId();
  const converted = await markSavedQuoteConverted({
    bookingId,
    checkoutId: 'cko_conv',
    guestEmail: 'guest@driftdwells.test'
  });
  assert.equal(converted.skipped, false);
  const doc = await SavedBookingQuote.findById(upsert.savedQuoteId).lean();
  assert.equal(doc.status, 'converted');
  assert.equal(String(doc.bookingId), String(bookingId));
  assert.equal(doc.recoveryState.suppressionReason, 'converted');
  const eligibility = await evaluateRecoveryEligibility(doc);
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, 'already_converted');
});

test('saved quote persistence failure does not block quoting via schedule', async () => {
  let rejected = false;
  scheduleSavedQuoteTask('test-fail', async () => {
    throw new Error('simulated persistence failure');
  });
  // Schedule must not throw to caller.
  assert.equal(rejected, false);
  await new Promise((r) => setTimeout(r, 30));
});

test('recovery eligibility rejects missing email', async () => {
  const result = await evaluateRecoveryEligibility({
    quotedTotalCents: 10000,
    expiresAt: new Date(Date.now() + 60_000),
    status: 'quoted',
    marketingConsent: true
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'missing_email');
});

test('recovery eligibility rejects missing consent basis', async () => {
  const result = await evaluateRecoveryEligibility({
    quotedTotalCents: 10000,
    expiresAt: new Date(Date.now() + 60_000),
    status: 'quoted',
    email: 'guest@example.com',
    marketingConsent: false,
    transactionalContinuationEligible: false
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'no_valid_consent');
});

test('recovery eligibility rejects converted records', async () => {
  const result = await evaluateRecoveryEligibility({
    quotedTotalCents: 10000,
    expiresAt: new Date(Date.now() + 60_000),
    status: 'converted',
    bookingId: new mongoose.Types.ObjectId(),
    email: 'guest@example.com',
    marketingConsent: true
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'already_converted');
});

test('recovery eligibility rejects suppressed records', async () => {
  const result = await evaluateRecoveryEligibility({
    quotedTotalCents: 10000,
    expiresAt: new Date(Date.now() + 60_000),
    status: 'quoted',
    email: 'guest@example.com',
    marketingConsent: true,
    recoveryState: { suppressedAt: new Date(), suppressionReason: 'unsubscribed' }
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'suppressed');
});

test('recovery eligibility rejects internal/test records', async () => {
  const result = await evaluateRecoveryEligibility({
    quotedTotalCents: 10000,
    expiresAt: new Date(Date.now() + 60_000),
    status: 'quoted',
    email: 'guest@example.com',
    marketingConsent: true,
    isTest: true
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'test_or_internal');
});

test('recovery API list does not expose raw email', async () => {
  const cabin = await createCabin();
  await upsertSavedQuoteFromSuccessfulQuote({
    req: quoteReq({ cabinId: String(cabin._id) }),
    result: quoteResultForCabin(cabin)
  });
  await SavedBookingQuote.updateOne(
    {},
    { $set: { email: 'secret.guest@example.com', emailNormalized: 'secret.guest@example.com' } }
  );
  const today = new Date();
  const from = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const listed = await listRecoveryQuotes({ propertyKind: 'cabin', from, to });
  assert.ok(listed.rows.length >= 1);
  const row = listed.rows[0];
  assert.equal(row.hasEmail, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(row, 'email'));
  assert.ok(row.emailMasked.includes('***'));
  assert.ok(!String(row.emailMasked).includes('secret.guest'));
  assert.equal(listed.provenance.listOmitsRawEmail, true);
});

test('cross-zone entity filters return HTTP 400', async () => {
  const valleyCabin = await createCabin({ propertyKind: 'valley' });
  await assert.rejects(
    () =>
      listRecoveryQuotes({
        propertyKind: 'cabin',
        from: '2026-07-01',
        to: '2026-07-31',
        cabinId: String(valleyCabin._id)
      }),
    (err) => err.statusCode === 400
  );
});

test('recovery records do not alter the main conversion funnel', async () => {
  const cabin = await createCabin();
  await upsertSavedQuoteFromSuccessfulQuote({
    req: quoteReq({ cabinId: String(cabin._id) }),
    result: quoteResultForCabin(cabin)
  });
  const today = new Date();
  const from = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const summary = await aggregateConversionSummary({
    propertyKind: 'cabin',
    from,
    to
  });
  const quoteStep = summary.steps.find((s) => s.eventType === 'quote_received');
  assert.equal(quoteStep.sessionCount, 0);
  assert.equal(quoteStep.eventCount, 0);
  assert.ok(summary.supplementary.savedQuotes.savedValidQuotes >= 1);
});

test('exact quoted price remains unchanged after later price changes', async () => {
  const cabin = await createCabin({ pricePerNight: 100 });
  const upsert = await upsertSavedQuoteFromSuccessfulQuote({
    req: quoteReq({ cabinId: String(cabin._id) }),
    result: quoteResultForCabin(cabin, { totalPrice: 200 })
  });
  cabin.pricePerNight = 999;
  await cabin.save();
  const doc = await SavedBookingQuote.findById(upsert.savedQuoteId).lean();
  assert.equal(doc.quotedTotalCents, 20000);
  assert.equal(doc.pricingSnapshot.baseCents, 20000);
});

test('no email is sent anywhere in Batch 4A saved-quote modules', () => {
  const root = path.join(__dirname, '..');
  const files = [
    'services/savedQuotes/savedQuoteService.js',
    'services/savedQuotes/recoveryEligibilityService.js',
    'services/savedQuotes/savedQuoteFingerprint.js',
    'services/savedQuotes/savedQuoteSnapshot.js',
    'services/savedQuotes/savedQuoteConstants.js',
    'services/ops/readModels/recoveryReadModel.js',
    'routes/ops/modules/conversionRoutes.js',
    'models/SavedBookingQuote.js'
  ];
  const banned = [
    /sendMail\b/i,
    /sendEmail\b/i,
    /nodemailer/i,
    /transporter\.send/i,
    /require\(['"].*email/i
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const pattern of banned) {
      assert.equal(pattern.test(src), false, `${rel} matched ${pattern}`);
    }
  }
  const routesSrc = fs.readFileSync(path.join(root, 'routes/ops/modules/conversionRoutes.js'), 'utf8');
  assert.equal(/router\.(post|put|patch)\s*\(\s*['"`].*recovery.*\/send/.test(routesSrc), false);
  assert.match(routesSrc, /router\.get\(\s*['"]\/recovery['"]/);
  assert.equal(/lastMessageType\s*[:=]/.test(fs.readFileSync(path.join(root, 'services/savedQuotes/savedQuoteService.js'), 'utf8')), false);
});

test('mapRecoveryListRow never includes sessionKey or visitorKey', async () => {
  const cabin = await createCabin();
  const upsert = await upsertSavedQuoteFromSuccessfulQuote({
    req: quoteReq({ cabinId: String(cabin._id) }),
    result: quoteResultForCabin(cabin)
  });
  const doc = await SavedBookingQuote.findById(upsert.savedQuoteId).lean();
  const row = mapRecoveryListRow(doc);
  assert.equal(row.sessionKey, undefined);
  assert.equal(row.visitorKey, undefined);
});

test('supplementary recovery counts are available', async () => {
  const cabin = await createCabin();
  await upsertSavedQuoteFromSuccessfulQuote({
    req: quoteReq({ cabinId: String(cabin._id) }),
    result: quoteResultForCabin(cabin)
  });
  const range = buildInclusiveDateRange(
    new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  );
  const counts = await aggregateRecoverySupplementaryCounts({
    propertyKind: 'cabin',
    range
  });
  assert.ok(counts.savedValidQuotes >= 1);
  assert.equal(counts.recoveryEligibleJourneys, 0);
});
