'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const SavedBookingQuote = require('../models/SavedBookingQuote');
const GuestContactPreference = require('../models/GuestContactPreference');
const QuoteContactConsentEvent = require('../models/QuoteContactConsentEvent');

const {
  upsertSavedQuoteFromLocationQuote,
  linkSavedQuoteToCheckout,
  markSavedQuoteConverted
} = require('../services/savedQuotes/savedQuoteService');
const { evaluateRecoveryEligibility } = require('../services/savedQuotes/recoveryEligibilityService');
const { captureQuoteContactConsent } = require('../services/savedQuotes/quoteContactConsentService');
const { resolveGuestContactStatus } = require('../services/savedQuotes/contactPreferenceResolutionService');
const { purgeSavedBookingQuotes } = require('../services/savedQuotes/savedQuoteRetentionService');
const {
  listRecoveryQuotes,
  mapRecoveryListRow
} = require('../services/ops/readModels/recoveryReadModel');

let mongoServer;

function locationQuote({ totalPrice = 1200, checkIn = '2026-09-10', checkOut = '2026-09-13' } = {}) {
  return {
    available: true,
    locationKey: 'valley',
    locationSlug: 'the-valley',
    checkIn,
    checkOut,
    nights: 3,
    totalSleeps: 20,
    adults: 4,
    children: 0,
    currency: 'EUR',
    totalPrice,
    lodgingSubtotal: totalPrice,
    priceDisclaimer: 'Location buyout',
    includedTargets: [
      { targetType: 'cabin', name: 'Stone House', unitCount: 1, sleeps: 6, lodgingSubtotal: 400 },
      { targetType: 'unit', name: 'A-frame', unitCount: 4, sleeps: 8, lodgingSubtotal: 800 }
    ]
  };
}

function valleyReq(body = {}) {
  return {
    body: {
      adults: 4,
      children: 0,
      funnelSessionKey: 'valley-sess-a',
      funnelVisitorKey: 'valley-vis-a',
      ...body
    }
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await SavedBookingQuote.syncIndexes();
  await QuoteContactConsentEvent.syncIndexes();
  await GuestContactPreference.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    SavedBookingQuote.deleteMany({}),
    GuestContactPreference.deleteMany({}),
    QuoteContactConsentEvent.deleteMany({})
  ]);
});

test('Valley quote creates a saved quote', async () => {
  const result = await upsertSavedQuoteFromLocationQuote({
    req: valleyReq(),
    quote: locationQuote()
  });
  assert.equal(result.skipped, false);
  const docs = await SavedBookingQuote.find({}).lean();
  assert.equal(docs.length, 1);
  assert.equal(docs[0].propertyKind, 'valley');
  assert.equal(docs[0].entityType, 'location');
  assert.equal(docs[0].locationKey, 'valley');
  assert.equal(docs[0].pricingSnapshot.isLocationBuyout, true);
  assert.equal(docs[0].quotedTotalCents, 120000);
  assert.ok(Array.isArray(docs[0].pricingSnapshot.includedTargets));
  assert.equal(docs[0].pricingSnapshot.includedTargets.length, 2);
});

test('Valley quote snapshot remains immutable', async () => {
  const upsert = await upsertSavedQuoteFromLocationQuote({
    req: valleyReq(),
    quote: locationQuote({ totalPrice: 1200 })
  });
  const doc = await SavedBookingQuote.findById(upsert.savedQuoteId).lean();
  assert.equal(doc.quotedTotalCents, 120000);
  // Later market price change must not rewrite snapshot.
  assert.equal(doc.pricingSnapshot.lodgingSubtotalCents, 120000);
});

test('Valley duplicate quote dedupes correctly', async () => {
  const req = valleyReq();
  const quote = locationQuote();
  const first = await upsertSavedQuoteFromLocationQuote({ req, quote });
  const second = await upsertSavedQuoteFromLocationQuote({ req, quote });
  assert.equal(first.savedQuoteId, second.savedQuoteId);
  assert.equal(await SavedBookingQuote.countDocuments({}), 1);
});

test('Valley location booking does not duplicate child unit journeys', async () => {
  await upsertSavedQuoteFromLocationQuote({ req: valleyReq(), quote: locationQuote() });
  assert.equal(await SavedBookingQuote.countDocuments({}), 1);
  assert.equal(await SavedBookingQuote.countDocuments({ entityType: 'location' }), 1);
  assert.equal(await SavedBookingQuote.countDocuments({ cabinId: { $ne: null } }), 0);
});

