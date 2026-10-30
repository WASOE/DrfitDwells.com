'use strict';

/**
 * Arrival Communications V2 — PR1 + Phase 2B remediation contract tests.
 * No real guest email delivery. Uses mongodb-memory-server + mocked emailService.sendEmail.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const MessageDispatch = require('../models/MessageDispatch');
const ManualReviewItem = require('../models/ManualReviewItem');

const { isArrivalEmailV2Enabled, ENV_ARRIVAL_EMAIL_V2 } = require('../services/messaging/arrival/arrivalFeatureFlags');
const {
  GUEST_CHECK_OUT_BY,
  GUEST_CHECK_IN_FROM,
  VALLEY,
  CABIN,
  valleyTransferOfferLine,
  resolveGuestCheckoutDisplay
} = require('../services/messaging/arrival/arrivalPropertyFacts');
const {
  buildInitialArrivalIdempotencyKey,
  buildResendArrivalIdempotencyKey
} = require('../services/messaging/arrival/arrivalDispatchIdentity');
const { CHECK_OUT_TIME } = require('../utils/dateTime');

let mongoServer;
let sendEmailCalls = [];
let sendEmailImpl = null;

function withFlag(value, fn) {
  const prev = process.env[ENV_ARRIVAL_EMAIL_V2];
  if (value == null) delete process.env[ENV_ARRIVAL_EMAIL_V2];
  else process.env[ENV_ARRIVAL_EMAIL_V2] = value;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prev === undefined) delete process.env[ENV_ARRIVAL_EMAIL_V2];
      else process.env[ENV_ARRIVAL_EMAIL_V2] = prev;
    });
}

function futureStay(checkInDays = 10, nights = 2) {
  const checkIn = new Date(Date.now() + checkInDays * 24 * 3600 * 1000);
  const checkOut = new Date(checkIn.getTime() + nights * 24 * 3600 * 1000);
  return { checkIn, checkOut };
}

async function insertCabin(overrides = {}) {
  const _id = new mongoose.Types.ObjectId();
  await Cabin.collection.insertOne({
    _id,
    propertyKind: 'cabin',
    name: 'The Cabin',
    location: 'Bachevo',
    slug: 'the-cabin',
    meetingPoint: {
      label: 'Park and walk',
      googleMapsUrl: CABIN.parkAndWalkNavigateUrl
    },
    arrivalGuideUrl: '/guides/the-cabin',
    ...overrides
  });
  return _id;
}

async function insertValleyCabin({ name, slug, propertyKind = 'valley' } = {}) {
  const _id = new mongoose.Types.ObjectId();
  await Cabin.collection.insertOne({
    _id,
    propertyKind,
    name,
    slug,
    location: 'The Valley',
    meetingPoint: {
      label: VALLEY.parkingLabel,
      googleMapsUrl: VALLEY.parkingNavigateUrl
    },
    arrivalGuideUrl: '/guides/the-valley'
  });
  return _id;
}

async function insertAFrameType() {
  const _id = new mongoose.Types.ObjectId();
  await CabinType.collection.insertOne({
    _id,
    propertyKind: 'valley',
    name: 'A-Frame',
    slug: 'a-frame',
    arrivalGuideUrl: '/guides/the-valley'
  });
  return _id;
}

async function insertUnit({ cabinTypeId, displayName, unitNumber }) {
  const _id = new mongoose.Types.ObjectId();
  await Unit.collection.insertOne({
    _id,
    cabinTypeId,
    displayName,
    unitNumber,
    status: 'active'
  });
  return _id;
}

async function insertBooking({
  cabinId = null,
  cabinTypeId = null,
  unitId = null,
  craft = undefined,
  guestInfo = undefined,
  overrides = {}
} = {}) {
  const _id = new mongoose.Types.ObjectId();
  const { checkIn, checkOut } = futureStay();
  const {
    craft: craftFromOverrides,
    guestInfo: guestFromOverrides,
    ...rest
  } = overrides;
  await Booking.collection.insertOne({
    _id,
    cabinId,
    cabinTypeId,
    unitId,
    status: 'confirmed',
    paymentStatus: 'paid',
    checkIn,
    checkOut,
    totalPrice: 200,
    guestInfo: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada.arrival.v2.test@example.com',
      phone: '+359888000111',
      ...(guestFromOverrides || {}),
      ...(guestInfo || {})
    },
    craft: craft || craftFromOverrides || undefined,
    ...rest
  });
  return Booking.findById(_id).lean();
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });

  const emailService = require('../services/emailService');
  const originalSend = emailService.sendEmail.bind(emailService);
  emailService.sendEmail = async (opts) => {
    sendEmailCalls.push(opts);
    if (typeof sendEmailImpl === 'function') return sendEmailImpl(opts);
    return { success: true, method: 'sent', messageId: `mock_${sendEmailCalls.length}` };
  };
  emailService.__arrivalV2OriginalSend = originalSend;
});

test.after(async () => {
  const emailService = require('../services/emailService');
  if (emailService.__arrivalV2OriginalSend) {
    emailService.sendEmail = emailService.__arrivalV2OriginalSend;
  }
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  sendEmailCalls = [];
  sendEmailImpl = null;
  await mongoose.connection.dropDatabase();
});

test('ARRIVAL_EMAIL_V2 defaults OFF and enables only on exact "1"', () => {
  delete process.env[ENV_ARRIVAL_EMAIL_V2];
  assert.equal(isArrivalEmailV2Enabled(), false);
  assert.equal(isArrivalEmailV2Enabled({ [ENV_ARRIVAL_EMAIL_V2]: '1' }), true);
  assert.equal(isArrivalEmailV2Enabled({ [ENV_ARRIVAL_EMAIL_V2]: 'true' }), false);
  assert.equal(isArrivalEmailV2Enabled({ [ENV_ARRIVAL_EMAIL_V2]: '0' }), false);
});

test('standard guest checkout is 11:00 and matches CHECK_OUT_TIME', () => {
  assert.equal(CHECK_OUT_TIME, '11:00');
  assert.equal(GUEST_CHECK_OUT_BY, '11:00');
  assert.equal(GUEST_CHECK_IN_FROM, '15:00');
  const standard = resolveGuestCheckoutDisplay({});
  assert.equal(standard.time, '11:00');
  assert.equal(standard.source, 'standard');
  assert.equal(standard.isLateCheckout, false);
});

test('approved late checkout override is honored only when explicitly approved', () => {
  const ignoredFreeText = resolveGuestCheckoutDisplay({
    specialRequests: 'Please late checkout at 12:00'
  });
  assert.equal(ignoredFreeText.time, '11:00');

  const unapprovedExtras = resolveGuestCheckoutDisplay({
    craft: { extras: { approvedLateCheckoutBy: '12:00' } }
  });
  assert.equal(unapprovedExtras.time, '11:00');

  const approved = resolveGuestCheckoutDisplay({
    craft: { extras: { lateCheckoutApproved: true, approvedLateCheckoutBy: '12:00' } }
  });
  assert.equal(approved.time, '12:00');
  assert.equal(approved.source, 'approved_late_checkout');
  assert.equal(approved.isLateCheckout, true);
});

test('Valley transfer line uses EUR and Anife phone', () => {
  const line = valleyTransferOfferLine();
  assert.match(line, /EUR 20/);
  assert.match(line, /EUR 30/);
  assert.match(line, /087 954 7051/);
});

test('Cabin Navigate destination is Park and walk, never building pin', () => {
  assert.match(CABIN.parkAndWalkNavigateUrl, /41\.93357665629961/);
  assert.doesNotMatch(CABIN.parkAndWalkNavigateUrl, /41\.930873/);
});

test('idempotency keys: booking-scoped initial + operationId resend', () => {
  const bookingId = '507f1f77bcf86cd799439011';
  assert.equal(buildInitialArrivalIdempotencyKey(bookingId), `arrival_v2:email:${bookingId}:initial`);
  assert.equal(
    buildResendArrivalIdempotencyKey(bookingId, 'ops_arrival_resend_abc-def'),
    `arrival_v2:email:${bookingId}:resend:ops_arrival_resend_abc-def`
  );
});

test('Valley / Cabin / unit facilities compose with standard 11:00 checkout', async () => {
  const { composeArrivalGuestEmail } = require('../services/messaging/arrival/arrivalEmailComposer');

  const luxId = await insertValleyCabin({ name: 'Lux Cabin', slug: 'lux-cabin' });
  const luxBooking = await insertBooking({ cabinId: luxId });
  const lux = await composeArrivalGuestEmail({ booking: luxBooking, purpose: 'confirmation' });
  assert.equal(lux.ok, true);
  assert.match(lux.text, /Checkout: by 11:00/);
  assert.match(lux.text, /pet-free/i);
  assert.doesNotMatch(lux.text, /12:00/);
  assert.doesNotMatch(lux.text, /three days/i);
  assert.doesNotMatch(lux.text, /automatic reminder/i);

  const stoneId = await insertValleyCabin({ name: 'Stone House', slug: 'stone-house' });
  const stone = await composeArrivalGuestEmail({
    booking: await insertBooking({ cabinId: stoneId }),
    purpose: 'arrival'
  });
  assert.match(stone.text, /Starlink/i);
  assert.match(stone.text, /11:00/);

  const cabinId = await insertCabin();
  const cabin = await composeArrivalGuestEmail({
    booking: await insertBooking({ cabinId }),
    purpose: 'arrival'
  });
  assert.match(cabin.html, /Park and walk/);
  assert.match(cabin.html, /earth\.google\.com/);
  assert.doesNotMatch(cabin.html, /destination=41\.93087/);
  assert.match(cabin.text, /Checkout by 11:00/);

  const cabinTypeId = await insertAFrameType();
  const unitId = await insertUnit({ cabinTypeId, displayName: 'A-Frame 2', unitNumber: '2' });
  const aframe = await composeArrivalGuestEmail({
    booking: await insertBooking({ cabinTypeId, unitId }),
    purpose: 'arrival'
  });
  assert.equal(aframe.propertyName, 'A-Frame 2');
  assert.match(aframe.text, /shared Stone House/i);
});

test('explicit approved late checkout appears only for that booking', async () => {
  const { composeArrivalGuestEmail } = require('../services/messaging/arrival/arrivalEmailComposer');
  const cabinId = await insertCabin();
  const booking = await insertBooking({
    cabinId,
    craft: { extras: { lateCheckoutApproved: true, approvedLateCheckoutBy: '12:00' } }
  });
  const composed = await composeArrivalGuestEmail({ booking, purpose: 'confirmation' });
  assert.equal(composed.ok, true);
  assert.equal(composed.checkoutTime, '12:00');
  assert.match(composed.text, /Checkout: by 12:00/);
  assert.doesNotMatch(composed.text, /EUR \d+.*late checkout/i);
});

test('definitive pre-provider failure is recoverable on same initial key', async () => {
  await withFlag('1', async () => {
    const { sendArrivalEmailV2 } = require('../services/messaging/arrival/arrivalEmailSendService');
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });

    sendEmailImpl = async () => ({ success: true, method: 'logged', messageId: 'log_1' });
    const first = await sendArrivalEmailV2({ booking, kind: 'send' });
    assert.equal(first.ok, false);
    assert.equal(first.retriable, true);
    assert.equal(first.uncertain, false);

    const row = await MessageDispatch.findById(first.dispatchId).lean();
    assert.equal(row.status, 'failed');
    assert.equal(row.details.retriable, true);
    assert.equal(row.details.phase, 'pre_provider_failed');

    sendEmailImpl = async () => ({ success: true, method: 'sent', messageId: 'msg_recovered' });
    const second = await sendArrivalEmailV2({ booking, kind: 'send' });
    assert.equal(second.ok, true);
    assert.equal(second.status, 'accepted');
    assert.equal(second.duplicate, false);
    assert.equal(String(second.dispatchId), String(first.dispatchId));
    assert.equal(second.providerMessageId, 'msg_recovered');

    const rows = await MessageDispatch.find({
      idempotencyKey: buildInitialArrivalIdempotencyKey(booking._id)
    }).lean();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'accepted');
  });
});

test('ambiguous provider throw remains non-retriable on same key', async () => {
  await withFlag('1', async () => {
    const { sendArrivalEmailV2 } = require('../services/messaging/arrival/arrivalEmailSendService');
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });

    sendEmailImpl = async () => {
      throw new Error('SMTP socket hang up');
    };
    const first = await sendArrivalEmailV2({ booking, kind: 'send' });
    assert.equal(first.ok, false);
    assert.equal(first.uncertain, true);

    const smtpBefore = sendEmailCalls.length;
    const second = await sendArrivalEmailV2({ booking, kind: 'send' });
    assert.equal(second.ok, false);
    assert.equal(second.uncertain, true);
    assert.equal(sendEmailCalls.length, smtpBefore);
  });
});

test('manual send accepted + durable duplicate; resend needs operationId', async () => {
  await withFlag('1', async () => {
    const { sendArrivalEmailV2 } = require('../services/messaging/arrival/arrivalEmailSendService');
    const cabinId = await insertValleyCabin({ name: 'Lux Cabin', slug: 'lux-cabin' });
    const booking = await insertBooking({ cabinId });

    const first = await sendArrivalEmailV2({ booking, kind: 'send', actor: { id: 'ops1', role: 'admin' } });
    assert.equal(first.ok, true);
    const dup = await sendArrivalEmailV2({ booking, kind: 'send' });
    assert.equal(dup.duplicate, true);
    assert.equal(sendEmailCalls.length, 1);

    await assert.rejects(() => sendArrivalEmailV2({ booking, kind: 'resend' }), /operationId|idempotency/i);
    const op = 'ops_arrival_resend_aaaaaaaa';
    const r1 = await sendArrivalEmailV2({ booking, kind: 'resend', operationId: op });
    assert.equal(r1.ok, true);
    const r2 = await sendArrivalEmailV2({ booking, kind: 'resend', operationId: op });
    assert.equal(r2.duplicate, true);
    assert.equal(sendEmailCalls.length, 2);
  });
});

test('pending dispatch blocks duplicate SMTP', async () => {
  await withFlag('1', async () => {
    const { sendArrivalEmailV2 } = require('../services/messaging/arrival/arrivalEmailSendService');
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });
    await MessageDispatch.create({
      scheduledMessageJobId: null,
      bookingId: booking._id,
      ruleKey: 'manual_arrival_send',
      templateKey: 'arrival_3d_the_cabin',
      templateVersion: 1,
      channel: 'email',
      recipient: 'ada.arrival.v2.test@example.com',
      lifecycleSource: 'manual_first_send',
      status: 'pending',
      providerName: 'postmark',
      idempotencyKey: buildInitialArrivalIdempotencyKey(booking._id),
      details: { shadow: false, phase: 'sending', arrivalEmailV2: true }
    });
    const blocked = await sendArrivalEmailV2({ booking, kind: 'send' });
    assert.equal(blocked.code, 'dispatch_pending_requires_review');
    assert.equal(sendEmailCalls.length, 0);
  });
});

test('concurrent initial sends: only one SMTP under unique idempotency key', async () => {
  await withFlag('1', async () => {
    const { sendArrivalEmailV2 } = require('../services/messaging/arrival/arrivalEmailSendService');
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });

    let releaseSend;
    const gate = new Promise((resolve) => {
      releaseSend = resolve;
    });
    let entered = 0;
    sendEmailImpl = async () => {
      entered += 1;
      await gate;
      return { success: true, method: 'sent', messageId: 'concurrent_1' };
    };

    const p1 = sendArrivalEmailV2({ booking, kind: 'send' });
    await new Promise((r) => setTimeout(r, 30));
    const p2 = sendArrivalEmailV2({ booking, kind: 'send' });
    releaseSend();
    const [r1, r2] = await Promise.all([p1, p2]);

    assert.ok([r1, r2].some((r) => r.ok));
    assert.equal(entered, 1);
    const rows = await MessageDispatch.find({
      idempotencyKey: buildInitialArrivalIdempotencyKey(booking._id)
    }).lean();
    assert.equal(rows.length, 1);
  });
});

test('confirmation prep failure opens MRI and does not claim complete instructions', async () => {
  await withFlag('1', async () => {
    const bookingLifecycleEmailService = require('../services/bookingLifecycleEmailService');
    const cabinId = await insertCabin();
    // Force unresolved property by wiping propertyKind resolution: use cabin without propertyKind
    await Cabin.collection.updateOne({ _id: cabinId }, { $unset: { propertyKind: 1 }, $set: { name: 'Unknown Stay Xyz' } });
    const booking = await insertBooking({ cabinId });

    const preview = await bookingLifecycleEmailService.previewGuestLifecycleEmail({
      booking,
      templateKey: 'booking_confirmed'
    });
    assert.match(preview.html, /full arrival preparation guide could not be attached/i);
    assert.doesNotMatch(preview.html, /a few days before you travel/);
    assert.match(preview.text, /IMPORTANT:/);

    const mri = await ManualReviewItem.findOne({
      category: 'comms_arrival_confirmation_prep_failed',
      entityId: String(booking._id)
    }).lean();
    assert.ok(mri);
    assert.equal(mri.status, 'open');
    assert.equal(mri.severity, 'high');
  });
});

test('ops communicationWriteService: flag-off fails closed; resend without opId rejected', async () => {
  const { sendArrivalInstructions } = require('../services/ops/domain/communicationWriteService');
  const cabinId = await insertCabin();
  const booking = await insertBooking({ cabinId });
  const ctx = { user: { id: 'admin1', role: 'admin' }, req: { headers: {}, body: {} }, route: 'test' };

  await withFlag(undefined, async () => {
    await assert.rejects(
      () => sendArrivalInstructions({ bookingId: booking._id, kind: 'send', ctx }),
      (err) => /disabled|not available/i.test(String(err.message || err))
    );
  });

  await withFlag('1', async () => {
    await assert.rejects(
      () => sendArrivalInstructions({ bookingId: booking._id, kind: 'resend', ctx }),
      (err) => /operationId/i.test(String(err.message || err))
    );
  });
});

test('print checklist Navigate uses Park and walk coords', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const printHtml = fs.readFileSync(
    path.join(__dirname, '../../client/public/guides/the-cabin/arrival-pack-print.html'),
    'utf8'
  );
  assert.match(printHtml, /Park and walk/);
  assert.match(printHtml, /41\.933577/);
});
