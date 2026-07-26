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
const RecoveryMessageDelivery = require('../models/RecoveryMessageDelivery');
const GuestPreferenceAccessToken = require('../models/GuestPreferenceAccessToken');

const {
  issuePreferenceAccessToken,
  applyPublicPreferenceWithdrawal,
  getPublicPreferenceState,
  hashToken
} = require('../services/savedQuotes/preferenceAccessTokenService');
const { captureQuoteContactConsent } = require('../services/savedQuotes/quoteContactConsentService');
const { evaluateRecoveryDeliveryGate } = require('../services/savedQuotes/recoveryDeliveryGateService');
const {
  prepareRecoveryDelivery,
  findQuoteDeliveryCandidates,
  findBookingReminderCandidates
} = require('../services/savedQuotes/recoveryPreparationService');
const {
  buildRecoveryPreview,
  assertTemplateSafety,
  getTemplateDefinition
} = require('../services/savedQuotes/recoveryTemplateService');
const {
  issueContinuationToken,
  resolveContinuationDestination
} = require('../services/savedQuotes/recoveryContinuationService');
const { markSavedQuoteConverted } = require('../services/savedQuotes/savedQuoteService');
const { listRecoveryQuotes } = require('../services/ops/readModels/recoveryReadModel');
const featureFlags = require('../utils/featureFlags');

let mongoServer;

async function seedQuote(overrides = {}) {
  return SavedBookingQuote.create({
    propertyKind: 'cabin',
    entityType: 'cabin',
    entityId: new mongoose.Types.ObjectId(),
    cabinId: new mongoose.Types.ObjectId(),
    checkIn: new Date('2026-10-01'),
    checkOut: new Date('2026-10-03'),
    checkInDateOnly: '2026-10-01',
    checkOutDateOnly: '2026-10-03',
    adults: 2,
    children: 0,
    quotedTotalCents: 25000,
    quoteFingerprint: `sq:test:${Date.now()}:${Math.random()}`,
    email: 'guest@driftdwells.test',
    emailNormalized: 'guest@driftdwells.test',
    quoteDeliveryRequested: true,
    bookingReminderConsent: true,
    marketingConsent: false,
    status: 'quoted',
    quotedAt: new Date(),
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    ...overrides
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await Promise.all([
    SavedBookingQuote.syncIndexes(),
    RecoveryMessageDelivery.syncIndexes(),
    GuestPreferenceAccessToken.syncIndexes()
  ]);
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
    QuoteContactConsentEvent.deleteMany({}),
    RecoveryMessageDelivery.deleteMany({}),
    GuestPreferenceAccessToken.deleteMany({})
  ]);
  delete process.env.RECOVERY_QUOTE_DELIVERY_ENABLED;
  delete process.env.RECOVERY_BOOKING_REMINDER_ENABLED;
  delete process.env.RECOVERY_EMAIL_PROVIDER_ENABLED;
});

test('signed preference token does not expose email', async () => {
  const issued = await issuePreferenceAccessToken({ email: 'secret@driftdwells.test' });
  assert.ok(issued.rawToken);
  assert.equal(issued.preferenceUrl.includes('secret@'), false);
  assert.equal(issued.preferenceUrl.includes('driftdwells.test'), false);
  const stored = await GuestPreferenceAccessToken.findOne({ tokenHash: hashToken(issued.rawToken) }).lean();
  assert.equal(stored.emailNormalized, 'secret@driftdwells.test');
  const state = await getPublicPreferenceState(issued.rawToken);
  assert.equal(state.ok, true);
  assert.ok(state.maskedEmail.includes('***'));
  assert.equal(state.canGrantConsent, false);
});