test('Valley checkout links', async () => {
  const upsert = await upsertSavedQuoteFromLocationQuote({
    req: valleyReq(),
    quote: locationQuote()
  });
  const linked = await linkSavedQuoteToCheckout({
    checkoutId: 'loc_cko_1',
    locationKey: 'valley',
    checkInDateOnly: '2026-09-10',
    checkOutDateOnly: '2026-09-13',
    adults: 4,
    children: 0,
    quotedTotalCents: 120000,
    checkoutExpiresAt: new Date(Date.now() + 30 * 60 * 1000)
  });
  assert.equal(linked.skipped, false);
  assert.equal(linked.savedQuoteId, upsert.savedQuoteId);
  const doc = await SavedBookingQuote.findById(upsert.savedQuoteId).lean();
  assert.equal(doc.status, 'checkout_started');
  assert.equal(doc.checkoutId, 'loc_cko_1');
  assert.ok(doc.checkoutExpiresAt);
});

test('Valley booking conversion suppresses recovery', async () => {
  const upsert = await upsertSavedQuoteFromLocationQuote({
    req: valleyReq(),
    quote: locationQuote()
  });
  await linkSavedQuoteToCheckout({
    checkoutId: 'loc_cko_conv',
    locationKey: 'valley',
    checkInDateOnly: '2026-09-10',
    checkOutDateOnly: '2026-09-13',
    quotedTotalCents: 120000
  });
  const locationBookingId = new mongoose.Types.ObjectId();
  const converted = await markSavedQuoteConverted({
    locationBookingId,
    checkoutId: 'loc_cko_conv',
    locationKey: 'valley',
    checkInDateOnly: '2026-09-10',
    checkOutDateOnly: '2026-09-13',
    guestEmail: 'valley.guest@driftdwells.test'
  });
  assert.equal(converted.skipped, false);
  const doc = await SavedBookingQuote.findById(upsert.savedQuoteId).lean();
  assert.equal(doc.status, 'converted');
  assert.equal(String(doc.locationBookingId), String(locationBookingId));
  const eligibility = await evaluateRecoveryEligibility(doc);
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, 'already_converted');
});

test('Quote delivery checkbox defaults false and is optional', async () => {
  const result = await captureQuoteContactConsent({
    email: 'guest@driftdwells.test',
    quoteDeliveryRequested: false,
    bookingReminderConsent: false,
    marketingConsent: false,
    sourceSurface: 'confirm_booking'
  });
  assert.equal(result.consentSnapshot.quoteDeliveryRequested, false);
  assert.equal(result.consentSnapshot.bookingReminderConsent, false);
  assert.equal(result.consentSnapshot.marketingConsent, false);
});

test('Explicit quote delivery allows only quote delivery eligibility', async () => {
  await captureQuoteContactConsent({
    email: 'qd@driftdwells.test',
    quoteDeliveryRequested: true,
    bookingReminderConsent: false,
    marketingConsent: false,
    sourceSurface: 'confirm_booking'
  });
  const status = await resolveGuestContactStatus('qd@driftdwells.test');
  assert.equal(status.quoteDeliveryAllowed, true);
  assert.equal(status.bookingReminderAllowed, false);
  assert.equal(status.marketingAllowed, false);

  const eligibility = await evaluateRecoveryEligibility({
    quotedTotalCents: 10000,
    expiresAt: new Date(Date.now() + 60_000),
    status: 'quoted',
    email: 'qd@driftdwells.test',
    quoteDeliveryRequested: true
  });
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.reason, 'quote_delivery_requested');
});

test('Explicit reminder consent allows reminder eligibility', async () => {
  await captureQuoteContactConsent({
    email: 'rem@driftdwells.test',
    quoteDeliveryRequested: false,
    bookingReminderConsent: true,
    marketingConsent: false,
    sourceSurface: 'confirm_booking'
  });
  const eligibility = await evaluateRecoveryEligibility({
    quotedTotalCents: 10000,
    expiresAt: new Date(Date.now() + 60_000),
    status: 'quoted',
    email: 'rem@driftdwells.test',
    bookingReminderConsent: true
  });
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.reason, 'booking_reminder_consent');
});

