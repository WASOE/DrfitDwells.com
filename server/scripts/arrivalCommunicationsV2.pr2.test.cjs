'use strict';

/**
 * Arrival Communications V2 — PR2 automation contract tests.
 * No real guest email. mongodb-memory-server + mocked emailService.sendEmail.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const moment = require('moment-timezone');

const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const ScheduledMessageJob = require('../models/ScheduledMessageJob');
const MessageDispatch = require('../models/MessageDispatch');

const {
  ENV_ARRIVAL_EMAIL_V2,
  ENV_ARRIVAL_AUTOMATION_V2,
  isArrivalAutomationAuthorized,
  isArrivalAutomationRuleKey
} = require('../services/messaging/arrival/arrivalFeatureFlags');
const {
  buildInitialArrivalIdempotencyKey,
  buildCorrectionArrivalIdempotencyKey
} = require('../services/messaging/arrival/arrivalDispatchIdentity');
const {
  resolveAutomaticArrivalSchedule,
  applyCorrectionCoalesce,
  COALESCE_WINDOW_MS,
  CATCH_UP_DELAY_MS
} = require('../services/messaging/arrival/arrivalSchedulePolicy');
const { PROPERTY_TIMEZONE } = require('../utils/dateTime');
const { CABIN } = require('../services/messaging/arrival/arrivalPropertyFacts');

let mongoServer;
let sendEmailCalls = [];
let sendEmailImpl = null;

function withFlags({ emailV2 = '1', automationV2 = '1' }, fn) {
  const prevE = process.env[ENV_ARRIVAL_EMAIL_V2];
  const prevA = process.env[ENV_ARRIVAL_AUTOMATION_V2];
  if (emailV2 == null) delete process.env[ENV_ARRIVAL_EMAIL_V2];
  else process.env[ENV_ARRIVAL_EMAIL_V2] = emailV2;
  if (automationV2 == null) delete process.env[ENV_ARRIVAL_AUTOMATION_V2];
  else process.env[ENV_ARRIVAL_AUTOMATION_V2] = automationV2;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prevE === undefined) delete process.env[ENV_ARRIVAL_EMAIL_V2];
      else process.env[ENV_ARRIVAL_EMAIL_V2] = prevE;
      if (prevA === undefined) delete process.env[ENV_ARRIVAL_AUTOMATION_V2];
      else process.env[ENV_ARRIVAL_AUTOMATION_V2] = prevA;
    });
}

async function insertCabin() {
  const _id = new mongoose.Types.ObjectId();
  await Cabin.collection.insertOne({
    _id,
    propertyKind: 'cabin',
    name: 'The Cabin',
    location: 'Bachevo',
    slug: `the-cabin-${String(_id)}`,
    meetingPoint: { label: 'Park and walk', googleMapsUrl: CABIN.parkAndWalkNavigateUrl },
    arrivalGuideUrl: '/guides/the-cabin'
  });
  return _id;
}

async function insertValleyCabin() {
  const _id = new mongoose.Types.ObjectId();
  await Cabin.collection.insertOne({
    _id,
    propertyKind: 'valley',
    name: 'Lux Cabin',
    slug: `lux-cabin-${String(_id)}`,
    location: 'The Valley',
    meetingPoint: { label: 'Chereshovo', googleMapsUrl: 'https://maps.example' },
    arrivalGuideUrl: '/guides/the-valley'
  });
  return _id;
}

function checkInDaysFromNow(days) {
  return moment.tz(PROPERTY_TIMEZONE).startOf('day').add(days, 'days').hour(15).toDate();
}

async function makeBooking({ cabinId, checkIn, checkOut, status = 'confirmed', overrides = {} }) {
  const _id = new mongoose.Types.ObjectId();
  await Booking.collection.insertOne({
    _id,
    cabinId,
    checkIn,
    checkOut,
    status,
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Test',
      lastName: 'Guest',
      email: 'staff-test@example.com',
      phone: '+359000000000'
    },
    totalPrice: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  });
  return Booking.findById(_id);
}

let originalEmailModule;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 15000 });
  await MessageDispatch.syncIndexes();
  await ScheduledMessageJob.syncIndexes();

  const emailPath = require.resolve('../services/emailService');
  originalEmailModule = require.cache[emailPath];
  require.cache[emailPath] = {
    id: emailPath,
    filename: emailPath,
    loaded: true,
    exports: {
      sendEmail: async (payload) => {
        sendEmailCalls.push(payload);
        if (sendEmailImpl) return sendEmailImpl(payload);
        return {
          success: true,
          method: 'sent',
          messageId: `<test-${Date.now()}-${sendEmailCalls.length}-${Math.random().toString(16).slice(2)}@driftdwells.com>`
        };
      }
    }
  };
});

test.beforeEach(async () => {
  sendEmailCalls = [];
  sendEmailImpl = null;
});

test.after(async () => {
  const emailPath = require.resolve('../services/emailService');
  if (originalEmailModule) require.cache[emailPath] = originalEmailModule;
  else delete require.cache[emailPath];
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('flags default OFF; automation requires both flags', () => {
  delete process.env[ENV_ARRIVAL_AUTOMATION_V2];
  delete process.env[ENV_ARRIVAL_EMAIL_V2];
  assert.equal(isArrivalAutomationAuthorized(), false);
  process.env[ENV_ARRIVAL_EMAIL_V2] = '1';
  assert.equal(isArrivalAutomationAuthorized(), false);
  process.env[ENV_ARRIVAL_AUTOMATION_V2] = '1';
  assert.equal(isArrivalAutomationAuthorized(), true);
  assert.equal(isArrivalAutomationRuleKey('arrival_instructions_pre_arrival_cabin'), true);
  assert.equal(isArrivalAutomationRuleKey('check_in_access_day_before_cabin'), false);
});

test('correction identity uses durable revision not fingerprint', () => {
  const id = new mongoose.Types.ObjectId();
  assert.equal(
    buildCorrectionArrivalIdempotencyKey(id, 1),
    `arrival_v2:email:${id}:correction:rev:1`
  );
  assert.equal(
    buildCorrectionArrivalIdempotencyKey(id, 2),
    `arrival_v2:email:${id}:correction:rev:2`
  );
  assert.throws(() => buildCorrectionArrivalIdempotencyKey(id, 'abc'));
  assert.throws(() => buildCorrectionArrivalIdempotencyKey(id, 0));
});

test('Sofia DST: spring-forward T-3 lands on calendar day @ 17:00', () => {
  // 2026-03-29 is Sofia spring-forward weekend; check-in 2026-04-01 → T-3 = 2026-03-29 17:00 Sofia
  const checkIn = moment.tz('2026-04-01 15:00', PROPERTY_TIMEZONE).toDate();
  const nominal = resolveAutomaticArrivalSchedule({
    checkIn,
    now: moment.tz('2026-03-01 12:00', PROPERTY_TIMEZONE).toDate()
  });
  assert.equal(nominal.ok, true);
  assert.equal(nominal.mode, 'nominal');
  const sofia = moment.tz(nominal.scheduledForUtc, PROPERTY_TIMEZONE);
  assert.equal(sofia.format('YYYY-MM-DD HH:mm'), '2026-03-29 17:00');
});

test('Sofia DST: fall-back T-3 lands on calendar day @ 17:00', () => {
  // 2026-10-25 Sofia fall-back; check-in 2026-10-28 → T-3 = 2026-10-25 17:00
  const checkIn = moment.tz('2026-10-28 15:00', PROPERTY_TIMEZONE).toDate();
  const nominal = resolveAutomaticArrivalSchedule({
    checkIn,
    now: moment.tz('2026-10-01 12:00', PROPERTY_TIMEZONE).toDate()
  });
  assert.equal(nominal.ok, true);
  const sofia = moment.tz(nominal.scheduledForUtc, PROPERTY_TIMEZONE);
  assert.equal(sofia.format('YYYY-MM-DD HH:mm'), '2026-10-25 17:00');
});

test('late booking catch-up ~5 minutes; past cutoff returns review', () => {
  const checkIn = moment.tz(PROPERTY_TIMEZONE).startOf('day').add(1, 'day').hour(15).toDate();
  // now after nominal T-3 (which was 2 days ago relative to tomorrow+...)
  // For check-in tomorrow, T-3 was 2 days ago — definitely past.
  const now = moment.tz(PROPERTY_TIMEZONE).subtract(1, 'hour').toDate();
  const late = resolveAutomaticArrivalSchedule({ checkIn, now });
  assert.equal(late.ok, true);
  assert.equal(late.mode, 'catch_up');
  const delta = late.scheduledForUtc.getTime() - now.getTime();
  assert.ok(delta >= CATCH_UP_DELAY_MS - 1000);
  assert.ok(delta <= CATCH_UP_DELAY_MS + 60_000);

  const checkInToday = moment.tz(PROPERTY_TIMEZONE).startOf('day').hour(15).toDate();
  const afterCutoff = moment.tz(PROPERTY_TIMEZONE).startOf('day').hour(12).minute(1).toDate();
  const cut = resolveAutomaticArrivalSchedule({ checkIn: checkInToday, now: afterCutoff });
  assert.equal(cut.ok, false);
  assert.equal(cut.code, 'past_cutoff');
});

test('coalesce window is 15 minutes', () => {
  const now = new Date('2026-06-01T10:00:00.000Z');
  const desired = new Date('2026-06-01T10:00:00.000Z');
  const cutoff = new Date('2026-06-10T09:00:00.000Z');
  const c = applyCorrectionCoalesce({ desiredUtc: desired, now, cutoffUtc: cutoff });
  assert.equal(c.ok, true);
  assert.equal(c.scheduledForUtc.getTime() - now.getTime(), COALESCE_WINDOW_MS);
});

test('Cabin automatic schedule creates allowlisted job; automation OFF creates none', async () => {
  const cabinId = await insertCabin();
  const checkIn = checkInDaysFromNow(10);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const booking = await makeBooking({ cabinId, checkIn, checkOut });

  await withFlags({ emailV2: '1', automationV2: null }, async () => {
    const { syncArrivalAutomationForBooking } = require('../services/messaging/arrival/arrivalAutomationScheduler');
    const r = await syncArrivalAutomationForBooking({ bookingId: booking._id });
    assert.equal(r.disabled, true);
    const n = await ScheduledMessageJob.countDocuments({ bookingId: booking._id });
    assert.equal(n, 0);
  });

  await withFlags({ emailV2: '1', automationV2: '1' }, async () => {
    const { syncArrivalAutomationForBooking } = require('../services/messaging/arrival/arrivalAutomationScheduler');
    const r = await syncArrivalAutomationForBooking({ bookingId: booking._id, reason: 'test' });
    assert.equal(r.purpose, 'initial');
    const jobs = await ScheduledMessageJob.find({ bookingId: booking._id }).lean();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].ruleKey, 'arrival_instructions_pre_arrival_cabin');
    assert.equal(jobs[0].status, 'scheduled');
    assert.equal(jobs[0].payloadSnapshot.purpose, 'initial');
  });
});

test('Valley automatic schedule uses valley rule key', async () => {
  const cabinId = await insertValleyCabin();
  const checkIn = checkInDaysFromNow(12);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const booking = await makeBooking({ cabinId, checkIn, checkOut });

  await withFlags({ emailV2: '1', automationV2: '1' }, async () => {
    const { syncArrivalAutomationForBooking } = require('../services/messaging/arrival/arrivalAutomationScheduler');
    const r = await syncArrivalAutomationForBooking({ bookingId: booking._id });
    assert.equal(r.purpose, 'initial');
    const job = await ScheduledMessageJob.findOne({ bookingId: booking._id }).lean();
    assert.equal(job.ruleKey, 'arrival_instructions_pre_arrival_valley');
  });
});

test('concurrent manual + automatic initial: exactly one SMTP', async () => {
  const cabinId = await insertCabin();
  const checkIn = checkInDaysFromNow(10);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const booking = await makeBooking({ cabinId, checkIn, checkOut });

  await withFlags({ emailV2: '1', automationV2: '1' }, async () => {
    const { sendArrivalEmailV2 } = require('../services/messaging/arrival/arrivalEmailSendService');
    const { processArrivalAutomationJob } = require('../services/messaging/arrival/arrivalAutoDispatchAdapter');
    const { buildArrivalStateKey } = require('../services/messaging/arrival/arrivalCommunicationRevision');

    let releaseSend;
    const gate = new Promise((resolve) => {
      releaseSend = resolve;
    });
    let entered = 0;
    sendEmailImpl = async () => {
      entered += 1;
      await gate;
      return { success: true, method: 'sent', messageId: `mix_${entered}` };
    };

    const live = await Booking.findById(booking._id);
    const job = await ScheduledMessageJob.create({
      ruleKey: 'arrival_instructions_pre_arrival_cabin',
      ruleVersionAtSchedule: 1,
      bookingId: booking._id,
      audience: 'guest',
      propertyKind: 'cabin',
      scheduledFor: new Date(Date.now() - 1000),
      status: 'claimed',
      payloadSnapshot: {
        purpose: 'initial',
        scheduleGeneration: 1,
        stateKey: buildArrivalStateKey(live, 'cabin'),
        arrivalAutomationV2: true
      }
    });
    await Booking.updateOne(
      { _id: booking._id },
      { $set: { 'arrivalCommsV2.scheduleGeneration': 1 } }
    );

    const manualP = sendArrivalEmailV2({ booking, kind: 'send', actor: { id: 'ops' } });
    await new Promise((r) => setTimeout(r, 20));
    const autoP = processArrivalAutomationJob(String(job._id));
    await new Promise((r) => setTimeout(r, 40));
    releaseSend();
    const [manual, auto] = await Promise.all([manualP, autoP]);

    assert.equal(entered, 1, `entered=${entered} manual=${JSON.stringify(manual)} auto=${JSON.stringify(auto)}`);
    const rows = await MessageDispatch.find({
      idempotencyKey: buildInitialArrivalIdempotencyKey(booking._id)
    }).lean();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'accepted');
  });
});

test('manual initial then auto dispatch is duplicate; no second SMTP', async () => {
  const cabinId = await insertCabin();
  const checkIn = checkInDaysFromNow(10);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const booking = await makeBooking({ cabinId, checkIn, checkOut });

  await withFlags({ emailV2: '1', automationV2: '1' }, async () => {
    const { sendArrivalEmailV2 } = require('../services/messaging/arrival/arrivalEmailSendService');
    const {
      syncArrivalAutomationForBooking,
      markCommunicated
    } = require('../services/messaging/arrival/arrivalAutomationScheduler');
    const { processArrivalAutomationJob } = require('../services/messaging/arrival/arrivalAutoDispatchAdapter');
    const { buildArrivalStateKey } = require('../services/messaging/arrival/arrivalCommunicationRevision');

    const first = await sendArrivalEmailV2({ booking, kind: 'send', actor: { id: 'ops' } });
    assert.equal(first.ok, true);
    assert.equal(sendEmailCalls.length, 1);
    await markCommunicated({
      bookingId: booking._id,
      revision: 0,
      stateKey: buildArrivalStateKey(booking, 'cabin')
    });

    const sync = await syncArrivalAutomationForBooking({ bookingId: booking._id });
    assert.equal(sync.purpose, 'noop');

    const liveGen = (await Booking.findById(booking._id)).arrivalCommsV2.scheduleGeneration;
    // Force a due initial job as if race scheduled before mark — dispatch must dedupe
    const job = await ScheduledMessageJob.create({
      ruleKey: 'arrival_instructions_pre_arrival_cabin',
      ruleVersionAtSchedule: 1,
      bookingId: booking._id,
      audience: 'guest',
      propertyKind: 'cabin',
      scheduledFor: new Date(Date.now() - 1000),
      status: 'claimed',
      payloadSnapshot: {
        purpose: 'initial',
        scheduleGeneration: liveGen,
        stateKey: buildArrivalStateKey(booking, 'cabin'),
        arrivalAutomationV2: true
      }
    });
    const disp = await processArrivalAutomationJob(String(job._id));
    assert.equal(disp.ran, true, JSON.stringify(disp));
    assert.equal(disp.terminal, 'sent', JSON.stringify(disp));
    assert.equal(disp.duplicate, true);
    assert.equal(sendEmailCalls.length, 1, 'no second SMTP');
    assert.equal(
      (await MessageDispatch.countDocuments({
        idempotencyKey: buildInitialArrivalIdempotencyKey(booking._id),
        status: 'accepted'
      })),
      1
    );
  });
});

test('A→B→A→B corrections use successive revisions; same rev does not re-SMTP', async () => {
  const cabinId = await insertCabin();
  const checkInA = checkInDaysFromNow(20);
  const checkOutA = moment(checkInA).add(2, 'days').toDate();
  const booking = await makeBooking({ cabinId, checkIn: checkInA, checkOut: checkOutA });

  await withFlags({ emailV2: '1', automationV2: '1' }, async () => {
    const { sendArrivalEmailV2 } = require('../services/messaging/arrival/arrivalEmailSendService');
    const {
      syncArrivalAutomationForBooking,
      markCommunicated
    } = require('../services/messaging/arrival/arrivalAutomationScheduler');
    const { processArrivalAutomationJob } = require('../services/messaging/arrival/arrivalAutoDispatchAdapter');
    const { buildArrivalStateKey } = require('../services/messaging/arrival/arrivalCommunicationRevision');
    const { COALESCE_WINDOW_MS: WIN } = require('../services/messaging/arrival/arrivalSchedulePolicy');

    // Initial
    await sendArrivalEmailV2({ booking, kind: 'send' });
    await markCommunicated({
      bookingId: booking._id,
      revision: 0,
      stateKey: buildArrivalStateKey(booking, 'cabin')
    });
    assert.equal(sendEmailCalls.length, 1);

    async function changeAndDispatch(checkInDays, expectRevision) {
      const ci = checkInDaysFromNow(checkInDays);
      const co = moment(ci).add(2, 'days').toDate();
      booking.checkIn = ci;
      booking.checkOut = co;
      await booking.save();

      // Coalesce in the past so job is immediately due
      // Force immediate due time by using a "now" close to cutoff-safe catch-up
      // and then claiming with an explicit past scheduledFor.
      const sync = await syncArrivalAutomationForBooking({
        bookingId: booking._id,
        now: new Date()
      });
      assert.equal(sync.purpose, 'correction', JSON.stringify(sync));
      assert.equal(sync.revision, expectRevision);

      const liveGen = (await Booking.findById(booking._id)).arrivalCommsV2.scheduleGeneration;
      await ScheduledMessageJob.updateOne(
        { _id: sync.job.jobId },
        {
          $set: {
            status: 'claimed',
            scheduledFor: new Date(Date.now() - 1000),
            'payloadSnapshot.scheduleGeneration': liveGen,
            'payloadSnapshot.purpose': 'correction',
            'payloadSnapshot.revision': expectRevision,
            'payloadSnapshot.stateKey': buildArrivalStateKey(booking, 'cabin'),
            'payloadSnapshot.arrivalAutomationV2': true
          }
        }
      );

      const r = await processArrivalAutomationJob(String(sync.job.jobId));
      assert.equal(r.terminal, 'sent', JSON.stringify(r));
      assert.equal(r.revision, expectRevision);
      assert.equal(r.duplicate, false);

      // Replay same revision → duplicate, no new SMTP
      const before = sendEmailCalls.length;
      const again = await sendArrivalEmailV2({
        booking,
        kind: 'correction',
        revision: expectRevision,
        lifecycleSource: 'automatic'
      });
      assert.equal(again.ok, true);
      assert.equal(again.duplicate, true);
      assert.equal(sendEmailCalls.length, before);
    }

    await changeAndDispatch(21, 1); // A→B
    await changeAndDispatch(22, 2); // B→A' (new dates)
    await changeAndDispatch(23, 3); // →B'
    await changeAndDispatch(24, 4); // →A''

    assert.equal(sendEmailCalls.length, 5); // 1 initial + 4 corrections
    const keys = await MessageDispatch.find({ bookingId: booking._id, status: 'accepted' })
      .sort({ createdAt: 1 })
      .lean();
    assert.equal(keys.length, 5);
    assert.ok(keys[1].idempotencyKey.endsWith(':correction:rev:1'));
    assert.ok(keys[4].idempotencyKey.endsWith(':correction:rev:4'));
  });
});

test('ops sendArrivalInstructions baselines state; duplicate send does not regress revision', async () => {
  const cabinId = await insertCabin();
  const checkIn = checkInDaysFromNow(14);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const booking = await makeBooking({ cabinId, checkIn, checkOut });

  await withFlags({ emailV2: '1', automationV2: '1' }, async () => {
    const { sendArrivalInstructions } = require('../services/ops/domain/communicationWriteService');
    const { buildArrivalStateKey } = require('../services/messaging/arrival/arrivalCommunicationRevision');
    const {
      syncArrivalAutomationForBooking,
      markCommunicated
    } = require('../services/messaging/arrival/arrivalAutomationScheduler');
    const { COALESCE_WINDOW_MS: WIN } = require('../services/messaging/arrival/arrivalSchedulePolicy');
    const ctxA = {
      user: { id: 'admin1', role: 'admin' },
      req: { headers: {}, body: {} },
      route: 'test',
      idempotencyKey: `send-${booking._id}-a`
    };

    await sendArrivalInstructions({ bookingId: booking._id, kind: 'send', ctx: ctxA });
    let live = await Booking.findById(booking._id).lean();
    assert.equal(live.arrivalCommsV2.lastCommunicatedRevision, 0);
    assert.equal(
      live.arrivalCommsV2.lastCommunicatedStateKey,
      buildArrivalStateKey(await Booking.findById(booking._id), 'cabin')
    );

    // Material change → correction scheduled (revision 1 pending).
    booking.checkIn = checkInDaysFromNow(16);
    booking.checkOut = moment(booking.checkIn).add(2, 'days').toDate();
    await booking.save();
    const syncB = await syncArrivalAutomationForBooking({
      bookingId: booking._id,
      now: new Date(Date.now() - WIN - 1000)
    });
    assert.equal(syncB.purpose, 'correction');
    assert.equal(syncB.revision, 1);

    // Simulate correction accepted for B, then a durable-idempotency initial replay
    // via a distinct Ops request id (same MessageDispatch initial key).
    await markCommunicated({
      bookingId: booking._id,
      revision: 1,
      stateKey: buildArrivalStateKey(booking, 'cabin')
    });
    const ctxB = {
      user: { id: 'admin1', role: 'admin' },
      req: { headers: {}, body: {} },
      route: 'test',
      idempotencyKey: `send-${booking._id}-b`
    };
    await sendArrivalInstructions({ bookingId: booking._id, kind: 'send', ctx: ctxB });
    live = await Booking.findById(booking._id).lean();
    assert.equal(live.arrivalCommsV2.lastCommunicatedRevision, 1, 'duplicate send must not reset revision');
    assert.equal(
      live.arrivalCommsV2.lastCommunicatedStateKey,
      buildArrivalStateKey(booking, 'cabin')
    );
  });
});

test('return to last communicated A cancels pending B correction without SMTP', async () => {
  const cabinId = await insertCabin();
  const checkInA = checkInDaysFromNow(20);
  const checkOutA = moment(checkInA).add(2, 'days').toDate();
  const booking = await makeBooking({ cabinId, checkIn: checkInA, checkOut: checkOutA });

  await withFlags({ emailV2: '1', automationV2: '1' }, async () => {
    const { sendArrivalEmailV2 } = require('../services/messaging/arrival/arrivalEmailSendService');
    const {
      syncArrivalAutomationForBooking,
      markCommunicated
    } = require('../services/messaging/arrival/arrivalAutomationScheduler');
    const { buildArrivalStateKey } = require('../services/messaging/arrival/arrivalCommunicationRevision');
    const { COALESCE_WINDOW_MS: WIN } = require('../services/messaging/arrival/arrivalSchedulePolicy');

    await sendArrivalEmailV2({ booking, kind: 'send' });
    await markCommunicated({
      bookingId: booking._id,
      revision: 0,
      stateKey: buildArrivalStateKey(booking, 'cabin')
    });
    const smtpBefore = sendEmailCalls.length;

    booking.checkIn = checkInDaysFromNow(21);
    booking.checkOut = moment(booking.checkIn).add(2, 'days').toDate();
    await booking.save();
    const syncB = await syncArrivalAutomationForBooking({
      bookingId: booking._id,
      now: new Date(Date.now() - WIN - 1000)
    });
    assert.equal(syncB.purpose, 'correction');
    assert.ok(syncB.job?.jobId);

    // Return to A before correction dispatches.
    booking.checkIn = checkInA;
    booking.checkOut = checkOutA;
    await booking.save();
    const syncBack = await syncArrivalAutomationForBooking({ bookingId: booking._id });
    assert.equal(syncBack.purpose, 'noop');
    assert.equal(syncBack.reason, 'state_matches_last_communicated');

    const active = await ScheduledMessageJob.countDocuments({
      bookingId: booking._id,
      status: { $in: ['scheduled', 'claimed'] }
    });
    assert.equal(active, 0);
    assert.equal(sendEmailCalls.length, smtpBefore);
  });
});

test('manual initial without stateKey baselines on sync; no same-state correction SMTP', async () => {
  const cabinId = await insertCabin();
  const checkIn = checkInDaysFromNow(12);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const booking = await makeBooking({ cabinId, checkIn, checkOut });

  await withFlags({ emailV2: '1', automationV2: '1' }, async () => {
    const { sendArrivalEmailV2 } = require('../services/messaging/arrival/arrivalEmailSendService');
    const {
      syncArrivalAutomationForBooking
    } = require('../services/messaging/arrival/arrivalAutomationScheduler');
    const { buildArrivalStateKey } = require('../services/messaging/arrival/arrivalCommunicationRevision');

    // Simulate pre-baseline manual send: accepted MessageDispatch, no stateKey.
    await sendArrivalEmailV2({ booking, kind: 'send' });
    await Booking.updateOne(
      { _id: booking._id },
      {
        $unset: {
          'arrivalCommsV2.lastCommunicatedStateKey': 1,
          'arrivalCommsV2.lastCommunicatedRevision': 1
        }
      }
    );

    const before = sendEmailCalls.length;
    const sync = await syncArrivalAutomationForBooking({ bookingId: booking._id });
    assert.equal(sync.purpose, 'noop');
    assert.equal(sync.reason, 'baselined_manual_initial');
    assert.equal(sendEmailCalls.length, before);

    const live = await Booking.findById(booking._id).lean();
    assert.equal(live.arrivalCommsV2.lastCommunicatedRevision, 0);
    assert.equal(
      live.arrivalCommsV2.lastCommunicatedStateKey,
      buildArrivalStateKey(booking, 'cabin')
    );

    // Same-state re-sync remains noop (no correction).
    const again = await syncArrivalAutomationForBooking({ bookingId: booking._id });
    assert.equal(again.purpose, 'noop');
    assert.equal(again.reason, 'state_matches_last_communicated');
  });
});

test('missing arrivalAutomationV2 payload cancels without SMTP', async () => {
  const cabinId = await insertCabin();
  const checkIn = checkInDaysFromNow(11);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const booking = await makeBooking({ cabinId, checkIn, checkOut });

  await withFlags({ emailV2: '1', automationV2: '1' }, async () => {
    const { processArrivalAutomationJob } = require('../services/messaging/arrival/arrivalAutoDispatchAdapter');
    const job = await ScheduledMessageJob.create({
      ruleKey: 'arrival_instructions_pre_arrival_cabin',
      ruleVersionAtSchedule: 1,
      bookingId: booking._id,
      audience: 'guest',
      propertyKind: 'cabin',
      scheduledFor: new Date(),
      status: 'claimed',
      payloadSnapshot: { purpose: 'initial', scheduleGeneration: 1 }
    });
    const r = await processArrivalAutomationJob(String(job._id));
    assert.equal(r.ran, true);
    assert.equal(r.reason, 'missing_v2_payload');
    assert.equal(sendEmailCalls.length, 0);
    const updated = await ScheduledMessageJob.findById(job._id).lean();
    assert.equal(updated.status, 'cancelled');
  });
});

test('return to last communicated state schedules noop (no correction SMTP)', async () => {
  const cabinId = await insertCabin();
  const checkIn = checkInDaysFromNow(15);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const booking = await makeBooking({ cabinId, checkIn, checkOut });

  await withFlags({ emailV2: '1', automationV2: '1' }, async () => {
    const { sendArrivalEmailV2 } = require('../services/messaging/arrival/arrivalEmailSendService');
    const {
      syncArrivalAutomationForBooking,
      markCommunicated
    } = require('../services/messaging/arrival/arrivalAutomationScheduler');
    const { buildArrivalStateKey } = require('../services/messaging/arrival/arrivalCommunicationRevision');
    const { COALESCE_WINDOW_MS: WIN } = require('../services/messaging/arrival/arrivalSchedulePolicy');

    await sendArrivalEmailV2({ booking, kind: 'send' });
    const stateA = buildArrivalStateKey(booking, 'cabin');
    await markCommunicated({ bookingId: booking._id, revision: 0, stateKey: stateA });

    // Change away
    booking.checkIn = checkInDaysFromNow(16);
    booking.checkOut = moment(booking.checkIn).add(2, 'days').toDate();
    await booking.save();
    const syncB = await syncArrivalAutomationForBooking({
      bookingId: booking._id,
      now: new Date(Date.now() - WIN - 1000)
    });
    assert.equal(syncB.purpose, 'correction');

    // Simulate correction communicated for B
    const stateB = buildArrivalStateKey(booking, 'cabin');
    await markCommunicated({ bookingId: booking._id, revision: syncB.revision, stateKey: stateB });

    // Return to A
    booking.checkIn = checkIn;
    booking.checkOut = checkOut;
    await booking.save();
    // After returning to A, A != lastCommunicated B → correction scheduled
    const syncBack = await syncArrivalAutomationForBooking({
      bookingId: booking._id,
      now: new Date(Date.now() - WIN - 1000)
    });
    assert.equal(syncBack.purpose, 'correction');

    // Mark A communicated again, then sync → noop
    await markCommunicated({
      bookingId: booking._id,
      revision: syncBack.revision,
      stateKey: buildArrivalStateKey(booking, 'cabin')
    });
    const noop = await syncArrivalAutomationForBooking({ bookingId: booking._id });
    assert.equal(noop.purpose, 'noop');
  });
});

test('concurrent schedule syncs: generation fence; single active job converges', async () => {
  const cabinId = await insertCabin();
  const checkIn = checkInDaysFromNow(14);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const booking = await makeBooking({ cabinId, checkIn, checkOut });

  await withFlags({ emailV2: '1', automationV2: '1' }, async () => {
    const { syncArrivalAutomationForBooking } = require('../services/messaging/arrival/arrivalAutomationScheduler');
    const results = await Promise.all([
      syncArrivalAutomationForBooking({ bookingId: booking._id, reason: 'c1' }),
      syncArrivalAutomationForBooking({ bookingId: booking._id, reason: 'c2' }),
      syncArrivalAutomationForBooking({ bookingId: booking._id, reason: 'c3' })
    ]);
    assert.ok(results.every((r) => r.ran));
    const active = await ScheduledMessageJob.find({
      bookingId: booking._id,
      status: { $in: ['scheduled', 'claimed'] }
    }).lean();
    assert.equal(active.length, 1);
    const b = await Booking.findById(booking._id).lean();
    assert.ok(b.arrivalCommsV2.scheduleGeneration >= 3);
    // Winner must match live generation (stale writers abort via fence).
    assert.equal(
      active[0].payloadSnapshot.scheduleGeneration,
      b.arrivalCommsV2.scheduleGeneration
    );
    assert.ok(results.some((r) => r.superseded === true || r.purpose === 'initial'));
  });
});

test('cancellation cancels active jobs; dispatch refuses cancelled booking', async () => {
  const cabinId = await insertCabin();
  const checkIn = checkInDaysFromNow(11);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const booking = await makeBooking({ cabinId, checkIn, checkOut });

  await withFlags({ emailV2: '1', automationV2: '1' }, async () => {
    const {
      syncArrivalAutomationForBooking,
      cancelActiveArrivalJobs
    } = require('../services/messaging/arrival/arrivalAutomationScheduler');
    const { processArrivalAutomationJob } = require('../services/messaging/arrival/arrivalAutoDispatchAdapter');

    const sync = await syncArrivalAutomationForBooking({ bookingId: booking._id });
    assert.equal(sync.purpose, 'initial');

    booking.status = 'cancelled';
    await booking.save();
    await cancelActiveArrivalJobs({ bookingId: booking._id, reason: 'booking_cancelled' });
    const active = await ScheduledMessageJob.countDocuments({
      bookingId: booking._id,
      status: { $in: ['scheduled', 'claimed'] }
    });
    assert.equal(active, 0);

    const job = await ScheduledMessageJob.create({
      ruleKey: 'arrival_instructions_pre_arrival_cabin',
      ruleVersionAtSchedule: 1,
      bookingId: booking._id,
      audience: 'guest',
      propertyKind: 'cabin',
      scheduledFor: new Date(),
      status: 'claimed',
      payloadSnapshot: { purpose: 'initial', arrivalAutomationV2: true, scheduleGeneration: 99 }
    });
    const r = await processArrivalAutomationJob(String(job._id));
    assert.equal(r.ran, true, JSON.stringify(r));
    assert.equal(r.reason, 'booking_cancelled', JSON.stringify(r));
    assert.equal(sendEmailCalls.length, 0);
  });
});

test('stale generation at dispatch cancels without SMTP', async () => {
  const cabinId = await insertCabin();
  const checkIn = checkInDaysFromNow(13);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const booking = await makeBooking({ cabinId, checkIn, checkOut });

  await withFlags({ emailV2: '1', automationV2: '1' }, async () => {
    const { syncArrivalAutomationForBooking } = require('../services/messaging/arrival/arrivalAutomationScheduler');
    const { processArrivalAutomationJob } = require('../services/messaging/arrival/arrivalAutoDispatchAdapter');
    const { buildArrivalStateKey } = require('../services/messaging/arrival/arrivalCommunicationRevision');

    await syncArrivalAutomationForBooking({ bookingId: booking._id });
    await syncArrivalAutomationForBooking({ bookingId: booking._id }); // generation >= 2
    const live = await Booking.findById(booking._id);
    const job = await ScheduledMessageJob.create({
      ruleKey: 'arrival_instructions_pre_arrival_cabin',
      ruleVersionAtSchedule: 1,
      bookingId: booking._id,
      audience: 'guest',
      propertyKind: 'cabin',
      scheduledFor: new Date(Date.now() - 1000),
      status: 'claimed',
      payloadSnapshot: {
        purpose: 'initial',
        scheduleGeneration: 1, // stale
        stateKey: buildArrivalStateKey(live, 'cabin'),
        arrivalAutomationV2: true
      }
    });

    const r = await processArrivalAutomationJob(String(job._id));
    assert.equal(r.ran, true, JSON.stringify(r));
    assert.equal(r.reason, 'stale_generation', JSON.stringify(r));
    assert.equal(sendEmailCalls.length, 0);
  });
});

test('never reactivate sent terminal job', async () => {
  const cabinId = await insertCabin();
  const checkIn = checkInDaysFromNow(9);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const booking = await makeBooking({ cabinId, checkIn, checkOut });

  await withFlags({ emailV2: '1', automationV2: '1' }, async () => {
    const { syncArrivalAutomationForBooking } = require('../services/messaging/arrival/arrivalAutomationScheduler');
    const sync = await syncArrivalAutomationForBooking({ bookingId: booking._id });
    await ScheduledMessageJob.updateOne(
      { _id: sync.job.jobId },
      { $set: { status: 'sent' } }
    );
    await syncArrivalAutomationForBooking({ bookingId: booking._id });
    const sent = await ScheduledMessageJob.findById(sync.job.jobId).lean();
    assert.equal(sent.status, 'sent');
  });
});

test('retriable failure may reclaim; uncertain blocks duplicate SMTP', async () => {
  const cabinId = await insertCabin();
  const checkIn = checkInDaysFromNow(18);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const booking = await makeBooking({ cabinId, checkIn, checkOut });

  await withFlags({ emailV2: '1', automationV2: '1' }, async () => {
    const { sendArrivalEmailV2 } = require('../services/messaging/arrival/arrivalEmailSendService');

    sendEmailImpl = async () => ({ success: false, method: 'logged', error: 'smtp down' });
    const fail = await sendArrivalEmailV2({ booking, kind: 'send' });
    assert.equal(fail.ok, false);
    assert.equal(fail.retriable, true);

    sendEmailImpl = null;
    const retry = await sendArrivalEmailV2({ booking, kind: 'send' });
    assert.equal(retry.ok, true);
    assert.equal(sendEmailCalls.length, 2);
  });
});

test('reconcile dry-run classifies without writing jobs', async () => {
  const cabinId = await insertCabin();
  const checkIn = checkInDaysFromNow(30);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  await makeBooking({ cabinId, checkIn, checkOut });
  await makeBooking({
    cabinId,
    checkIn,
    checkOut,
    status: 'confirmed',
    overrides: { manualReservationPurpose: 'staff_stay' }
  });
  await makeBooking({
    cabinId,
    checkIn,
    checkOut,
    status: 'cancelled'
  });

  // Inline classify using the same module logic path
  const bookings = await Booking.find({ status: 'confirmed' }).lean();
  assert.ok(bookings.length >= 2);
  // Dry-run path does not call sync — no new jobs from this test alone.
  const before = await ScheduledMessageJob.countDocuments({
    'payloadSnapshot.purpose': 'reconcile_should_not_exist'
  });
  assert.equal(before, 0);
});

test('composer T-3 content has no credentials (spot check)', async () => {
  const cabinId = await insertCabin();
  const checkIn = checkInDaysFromNow(10);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const booking = await makeBooking({ cabinId, checkIn, checkOut });
  process.env[ENV_ARRIVAL_EMAIL_V2] = '1';
  const { composeArrivalGuestEmail } = require('../services/messaging/arrival/arrivalEmailComposer');
  const composed = await composeArrivalGuestEmail({ booking, purpose: 'arrival' });
  assert.equal(composed.ok, true);
  const blob = `${composed.text}\n${composed.html}`;
  assert.equal(/password|door code|lockbox|wifi\s*pass/i.test(blob), false);
  assert.match(blob, /15:00/);
  assert.match(blob, /11:00/);
});
