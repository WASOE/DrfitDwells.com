/**
 * Manual reservation purpose + guest confirmation email policy.
 * Run: cd server && node --test scripts/manualReservationEmailPolicy.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const EmailEvent = require('../models/EmailEvent');
const EmailDeliveryState = require('../models/EmailDeliveryState');
const ManualReviewItem = require('../models/ManualReviewItem');
const emailService = require('../services/emailService');
const bookingLifecycleEmailService = require('../services/bookingLifecycleEmailService');
const {
  createManualReservation,
  transitionReservation
} = require('../services/ops/domain/reservationWriteService');
const {
  shouldSendAutomaticGuestConfirmation,
  defaultSendGuestConfirmationForPurpose,
  resolveSendGuestConfirmationEmailAtIntake
} = require('../services/ops/manualReservationEmailPolicy');

let mongoServer;
let originalSendEmail;
let sendEmailCalls;

const minimalEntity = {
  name: 'Policy Test Cabin',
  location: 'Test Valley',
  arrivalWindowDefault: '15:00–18:00'
};

const adminCtx = {
  user: { id: 'admin-policy-test', role: 'admin' },
  route: 'POST /api/ops/reservations/manual'
};

let cabinId;
let guestCounter = 0;
let stayCounter = 0;

function nextGuest(prefix = 'guest') {
  guestCounter += 1;
  return {
    firstName: 'Test',
    lastName: `Guest${guestCounter}`,
    email: `${prefix}.${guestCounter}@manual-policy.test`,
    phone: '+359881234567'
  };
}

function nextDateRange() {
  stayCounter += 1;
  const checkInDay = String(stayCounter).padStart(2, '0');
  const checkOutDay = String(stayCounter + 1).padStart(2, '0');
  return {
    checkInDate: `2026-09-${checkInDay}`,
    checkOutDate: `2026-09-${checkOutDay}`
  };
}

async function createTestCabin() {
  const cabin = await Cabin.create({
    name: `Policy Cabin ${Date.now()}`,
    description: 'Manual reservation policy tests',
    location: 'Bansko',
    imageUrl: '/uploads/cabins/test.jpg',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    isActive: true,
    transportOptions: []
  });
  return String(cabin._id);
}

function stubSendEmailSuccess() {
  sendEmailCalls = 0;
  emailService.sendEmail = async () => {
    sendEmailCalls += 1;
    return { success: true, method: 'sent', messageId: `msg_${sendEmailCalls}` };
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Booking.syncIndexes();
  await Cabin.syncIndexes();
  await EmailEvent.syncIndexes();
  await EmailDeliveryState.syncIndexes();
  await ManualReviewItem.syncIndexes();
  originalSendEmail = emailService.sendEmail.bind(emailService);
  cabinId = await createTestCabin();
});

test.after(async () => {
  emailService.sendEmail = originalSendEmail;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  emailService.sendEmail = originalSendEmail;
  sendEmailCalls = 0;
  stayCounter = 0;
  await Promise.all([
    Booking.deleteMany({}),
    EmailEvent.deleteMany({}),
    EmailDeliveryState.deleteMany({}),
    ManualReviewItem.deleteMany({})
  ]);
});

test('helper: purpose defaults and shouldSendAutomaticGuestConfirmation', () => {
  assert.equal(defaultSendGuestConfirmationForPurpose('paid_guest'), true);
  assert.equal(defaultSendGuestConfirmationForPurpose('creator_influencer'), false);
  assert.equal(resolveSendGuestConfirmationEmailAtIntake('creator_influencer', null), false);
  assert.equal(resolveSendGuestConfirmationEmailAtIntake('paid_guest', null), true);
  assert.equal(resolveSendGuestConfirmationEmailAtIntake('creator_influencer', true), true);

  const guestPortal = {
    provenance: { source: 'guest_portal' },
    sendGuestConfirmationEmail: false
  };
  assert.equal(shouldSendAutomaticGuestConfirmation(guestPortal), true);

  const manualSkip = {
    provenance: { source: 'admin_manual' },
    sendGuestConfirmationEmail: false
  };
  assert.equal(shouldSendAutomaticGuestConfirmation(manualSkip), false);

  const manualLegacy = {
    provenance: { source: 'operator_manual' },
    sendGuestConfirmationEmail: null
  };
  assert.equal(shouldSendAutomaticGuestConfirmation(manualLegacy), true);
});

test('creator_influencer confirmed create with sendGuestConfirmationEmail false -> no automatic booking_confirmed', async () => {
  stubSendEmailSuccess();
  const dates = nextDateRange();
  const result = await createManualReservation({
    cabinId,
    ...dates,
    guestInfo: nextGuest('creator'),
    initialStatus: 'confirmed',
    manualReservationPurpose: 'creator_influencer',
    sendGuestConfirmationEmail: false,
    ctx: { ...adminCtx, idempotencyKey: `creator-confirmed-${guestCounter}` }
  });

  assert.ok(result.reservationId);
  assert.equal(sendEmailCalls, 0);
  const events = await EmailEvent.find({
    bookingId: result.reservationId,
    templateKey: 'booking_confirmed',
    lifecycleSource: 'automatic'
  });
  assert.equal(events.length, 0);
});

test('paid_guest confirmed create default true -> sends', async () => {
  stubSendEmailSuccess();
  const dates = nextDateRange();
  const result = await createManualReservation({
    cabinId,
    ...dates,
    guestInfo: nextGuest('paid'),
    initialStatus: 'confirmed',
    manualReservationPurpose: 'paid_guest',
    ctx: { ...adminCtx, idempotencyKey: `paid-confirmed-${guestCounter}` }
  });

  assert.ok(result.reservationId);
  assert.equal(sendEmailCalls, 1);
  const events = await EmailEvent.find({
    bookingId: result.reservationId,
    templateKey: 'booking_confirmed',
    lifecycleSource: 'automatic'
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].sendStatus, 'success');
});

test('pending creator -> confirm action -> no automatic send', async () => {
  stubSendEmailSuccess();
  const dates = nextDateRange();
  const created = await createManualReservation({
    cabinId,
    ...dates,
    guestInfo: nextGuest('pending-creator'),
    initialStatus: 'pending',
    manualReservationPurpose: 'creator_influencer',
    sendGuestConfirmationEmail: false,
    ctx: { ...adminCtx, idempotencyKey: `pending-creator-${guestCounter}` }
  });

  assert.equal(sendEmailCalls, 0);

  await transitionReservation({
    bookingId: created.reservationId,
    kind: 'confirm',
    ctx: {
      user: adminCtx.user,
      route: 'POST /api/ops/reservations/:id/actions/confirm',
      idempotencyKey: `confirm-creator-${guestCounter}`
    }
  });

  assert.equal(sendEmailCalls, 0);
  const events = await EmailEvent.find({
    bookingId: created.reservationId,
    templateKey: 'booking_confirmed',
    lifecycleSource: 'automatic'
  });
  assert.equal(events.length, 0);
});

test('pending paid guest -> confirm action -> sends', async () => {
  stubSendEmailSuccess();
  const dates = nextDateRange();
  const created = await createManualReservation({
    cabinId,
    ...dates,
    guestInfo: nextGuest('pending-paid'),
    initialStatus: 'pending',
    manualReservationPurpose: 'paid_guest',
    ctx: { ...adminCtx, idempotencyKey: `pending-paid-${guestCounter}` }
  });

  assert.equal(sendEmailCalls, 0);

  await transitionReservation({
    bookingId: created.reservationId,
    kind: 'confirm',
    ctx: {
      user: adminCtx.user,
      route: 'POST /api/ops/reservations/:id/actions/confirm',
      idempotencyKey: `confirm-paid-${guestCounter}`
    }
  });

  assert.equal(sendEmailCalls, 1);
  const events = await EmailEvent.find({
    bookingId: created.reservationId,
    templateKey: 'booking_confirmed',
    lifecycleSource: 'automatic'
  });
  assert.equal(events.length, 1);
});

test('legacy manual with null fields -> confirm sends', async () => {
  stubSendEmailSuccess();
  const dates = nextDateRange();
  const created = await createManualReservation({
    cabinId,
    ...dates,
    guestInfo: nextGuest('legacy'),
    initialStatus: 'pending',
    ctx: { ...adminCtx, idempotencyKey: `legacy-${guestCounter}` }
  });

  const saved = await Booking.findById(created.reservationId).lean();
  assert.equal(saved.manualReservationPurpose, null);
  assert.equal(saved.sendGuestConfirmationEmail, null);

  await transitionReservation({
    bookingId: created.reservationId,
    kind: 'confirm',
    ctx: {
      user: adminCtx.user,
      route: 'POST /api/ops/reservations/:id/actions/confirm',
      idempotencyKey: `confirm-legacy-${guestCounter}`
    }
  });

  assert.equal(sendEmailCalls, 1);
});

test('manual resend still works when automatic send is false', async () => {
  stubSendEmailSuccess();
  const dates = nextDateRange();
  const created = await createManualReservation({
    cabinId,
    ...dates,
    guestInfo: nextGuest('resend'),
    initialStatus: 'confirmed',
    manualReservationPurpose: 'creator_influencer',
    sendGuestConfirmationEmail: false,
    ctx: { ...adminCtx, idempotencyKey: `resend-${guestCounter}` }
  });

  assert.equal(sendEmailCalls, 0);

  const booking = await Booking.findById(created.reservationId);
  const resend = await bookingLifecycleEmailService.sendBookingLifecycleEmail({
    booking,
    templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
    overrideRecipient: null,
    lifecycleSource: 'manual_resend',
    actorContext: { actorId: 'ops-1', actorRole: 'admin' },
    entity: minimalEntity
  });

  assert.equal(resend.success, true);
  assert.equal(sendEmailCalls, 1);
  const events = await EmailEvent.find({
    bookingId: created.reservationId,
    templateKey: 'booking_confirmed',
    lifecycleSource: 'manual_resend'
  });
  assert.equal(events.length, 1);
});

test('skipped automatic send creates no email failure alert', async () => {
  stubSendEmailSuccess();
  const dates = nextDateRange();
  await createManualReservation({
    cabinId,
    ...dates,
    guestInfo: nextGuest('no-alert'),
    initialStatus: 'confirmed',
    manualReservationPurpose: 'staff_stay',
    sendGuestConfirmationEmail: false,
    ctx: { ...adminCtx, idempotencyKey: `no-alert-${guestCounter}` }
  });

  const failedStates = await EmailDeliveryState.countDocuments({ latestStatus: 'failed' });
  const reviewItems = await ManualReviewItem.countDocuments({
    category: 'booking_lifecycle_email_failed'
  });
  assert.equal(failedStates, 0);
  assert.equal(reviewItems, 0);
  assert.equal(sendEmailCalls, 0);
});