test('Analytics consent alone is rejected', async () => {
  const eligibility = await evaluateRecoveryEligibility({
    quotedTotalCents: 10000,
    expiresAt: new Date(Date.now() + 60_000),
    status: 'quoted',
    analyticsConsent: true,
    email: null
  });
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, 'missing_email');
});

test('Email alone is rejected', async () => {
  const eligibility = await evaluateRecoveryEligibility({
    quotedTotalCents: 10000,
    expiresAt: new Date(Date.now() + 60_000),
    status: 'quoted',
    email: 'alone@driftdwells.test'
  });
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, 'no_valid_consent');
});

test('Consent withdrawal overrides old saved quote consent', async () => {
  await captureQuoteContactConsent({
    email: 'withdraw@driftdwells.test',
    quoteDeliveryRequested: true,
    bookingReminderConsent: true,
    marketingConsent: false,
    sourceSurface: 'confirm_booking'
  });
  await captureQuoteContactConsent({
    email: 'withdraw@driftdwells.test',
    quoteDeliveryRequested: false,
    bookingReminderConsent: false,
    marketingConsent: false,
    sourceSurface: 'confirm_booking',
    recordDeclines: true
  });
  const eligibility = await evaluateRecoveryEligibility({
    quotedTotalCents: 10000,
    expiresAt: new Date(Date.now() + 60_000),
    status: 'quoted',
    email: 'withdraw@driftdwells.test',
    quoteDeliveryRequested: true,
    bookingReminderConsent: true
  });
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, 'consent_withdrawn');
});

test('Global suppression overrides every consent type', async () => {
  await GuestContactPreference.create({
    recipientType: 'email',
    recipientValue: 'suppressed@driftdwells.test',
    phoneStatus: 'unknown',
    transactional: 'unknown',
    marketing: 'granted',
    quoteDelivery: 'granted',
    bookingReminder: 'granted',
    suppressed: true,
    suppressedReason: 'user_optout_stop',
    suppressedAt: new Date()
  });
  const eligibility = await evaluateRecoveryEligibility({
    quotedTotalCents: 10000,
    expiresAt: new Date(Date.now() + 60_000),
    status: 'quoted',
    email: 'suppressed@driftdwells.test',
    bookingReminderConsent: true,
    marketingConsent: true
  });
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, 'globally_suppressed');
});

test('Consent text and version are persisted', async () => {
  await captureQuoteContactConsent({
    email: 'text@driftdwells.test',
    quoteDeliveryRequested: true,
    bookingReminderConsent: true,
    marketingConsent: true,
    sourceSurface: 'confirm_booking'
  });
  const events = await QuoteContactConsentEvent.find({ emailNormalized: 'text@driftdwells.test' }).lean();
  assert.equal(events.length, 3);
  for (const event of events) {
    assert.ok(event.textVersion);
    assert.ok(event.textSnapshot.length > 10);
    assert.equal(event.granted, true);
  }
});

test('Expired quote and expired checkout are distinguished', async () => {
  const now = new Date();
  const quoteExpired = await evaluateRecoveryEligibility({
    quotedTotalCents: 10000,
    expiresAt: new Date(now.getTime() - 1000),
    checkoutExpiresAt: new Date(now.getTime() + 60_000),
    status: 'quoted',
    email: 'x@driftdwells.test',
    bookingReminderConsent: true
  });
  assert.equal(quoteExpired.reason, 'expired');

  await captureQuoteContactConsent({
    email: 'checkoutactive@driftdwells.test',
    bookingReminderConsent: true,
    sourceSurface: 'confirm_booking'
  });
  const checkoutActive = await evaluateRecoveryEligibility({
    quotedTotalCents: 10000,
    expiresAt: new Date(now.getTime() + 60_000),
    checkoutExpiresAt: new Date(now.getTime() + 30_000),
    checkoutId: 'cko_active',
    status: 'checkout_started',
    email: 'checkoutactive@driftdwells.test',
    bookingReminderConsent: true
  });
  assert.equal(checkoutActive.reason, 'checkout_still_active');
});