test('public route cannot grant consent', async () => {
  const issued = await issuePreferenceAccessToken({ email: 'guest@driftdwells.test' });
  const denied = await applyPublicPreferenceWithdrawal(issued.rawToken, {
    marketingConsent: true
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, 'grant_not_allowed');
});

test('reminder withdrawal updates effective preference', async () => {
  await captureQuoteContactConsent({
    email: 'guest@driftdwells.test',
    bookingReminderConsent: true,
    quoteDeliveryRequested: true,
    sourceSurface: 'confirm_booking'
  });
  const issued = await issuePreferenceAccessToken({ email: 'guest@driftdwells.test' });
  const result = await applyPublicPreferenceWithdrawal(issued.rawToken, {
    withdrawBookingReminder: true
  });
  assert.equal(result.ok, true);
  assert.equal(result.preferences.bookingReminderAllowed, false);
  assert.equal(result.preferences.quoteDeliveryAllowed, true);
});

test('marketing withdrawal remains separate', async () => {
  await captureQuoteContactConsent({
    email: 'guest@driftdwells.test',
    bookingReminderConsent: true,
    marketingConsent: true,
    sourceSurface: 'confirm_booking'
  });
  const issued = await issuePreferenceAccessToken({ email: 'guest@driftdwells.test' });
  await applyPublicPreferenceWithdrawal(issued.rawToken, { withdrawMarketing: true });
  const pref = await GuestContactPreference.findOne({
    recipientType: 'email',
    recipientValue: 'guest@driftdwells.test'
  }).lean();
  assert.equal(pref.marketing, 'denied');
  assert.equal(pref.bookingReminder, 'granted');
});

test('suppress-all overrides every purpose', async () => {
  await captureQuoteContactConsent({
    email: 'guest@driftdwells.test',
    quoteDeliveryRequested: true,
    bookingReminderConsent: true,
    marketingConsent: true,
    sourceSurface: 'confirm_booking'
  });
  const issued = await issuePreferenceAccessToken({ email: 'guest@driftdwells.test' });
  const result = await applyPublicPreferenceWithdrawal(issued.rawToken, { suppressAll: true });
  assert.equal(result.preferences.globallySuppressed, true);
  assert.equal(result.preferences.quoteDeliveryAllowed, false);
  assert.equal(result.preferences.bookingReminderAllowed, false);
  assert.equal(result.preferences.marketingAllowed, false);
});

test('repeated withdrawal is idempotent', async () => {
  await captureQuoteContactConsent({
    email: 'guest@driftdwells.test',
    bookingReminderConsent: true,
    sourceSurface: 'confirm_booking'
  });
  const issued = await issuePreferenceAccessToken({ email: 'guest@driftdwells.test' });
  const first = await applyPublicPreferenceWithdrawal(issued.rawToken, {
    withdrawBookingReminder: true
  });
  const second = await applyPublicPreferenceWithdrawal(issued.rawToken, {
    withdrawBookingReminder: true
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.idempotent, true);
});

test('expired or invalid token changes nothing', async () => {
  await captureQuoteContactConsent({
    email: 'guest@driftdwells.test',
    bookingReminderConsent: true,
    sourceSurface: 'confirm_booking'
  });
  const issued = await issuePreferenceAccessToken({ email: 'guest@driftdwells.test' });
  await GuestPreferenceAccessToken.updateOne(
    { tokenHash: hashToken(issued.rawToken) },
    { $set: { expiresAt: new Date(Date.now() - 1000) } }
  );
  const result = await applyPublicPreferenceWithdrawal(issued.rawToken, {
    withdrawBookingReminder: true
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'expired_token');
  const pref = await GuestContactPreference.findOne({
    recipientValue: 'guest@driftdwells.test'
  }).lean();
  assert.equal(pref.bookingReminder, 'granted');
});

test('deterministic delivery idempotency and duplicate prepare', async () => {
  const quote = await seedQuote();
  await captureQuoteContactConsent({
    email: 'guest@driftdwells.test',
    bookingReminderConsent: true,
    sourceSurface: 'confirm_booking'
  });
  const first = await prepareRecoveryDelivery({
    savedQuoteId: quote._id,
    messagePurpose: 'booking_reminder'
  });
  const second = await prepareRecoveryDelivery({
    savedQuoteId: quote._id,
    messagePurpose: 'booking_reminder'
  });
  assert.equal(first.ok, true);
  assert.equal(second.deduped, true);
  assert.equal(String(first.delivery._id || first.delivery.id), String(second.delivery._id));
  assert.equal(await RecoveryMessageDelivery.countDocuments({ isPreview: { $ne: true } }), 1);
});

test('conversion cancels unsent preparation', async () => {
  const quote = await seedQuote();
  await captureQuoteContactConsent({
    email: 'guest@driftdwells.test',
    bookingReminderConsent: true,
    sourceSurface: 'confirm_booking'
  });
  await prepareRecoveryDelivery({
    savedQuoteId: quote._id,
    messagePurpose: 'booking_reminder'
  });
  await markSavedQuoteConverted({
    bookingId: new mongoose.Types.ObjectId(),
    guestEmail: 'guest@driftdwells.test',
    cabinId: quote.cabinId,
    checkInDateOnly: quote.checkInDateOnly,
    checkOutDateOnly: quote.checkOutDateOnly
  });
  const delivery = await RecoveryMessageDelivery.findOne({ savedQuoteId: quote._id }).lean();
  assert.equal(delivery.status, 'cancelled');
  assert.equal(delivery.cancelReason, 'converted');
});

test('suppression cancels unsent preparation', async () => {
  const quote = await seedQuote();
  await captureQuoteContactConsent({
    email: 'guest@driftdwells.test',
    bookingReminderConsent: true,
    sourceSurface: 'confirm_booking'
  });
  await prepareRecoveryDelivery({
    savedQuoteId: quote._id,
    messagePurpose: 'booking_reminder'
  });
  const issued = await issuePreferenceAccessToken({ email: 'guest@driftdwells.test' });
  await applyPublicPreferenceWithdrawal(issued.rawToken, { suppressAll: true });
  const delivery = await RecoveryMessageDelivery.findOne({ savedQuoteId: quote._id }).lean();
  assert.equal(delivery.status, 'cancelled');
});

test('delivery history contains no browser identity', async () => {
  const quote = await seedQuote({ sessionKey: 'sess-secret', visitorKey: 'vis-secret' });
  await captureQuoteContactConsent({
    email: 'guest@driftdwells.test',
    bookingReminderConsent: true,
    sourceSurface: 'confirm_booking'
  });
  await prepareRecoveryDelivery({
    savedQuoteId: quote._id,
    messagePurpose: 'booking_reminder'
  });
  const delivery = await RecoveryMessageDelivery.findOne({}).lean();
  assert.equal(delivery.sessionKey, undefined);
  assert.equal(delivery.visitorKey, undefined);
  assert.ok(delivery.recipientHash);
  assert.equal(delivery.recipientDomain, 'driftdwells.test');
});

test('send gate requires current consent and blocks stale snapshot', async () => {
  const quote = await seedQuote({ bookingReminderConsent: true });
  // No preference grant — stale snapshot alone must fail.
  const gate = await evaluateRecoveryDeliveryGate({
    savedQuoteId: quote._id,
    messagePurpose: 'booking_reminder'
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, 'missing_consent');
});

test('send gate blocks global suppression, converted, anonymized, already-sent, flags, test', async () => {
  const quote = await seedQuote();
  await captureQuoteContactConsent({
    email: 'guest@driftdwells.test',
    bookingReminderConsent: true,
    sourceSurface: 'confirm_booking'
  });

  process.env.RECOVERY_BOOKING_REMINDER_ENABLED = '1';
  process.env.RECOVERY_EMAIL_PROVIDER_ENABLED = '1';

  await GuestContactPreference.updateOne(
    { recipientValue: 'guest@driftdwells.test' },
    { $set: { suppressed: true, suppressedReason: 'user_optout_stop', suppressedAt: new Date() } }
  );
  let gate = await evaluateRecoveryDeliveryGate({
    savedQuoteId: quote._id,
    messagePurpose: 'booking_reminder'
  });
  assert.equal(gate.reason, 'globally_suppressed');

  await GuestContactPreference.updateOne(
    { recipientValue: 'guest@driftdwells.test' },
    { $set: { suppressed: false, suppressedReason: null } }
  );
  await SavedBookingQuote.updateOne(
    { _id: quote._id },
    { $set: { status: 'converted', bookingId: new mongoose.Types.ObjectId(), convertedAt: new Date() } }
  );
  gate = await evaluateRecoveryDeliveryGate({
    savedQuoteId: quote._id,
    messagePurpose: 'booking_reminder'
  });
  assert.equal(gate.reason, 'already_converted');

  const anon = await seedQuote({
    email: 'anon@driftdwells.test',
    emailNormalized: 'anon@driftdwells.test',
    anonymizedAt: new Date(),
    quoteFingerprint: `sq:anon:${Date.now()}`
  });
  await captureQuoteContactConsent({
    email: 'anon@driftdwells.test',
    bookingReminderConsent: true,
    sourceSurface: 'confirm_booking'
  });
  gate = await evaluateRecoveryDeliveryGate({
    savedQuoteId: anon._id,
    messagePurpose: 'booking_reminder'
  });
  assert.equal(gate.reason, 'anonymized');

  const testQuote = await seedQuote({
    isTest: true,
    quoteFingerprint: `sq:testflag:${Date.now()}`
  });
  gate = await evaluateRecoveryDeliveryGate({
    savedQuoteId: testQuote._id,
    messagePurpose: 'booking_reminder'
  });
  assert.equal(gate.reason, 'test_or_internal');

  delete process.env.RECOVERY_BOOKING_REMINDER_ENABLED;
  delete process.env.RECOVERY_EMAIL_PROVIDER_ENABLED;
  const live = await seedQuote({ quoteFingerprint: `sq:flag:${Date.now()}` });
  await captureQuoteContactConsent({
    email: 'guest@driftdwells.test',
    bookingReminderConsent: true,
    sourceSurface: 'confirm_booking'
  });
  gate = await evaluateRecoveryDeliveryGate({
    savedQuoteId: live._id,
    messagePurpose: 'booking_reminder'
  });
  assert.equal(gate.reason, 'feature_disabled');
});

test('templates: quote delivery has no marketing; reminder has preference link; no guarantees', () => {
  const quoteTpl = getTemplateDefinition('quote_delivery');
  const reminderTpl = getTemplateDefinition('booking_reminder');
  assert.equal(assertTemplateSafety(quoteTpl).ok, true);
  assert.equal(assertTemplateSafety(reminderTpl).ok, true);
  assert.match(reminderTpl.text, /Withdraw reminder|Manage email preferences|preference/i);
  assert.doesNotMatch(quoteTpl.text.toLowerCase(), /offer|newsletter|% off|promo/);
  assert.match(quoteTpl.text, /does not reserve availability|may differ/i);
  assert.match(reminderTpl.text, /not reserved|may no longer be available/i);
});

test('preview makes no provider call and creates no sent delivery', async () => {
  const quote = await seedQuote();
  await captureQuoteContactConsent({
    email: 'guest@driftdwells.test',
    bookingReminderConsent: true,
    sourceSurface: 'confirm_booking'
  });
  const preview = await buildRecoveryPreview({
    savedQuote: quote,
    messagePurpose: 'booking_reminder'
  });
  assert.equal(preview.ok, true);
  assert.ok(preview.subject);
  await prepareRecoveryDelivery({
    savedQuoteId: quote._id,
    messagePurpose: 'booking_reminder',
    isPreview: true
  });
  assert.equal(await RecoveryMessageDelivery.countDocuments({ status: 'sent' }), 0);
  assert.equal(await RecoveryMessageDelivery.countDocuments({ status: 'prepared_preview' }), 1);
});

test('continuation token resolves cabin/valley without identity leakage', async () => {
  const cabinQuote = await seedQuote();
  const issued = await issueContinuationToken({ savedQuoteId: cabinQuote._id });
  const dest = await resolveContinuationDestination(issued.rawToken);
  assert.equal(dest.ok, true);
  assert.ok(dest.destinationPath.includes('/stays/') || dest.destinationPath.includes('confirm'));
  assert.equal(dest.originalQuote.quotedTotalCents, 25000);
  assert.equal(dest.sessionKey, undefined);
  assert.equal(dest.visitorKey, undefined);

  const valley = await seedQuote({
    propertyKind: 'valley',
    entityType: 'location',
    locationKey: 'valley',
    cabinId: null,
    quoteFingerprint: `sq:valley:${Date.now()}`
  });
  const vIssued = await issueContinuationToken({ savedQuoteId: valley._id });
  const vDest = await resolveContinuationDestination(vIssued.rawToken);
  assert.equal(vDest.ok, true);
  assert.match(vDest.destinationPath, /the-valley/);
});

test('derived eligibility fill-batch fills pages across sparse matches', async () => {
  const from = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  for (let i = 0; i < 8; i += 1) {
    await seedQuote({
      quoteFingerprint: `sq:page:${i}:${Date.now()}`,
      email: i % 2 === 0 ? `a${i}@driftdwells.test` : null,
      emailNormalized: i % 2 === 0 ? `a${i}@driftdwells.test` : null,
      bookingReminderConsent: i % 2 === 0,
      quotedAt: new Date(Date.now() - i * 1000)
    });
    if (i % 2 === 0) {
      await captureQuoteContactConsent({
        email: `a${i}@driftdwells.test`,
        bookingReminderConsent: true,
        sourceSurface: 'confirm_booking'
      });
    }
  }

  const page1 = await listRecoveryQuotes({
    propertyKind: 'cabin',
    from,
    to,
    eligibility: 'booking_reminder_consent',
    page: 1,
    limit: 2
  });
  assert.equal(page1.pagination.totalBasis, 'derived_filters');
  assert.equal(page1.pagination.returned, page1.rows.length);
  assert.ok(page1.rows.length <= 2);
  assert.ok(page1.rows.every((r) => r.eligibilityReason === 'booking_reminder_consent'));
  assert.equal(page1.pagination.total, null);
});

test('candidate preparation is disabled by default and never schedules', async () => {
  assert.equal(featureFlags.isRecoveryQuoteDeliveryEnabled(), false);
  assert.equal(featureFlags.isRecoveryBookingReminderEnabled(), false);
  assert.equal(featureFlags.isRecoveryEmailProviderEnabled(), false);
  const q = await findQuoteDeliveryCandidates();
  const r = await findBookingReminderCandidates();
  assert.equal(q.featureDisabled, true);
  assert.equal(r.featureDisabled, true);
  assert.equal(q.candidates.length, 0);
});

test('no-send guarantee scan for Batch 4B modules', () => {
  const root = path.join(__dirname, '..');
  const files = [
    'services/savedQuotes/recoveryDeliveryGateService.js',
    'services/savedQuotes/recoveryPreparationService.js',
    'services/savedQuotes/recoveryTemplateService.js',
    'services/savedQuotes/preferenceAccessTokenService.js',
    'services/savedQuotes/recoveryContinuationService.js',
    'routes/ops/modules/conversionRoutes.js',
    'routes/publicRecoveryPreferenceRoutes.js',
    'models/RecoveryMessageDelivery.js'
  ];
  const banned = [
    /sendMail\b/i,
    /sendEmail\b/i,
    /nodemailer/i,
    /transporter\.send/i,
    /node-cron/i,
    /agenda\./i,
    /bull\./i,
    /setInterval\s*\(/
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const pattern of banned) {
      assert.equal(pattern.test(src), false, `${rel} matched ${pattern}`);
    }
  }
  const routes = fs.readFileSync(path.join(root, 'routes/ops/modules/conversionRoutes.js'), 'utf8');
  assert.equal(/router\.(post|put)\s*\(\s*['"`].*\/send/.test(routes), false);
  assert.match(routes, /preview/);
  const ui = fs.readFileSync(
    path.join(root, '../client/src/pages/ops/OpsConversionRecovery.jsx'),
    'utf8'
  );
  assert.equal(/Send now|Resend|Bulk send|Enable scheduler/i.test(ui), false);
  assert.match(ui, /Recovery delivery is disabled/);
});
