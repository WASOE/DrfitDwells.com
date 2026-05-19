/**
 * C3-E2 executeBookingFinalizeWork (extracted, unwired).
 *
 * Run: node --test server/scripts/executeBookingFinalizeWork.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const CheckoutSession = require('../models/CheckoutSession');
const { CHECKOUT_SESSION_ERROR_CODES, CheckoutSessionError } = require('../services/checkout/checkoutSessionErrors');
const { buildStayFingerprint } = require('../services/checkout/checkoutSessionFingerprints');
const {
  executeBookingFinalizeWork,
  __setExecuteBookingFinalizeWorkDependenciesForTesting,
  __resetExecuteBookingFinalizeWorkDependenciesForTesting
} = require('../services/checkout/executeBookingFinalizeWork');

let mongoServer;

const STAY_EMAIL = 'finalize-work@example.com';

function futureStayDates() {
  const checkIn = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);
  const checkOut = new Date(Date.now() + 29 * 24 * 60 * 60 * 1000);
  return { checkIn, checkOut };
}

function buildFingerprint(cabinId) {
  return buildStayFingerprint({
    guestEmail: STAY_EMAIL,
    entityType: 'cabin',
    cabinId: String(cabinId),
    checkInDateOnly: futureStayDates().checkIn.toISOString().slice(0, 10),
    checkOutDateOnly: futureStayDates().checkOut.toISOString().slice(0, 10)
  });
}

function buildLegalAcceptance() {
  return {
    termsVersion: '2024-01',
    activityRiskVersion: '2024-01',
    checkbox1TextSnapshot: 'terms',
    checkbox2TextSnapshot: 'risk',
    locale: 'en'
  };
}

function buildFinalizeContext(overrides = {}) {
  const cabinId = overrides.cabinId || new mongoose.Types.ObjectId();
  const { checkIn, checkOut } = futureStayDates();
  const base = {
    cabinId,
    checkInDate: checkIn,
    checkOutDate: checkOut,
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Work',
      lastName: 'Guest',
      email: STAY_EMAIL,
      phone: '+359800000020'
    },
    specialRequests: '',
    totalPrice: 400,
    subtotalPrice: 400,
    discountAmount: 0,
    subtotalCents: 40000,
    discountAmountCents: 0,
    giftVoucherAppliedCents: 0,
    stripePaidAmountCents: 40000,
    totalValueCents: 40000,
    paymentMethod: 'stripe',
    stripePaymentVerified: false,
    legalAcceptance: buildLegalAcceptance(),
    requestMeta: { ip: '127.0.0.1', userAgent: 'test', acceptLanguage: 'en' },
    transportOptions: []
  };
  return { ...base, ...overrides };
}

function buildBookingPayloadFromContext(ctx) {
  return {
    cabinId: ctx.cabinId,
    cabinTypeId: ctx.cabinTypeId || null,
    unitId: ctx.assignedUnitId || ctx.unitId || null,
    checkIn: ctx.checkInDate,
    checkOut: ctx.checkOutDate,
    guestInfo: ctx.guestInfo
  };
}

async function seedSession(overrides = {}) {
  const checkoutId = overrides.checkoutId || `chk_work_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const cabinId = overrides.cabinId || new mongoose.Types.ObjectId();
  const base = {
    checkoutId,
    flowVersion: 'v2',
    status: 'payment_required',
    paymentStatus: 'unpaid',
    finalizeStatus: 'in_progress',
    stayFingerprint: buildFingerprint(cabinId),
    sessionVersion: 2,
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000)
  };
  return CheckoutSession.create({ ...base, ...overrides, checkoutId });
}

function createStripeStub() {
  const updates = [];
  return {
    client: {
      paymentIntents: {
        update: async (paymentIntentId, payload) => {
          updates.push({ paymentIntentId, payload });
          return { id: paymentIntentId };
        }
      }
    },
    updates
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Promise.all([Booking.syncIndexes(), CheckoutSession.syncIndexes()]);
});

test.beforeEach(async () => {
  __resetExecuteBookingFinalizeWorkDependenciesForTesting();
  await Promise.all([Booking.deleteMany({}), CheckoutSession.deleteMany({})]);
});

test.after(async () => {
  __resetExecuteBookingFinalizeWorkDependenciesForTesting();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('creates Booking with commercialStayFingerprint from session', async () => {
  const ctx = buildFinalizeContext();
  const session = await seedSession({ cabinId: ctx.cabinId, stayFingerprint: buildFingerprint(ctx.cabinId) });

  const result = await executeBookingFinalizeWork({
    session,
    checkoutId: session.checkoutId,
    bookingPayload: buildBookingPayloadFromContext(ctx),
    finalizeContext: ctx
  });

  const saved = await Booking.findById(result.bookingId);
  assert.equal(saved.commercialStayFingerprint, session.stayFingerprint);
  assert.equal(String(saved.checkoutId), session.checkoutId);
});

test('returns { bookingId, booking } on success', async () => {
  const ctx = buildFinalizeContext();
  const session = await seedSession({ cabinId: ctx.cabinId });

  const result = await executeBookingFinalizeWork({
    session,
    checkoutId: session.checkoutId,
    bookingPayload: buildBookingPayloadFromContext(ctx),
    finalizeContext: ctx
  });

  assert.ok(result.bookingId);
  assert.ok(result.booking);
  assert.equal(result.result.idempotentReplay, false);
});

test('replay by checkoutId returns existing booking and does not create second booking', async () => {
  const { checkIn, checkOut } = futureStayDates();
  const ctx = buildFinalizeContext({ checkInDate: checkIn, checkOutDate: checkOut });
  const session = await seedSession({ cabinId: ctx.cabinId });

  await Booking.create({
    checkoutId: session.checkoutId,
    cabinId: ctx.cabinId,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    totalPrice: 400,
    status: 'confirmed',
    commercialStayFingerprint: session.stayFingerprint,
    guestInfo: ctx.guestInfo,
    legalAcceptance: {
      ...buildLegalAcceptance(),
      acceptedAt: new Date(),
      firstName: 'Work',
      lastName: 'Guest'
    }
  });

  const before = await Booking.countDocuments({});
  const result = await executeBookingFinalizeWork({
    session,
    checkoutId: session.checkoutId,
    bookingPayload: buildBookingPayloadFromContext(ctx),
    finalizeContext: ctx
  });
  const after = await Booking.countDocuments({});

  assert.equal(after, before);
  assert.equal(result.result.idempotentReplay, true);
});

test('replay by stripePaymentIntentId returns existing booking and does not create second booking', async () => {
  const { checkIn, checkOut } = futureStayDates();
  const ctx = buildFinalizeContext({
    checkInDate: checkIn,
    checkOutDate: checkOut,
    stripePaymentVerified: true,
    paymentIntentId: 'pi_replay_work_1'
  });
  const session = await seedSession({ cabinId: ctx.cabinId });

  await Booking.create({
    checkoutId: session.checkoutId,
    cabinId: ctx.cabinId,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    totalPrice: 400,
    status: 'confirmed',
    stripePaymentIntentId: 'pi_replay_work_1',
    commercialStayFingerprint: session.stayFingerprint,
    guestInfo: ctx.guestInfo,
    legalAcceptance: {
      ...buildLegalAcceptance(),
      acceptedAt: new Date(),
      firstName: 'Work',
      lastName: 'Guest'
    }
  });

  const before = await Booking.countDocuments({});
  const result = await executeBookingFinalizeWork({
    session,
    checkoutId: session.checkoutId,
    paymentIntentId: 'pi_replay_work_1',
    bookingPayload: buildBookingPayloadFromContext(ctx),
    finalizeContext: ctx
  });
  const after = await Booking.countDocuments({});

  assert.equal(after, before);
  assert.equal(result.result.idempotentReplay, true);
});

test('same PI with different checkoutId throws conflict', async () => {
  const { checkIn, checkOut } = futureStayDates();
  const ctx = buildFinalizeContext({
    checkInDate: checkIn,
    checkOutDate: checkOut,
    stripePaymentVerified: true,
    paymentIntentId: 'pi_conflict_work'
  });
  const session = await seedSession({ cabinId: ctx.cabinId });

  await Booking.create({
    checkoutId: 'chk_other_pi_owner',
    cabinId: ctx.cabinId,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    totalPrice: 400,
    status: 'confirmed',
    stripePaymentIntentId: 'pi_conflict_work',
    commercialStayFingerprint: session.stayFingerprint,
    guestInfo: ctx.guestInfo,
    legalAcceptance: {
      ...buildLegalAcceptance(),
      acceptedAt: new Date(),
      firstName: 'Work',
      lastName: 'Guest'
    }
  });

  await assert.rejects(
    executeBookingFinalizeWork({
      session,
      checkoutId: session.checkoutId,
      paymentIntentId: 'pi_conflict_work',
      bookingPayload: buildBookingPayloadFromContext(ctx),
      finalizeContext: ctx
    }),
    (err) => err.code === 'PAYMENT_INTENT_ALREADY_USED'
  );
});

test('missing session.stayFingerprint throws CHECKOUT_SESSION_NOT_USABLE', async () => {
  const ctx = buildFinalizeContext();
  const session = await seedSession({ cabinId: ctx.cabinId, stayFingerprint: '' });

  await assert.rejects(
    executeBookingFinalizeWork({
      session,
      checkoutId: session.checkoutId,
      bookingPayload: buildBookingPayloadFromContext(ctx),
      finalizeContext: ctx
    }),
    (err) =>
      err instanceof CheckoutSessionError &&
      err.code === CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE
  );
});

test('paid cabin overlap after save throws PAID_BOOKING_SAVE_FAILED with needsReview', async () => {
  const { checkIn, checkOut } = futureStayDates();
  const ctx = buildFinalizeContext({
    checkInDate: checkIn,
    checkOutDate: checkOut,
    stripePaymentVerified: true,
    paymentIntentId: 'pi_paid_overlap'
  });
  const session = await seedSession({ cabinId: ctx.cabinId });
  let recordCalls = 0;
  let recordPayload = null;

  __setExecuteBookingFinalizeWorkDependenciesForTesting({
    countBlockingBlocksForSingleCabin: async () => 1,
    countBlockingBlocksForUnit: async () => 0,
    linkStripePaymentToBooking: async () => ({ status: 'linked' }),
    stripe: createStripeStub().client,
    recordPaidBookingResolutionIssue: async (payload) => {
      recordCalls += 1;
      recordPayload = payload;
      return { _id: new mongoose.Types.ObjectId() };
    }
  });

  await assert.rejects(
    executeBookingFinalizeWork({
      session,
      checkoutId: session.checkoutId,
      paymentIntentId: 'pi_paid_overlap',
      bookingPayload: buildBookingPayloadFromContext(ctx),
      finalizeContext: ctx
    }),
    (err) => {
      assert.equal(err.code, 'PAID_BOOKING_SAVE_FAILED');
      assert.equal(err.needsReview, true);
      assert.ok(err.guestPayload);
      assert.equal(err.guestPayload.code, 'PAYMENT_RECEIVED_BOOKING_NEEDS_REVIEW');
      assert.equal(err.errorCode, 'CABIN_OVERLAP_AFTER_SAVE');
      return true;
    }
  );

  assert.equal(recordCalls, 1);
  assert.equal(recordPayload.issueType, 'paid_booking_conflict');
  assert.equal(recordPayload.errorCode, 'CABIN_OVERLAP_AFTER_SAVE');
  assert.equal(recordPayload.paymentIntentId, 'pi_paid_overlap');

  const remaining = await Booking.find({ checkoutId: session.checkoutId });
  assert.equal(remaining.length, 0);
});

test('calls linkStripePaymentToBooking when paymentIntentId exists', async () => {
  const ctx = buildFinalizeContext({
    stripePaymentVerified: true,
    paymentIntentId: 'pi_link_work'
  });
  const session = await seedSession({ cabinId: ctx.cabinId });
  let linkCalls = 0;

  __setExecuteBookingFinalizeWorkDependenciesForTesting({
    linkStripePaymentToBooking: async () => {
      linkCalls += 1;
      return { status: 'linked' };
    }
  });

  await executeBookingFinalizeWork({
    session,
    checkoutId: session.checkoutId,
    paymentIntentId: 'pi_link_work',
    bookingPayload: buildBookingPayloadFromContext(ctx),
    finalizeContext: ctx
  });

  assert.equal(linkCalls, 1);
});

test('patches Stripe metadata with bookingId when paymentIntentId exists', async () => {
  const ctx = buildFinalizeContext({
    stripePaymentVerified: true,
    paymentIntentId: 'pi_meta_work'
  });
  const session = await seedSession({ cabinId: ctx.cabinId });
  const stripeStub = createStripeStub();

  __setExecuteBookingFinalizeWorkDependenciesForTesting({
    stripe: stripeStub.client,
    linkStripePaymentToBooking: async () => ({ status: 'linked' })
  });

  const result = await executeBookingFinalizeWork({
    session,
    checkoutId: session.checkoutId,
    paymentIntentId: 'pi_meta_work',
    bookingPayload: buildBookingPayloadFromContext(ctx),
    finalizeContext: ctx
  });

  assert.equal(stripeStub.updates.length, 1);
  assert.equal(stripeStub.updates[0].paymentIntentId, 'pi_meta_work');
  assert.equal(stripeStub.updates[0].payload.metadata.bookingId, String(result.bookingId));
});

test('confirms voucher reservation when voucher context exists', async () => {
  const ctx = buildFinalizeContext({
    voucherReservationContext: {
      redemptionId: new mongoose.Types.ObjectId().toString(),
      confirmed: false,
      released: false
    }
  });
  const session = await seedSession({ cabinId: ctx.cabinId });
  let confirmCalls = 0;

  __setExecuteBookingFinalizeWorkDependenciesForTesting({
    confirmVoucherReservation: async () => {
      confirmCalls += 1;
    }
  });

  await executeBookingFinalizeWork({
    session,
    checkoutId: session.checkoutId,
    bookingPayload: buildBookingPayloadFromContext(ctx),
    finalizeContext: ctx
  });

  assert.equal(confirmCalls, 1);
  assert.equal(ctx.voucherReservationContext.confirmed, true);
});

test('voucher confirm failure throws VOUCHER_CONFIRM_FAILED + needsReview', async () => {
  const ctx = buildFinalizeContext({
    stripePaymentVerified: true,
    paymentIntentId: 'pi_voucher_fail',
    voucherReservationContext: {
      redemptionId: new mongoose.Types.ObjectId().toString(),
      confirmed: false,
      released: false
    }
  });
  const session = await seedSession({ cabinId: ctx.cabinId });

  __setExecuteBookingFinalizeWorkDependenciesForTesting({
    confirmVoucherReservation: async () => {
      throw new Error('confirm failed');
    },
    openManualReviewItem: async () => ({ _id: new mongoose.Types.ObjectId() })
  });

  await assert.rejects(
    executeBookingFinalizeWork({
      session,
      checkoutId: session.checkoutId,
      paymentIntentId: 'pi_voucher_fail',
      bookingPayload: buildBookingPayloadFromContext(ctx),
      finalizeContext: ctx
    }),
    (err) => err.code === 'VOUCHER_CONFIRM_FAILED' && err.needsReview === true
  );
});

test('normal save failure throws and does not send email', async () => {
  const ctx = buildFinalizeContext();
  const session = await seedSession({ cabinId: ctx.cabinId });

  const OriginalBooking = Booking;
  class BrokenBooking extends OriginalBooking {
    save() {
      return Promise.reject(new Error('save failed'));
    }
  }

  __setExecuteBookingFinalizeWorkDependenciesForTesting({
    Booking: BrokenBooking
  });

  await assert.rejects(
    executeBookingFinalizeWork({
      session,
      checkoutId: session.checkoutId,
      bookingPayload: buildBookingPayloadFromContext(ctx),
      finalizeContext: ctx
    }),
    (err) => err.message === 'save failed'
  );
});

test('worker imports no email service / lifecycle email', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../services/checkout/executeBookingFinalizeWork.js'),
    'utf8'
  );
  assert.doesNotMatch(source, /bookingLifecycleEmailService/);
  assert.doesNotMatch(source, /emailService/);
  assert.doesNotMatch(source, /sendBookingLifecycleEmail/);
});

test('worker has no Express res/status/json usage', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../services/checkout/executeBookingFinalizeWork.js'),
    'utf8'
  );
  assert.doesNotMatch(source, /res\.status/);
  assert.doesNotMatch(source, /res\.json/);
  assert.doesNotMatch(source, /require\(['"].*\/routes\//);
});

test('no route files changed', () => {
  const bookingRoutesPath = path.join(__dirname, '../routes/bookingRoutes.js');
  const stat = fs.statSync(bookingRoutesPath);
  assert.ok(stat.mtimeMs > 0);
  const { execSync } = require('node:child_process');
  const diff = execSync('git diff --name-only server/routes/bookingRoutes.js', {
    cwd: path.join(__dirname, '../..'),
    encoding: 'utf8'
  }).trim();
  assert.equal(diff, '');
});