test('Converted booking suppresses related quote records', async () => {
  const req = valleyReq({ funnelSessionKey: 'same-sess' });
  const a = await upsertSavedQuoteFromLocationQuote({
    req,
    quote: locationQuote({ checkIn: '2026-09-10', checkOut: '2026-09-13' })
  });
  await upsertSavedQuoteFromLocationQuote({
    req: valleyReq({ funnelSessionKey: 'same-sess' }),
    quote: locationQuote({ totalPrice: 1300, checkIn: '2026-09-10', checkOut: '2026-09-13' })
  });
  await markSavedQuoteConverted({
    locationBookingId: new mongoose.Types.ObjectId(),
    sessionKey: 'same-sess',
    locationKey: 'valley',
    checkInDateOnly: '2026-09-10',
    checkOutDateOnly: '2026-09-13'
  });
  const converted = await SavedBookingQuote.findById(a.savedQuoteId).lean();
  assert.ok(['converted', 'superseded'].includes(converted.status) || converted.status === 'converted');
  const open = await SavedBookingQuote.countDocuments({
    status: { $in: ['quoted', 'checkout_started'] },
    sessionKey: 'same-sess'
  });
  assert.equal(open, 0);
});

test('Repeated checkout does not create uncontrolled duplicate records', async () => {
  await upsertSavedQuoteFromLocationQuote({ req: valleyReq(), quote: locationQuote() });
  await linkSavedQuoteToCheckout({
    checkoutId: 'cko_1',
    locationKey: 'valley',
    checkInDateOnly: '2026-09-10',
    checkOutDateOnly: '2026-09-13',
    quotedTotalCents: 120000
  });
  await linkSavedQuoteToCheckout({
    checkoutId: 'cko_2',
    locationKey: 'valley',
    checkInDateOnly: '2026-09-10',
    checkOutDateOnly: '2026-09-13',
    quotedTotalCents: 120000
  });
  const active = await SavedBookingQuote.find({ status: 'checkout_started' }).lean();
  assert.equal(active.length, 1);
  assert.equal(active[0].checkoutId, 'cko_2');
});

test('OPS list does not expose raw email or browser identity', async () => {
  await upsertSavedQuoteFromLocationQuote({ req: valleyReq(), quote: locationQuote() });
  await SavedBookingQuote.updateOne(
    {},
    {
      $set: {
        email: 'secret@driftdwells.test',
        emailNormalized: 'secret@driftdwells.test',
        sessionKey: 'sess-secret',
        visitorKey: 'vis-secret'
      }
    }
  );
  const from = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const listed = await listRecoveryQuotes({ propertyKind: 'valley', from, to });
  assert.ok(listed.rows.length >= 1);
  const row = listed.rows[0];
  assert.ok(!Object.prototype.hasOwnProperty.call(row, 'email'));
  assert.ok(!Object.prototype.hasOwnProperty.call(row, 'sessionKey'));
  assert.ok(!Object.prototype.hasOwnProperty.call(row, 'visitorKey'));
  assert.ok(row.emailMasked.includes('***'));
});

test('Purge defaults to dry run and anonymizes on execute', async () => {
  const old = await SavedBookingQuote.create({
    propertyKind: 'valley',
    entityType: 'location',
    entityId: new mongoose.Types.ObjectId('a11ce0000000000000000001'),
    locationKey: 'valley',
    checkIn: new Date('2025-01-01'),
    checkOut: new Date('2025-01-04'),
    checkInDateOnly: '2025-01-01',
    checkOutDateOnly: '2025-01-04',
    adults: 2,
    children: 0,
    quotedTotalCents: 10000,
    quoteFingerprint: `sq:old:${Date.now()}`,
    email: 'old@driftdwells.test',
    emailNormalized: 'old@driftdwells.test',
    sessionKey: 'old-sess',
    visitorKey: 'old-vis',
    status: 'expired',
    quotedAt: new Date('2025-01-01'),
    expiresAt: new Date('2025-01-03'),
    recoveryState: { sendCount: 0, suppressedAt: new Date(), suppressionReason: 'converted' },
    bookingId: new mongoose.Types.ObjectId()
  });

  const dry = await purgeSavedBookingQuotes({
    dryRun: true,
    cutoff: new Date('2026-01-01'),
    batchSize: 50
  });
  assert.equal(dry.dryRun, true);
  assert.ok(dry.wouldAnonymize >= 1);
  const still = await SavedBookingQuote.findById(old._id).lean();
  assert.equal(still.emailNormalized, 'old@driftdwells.test');

  const exec = await purgeSavedBookingQuotes({
    dryRun: false,
    cutoff: new Date('2026-01-01'),
    batchSize: 50
  });
  assert.equal(exec.dryRun, false);
  assert.ok(exec.anonymized >= 1);
  const anon = await SavedBookingQuote.findById(old._id).lean();
  assert.equal(anon.emailNormalized, null);
  assert.equal(anon.sessionKey, null);
  assert.ok(anon.bookingId);
  assert.equal(anon.recoveryState.suppressionReason, 'converted');
  assert.ok(anon.anonymizedAt);
});

test('Pagination reports exact totals for persisted filters', async () => {
  for (let i = 0; i < 3; i += 1) {
    await upsertSavedQuoteFromLocationQuote({
      req: valleyReq({ funnelSessionKey: `page-sess-${i}` }),
      quote: locationQuote({ totalPrice: 1000 + i })
    });
  }
  const from = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const page1 = await listRecoveryQuotes({
    propertyKind: 'valley',
    from,
    to,
    page: 1,
    limit: 2
  });
  assert.equal(page1.pagination.totalBasis, 'persisted_filters');
  assert.equal(page1.pagination.returned, page1.rows.length);
  assert.ok(page1.rows.length <= 2);
  assert.equal(page1.pagination.total, 3);
  assert.equal(page1.pagination.hasMore, true);
});

test('Cross-zone filters remain rejected', async () => {
  await assert.rejects(
    () =>
      listRecoveryQuotes({
        propertyKind: 'cabin',
        from: '2026-07-01',
        to: '2026-07-31',
        cabinId: new mongoose.Types.ObjectId().toString()
      }),
    (err) => err.statusCode === 400 || /cabin|propertyKind|not found|does not belong/i.test(err.message)
  );
});

test('Relevant indexes exist on SavedBookingQuote', async () => {
  const indexes = await SavedBookingQuote.collection.indexes();
  const keys = indexes.map((idx) => JSON.stringify(idx.key));
  assert.ok(keys.some((k) => k.includes('"propertyKind"') && k.includes('"quotedAt"')));
  assert.ok(keys.some((k) => k.includes('"quoteFingerprint"')));
  assert.ok(keys.some((k) => k.includes('"expiresAt"')));
});

test('No email is sent anywhere in Batch 4A.1 saved-quote modules', () => {
  const root = path.join(__dirname, '..');
  const files = [
    'services/savedQuotes/savedQuoteService.js',
    'services/savedQuotes/recoveryEligibilityService.js',
    'services/savedQuotes/quoteContactConsentService.js',
    'services/savedQuotes/contactPreferenceResolutionService.js',
    'services/savedQuotes/savedQuoteRetentionService.js',
    'services/ops/readModels/recoveryReadModel.js',
    'routes/ops/modules/conversionRoutes.js',
    'models/SavedBookingQuote.js',
    'models/QuoteContactConsentEvent.js',
    'scripts/purgeSavedBookingQuotes.cjs'
  ];
  const banned = [/sendMail\b/i, /sendEmail\b/i, /nodemailer/i, /transporter\.send/i];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const pattern of banned) {
      assert.equal(pattern.test(src), false, `${rel} matched ${pattern}`);
    }
  }
  const routesSrc = fs.readFileSync(path.join(root, 'routes/ops/modules/conversionRoutes.js'), 'utf8');
  assert.equal(/router\.(post|put|patch)\s*\(\s*['"`].*recovery.*\/send/.test(routesSrc), false);
  assert.equal(/Send now|Resend|Bulk send/i.test(
    fs.readFileSync(path.join(root, '../client/src/pages/ops/OpsConversionRecovery.jsx'), 'utf8')
  ), false);
  const uiSrc = fs.readFileSync(
    path.join(root, '../client/src/pages/ops/OpsConversionRecovery.jsx'),
    'utf8'
  );
  assert.equal(/Send recovery|Send email|Bulk send/i.test(uiSrc), false);
  assert.equal(/setInterval|node-cron|agenda|bull/i.test(
    fs.readFileSync(path.join(root, 'services/savedQuotes/savedQuoteRetentionService.js'), 'utf8')
  ), false);
});
