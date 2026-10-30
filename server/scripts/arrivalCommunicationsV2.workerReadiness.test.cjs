'use strict';

/**
 * Phase 12 — worker readiness + flag topology proofs.
 * Isolated mongodb-memory-server. Mocked SMTP. No real guest email.
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
  ENV_ARRIVAL_AUTOMATION_V2
} = require('../services/messaging/arrival/arrivalFeatureFlags');
const {
  ENV_WORKER_MODE,
  ENV_EMAIL_ALLOWLIST,
  ENV_ALLOW_ALL_GUESTS,
  assertArrivalWorkerEnv,
  evaluateArrivalWorkerClaim
} = require('../services/messaging/arrival/arrivalWorkerClaimPolicy');
const { buildInitialArrivalIdempotencyKey } = require('../services/messaging/arrival/arrivalDispatchIdentity');
const { PROPERTY_TIMEZONE } = require('../utils/dateTime');
const { CABIN } = require('../services/messaging/arrival/arrivalPropertyFacts');

let mongoServer;
let sendEmailCalls = [];
let originalEmailModule;

function withEnv(patch, fn) {
  const prev = {};
  for (const k of Object.keys(patch)) {
    prev[k] = process.env[k];
    if (patch[k] == null) delete process.env[k];
    else process.env[k] = patch[k];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of Object.keys(patch)) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
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

async function makeBooking({ cabinId, email, checkIn, checkOut, overrides = {} }) {
  const _id = new mongoose.Types.ObjectId();
  await Booking.collection.insertOne({
    _id,
    cabinId,
    checkIn,
    checkOut,
    status: 'confirmed',
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Jose',
      lastName: 'Staff',
      email,
      phone: '+359000000000'
    },
    totalPrice: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  });
  return Booking.findById(_id);
}

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
        return {
          success: true,
          method: 'sent',
          messageId: `<worker-${Date.now()}-${sendEmailCalls.length}@driftdwells.com>`
        };
      }
    }
  };
});

test.beforeEach(() => {
  sendEmailCalls = [];
});

test.after(async () => {
  const emailPath = require.resolve('../services/emailService');
  if (originalEmailModule) require.cache[emailPath] = originalEmailModule;
  else delete require.cache[emailPath];
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('claim policy: assertArrivalWorkerEnv requires allowlist or ALLOW_ALL_GUESTS', () => {
  assert.throws(
    () =>
      assertArrivalWorkerEnv({
        ARRIVAL_AUTOMATION_WORKER_MODE: '1',
        ARRIVAL_EMAIL_V2: '1',
        ARRIVAL_AUTOMATION_V2: '1',
        MESSAGE_SCHEDULER_WORKER_ENABLED: '1',
        MESSAGE_DISPATCHER_ENABLED: '0',
        MESSAGE_ORCHESTRATOR_ENABLED: '0'
      }),
    /EMAIL_ALLOWLIST/
  );
  const ok = assertArrivalWorkerEnv({
    ARRIVAL_AUTOMATION_WORKER_MODE: '1',
    ARRIVAL_EMAIL_V2: '1',
    ARRIVAL_AUTOMATION_V2: '1',
    MESSAGE_SCHEDULER_WORKER_ENABLED: '1',
    MESSAGE_DISPATCHER_ENABLED: '0',
    MESSAGE_ORCHESTRATOR_ENABLED: '0',
    ARRIVAL_AUTOMATION_WORKER_EMAIL_ALLOWLIST: 'jose@driftdwells.com'
  });
  assert.equal(ok.emailAllowlist.has('jose@driftdwells.com'), true);
});

test('claim policy: refuses MESSAGE_DISPATCHER_ENABLED=1', () => {
  assert.throws(
    () =>
      assertArrivalWorkerEnv({
        ARRIVAL_AUTOMATION_WORKER_MODE: '1',
        ARRIVAL_EMAIL_V2: '1',
        ARRIVAL_AUTOMATION_V2: '1',
        MESSAGE_SCHEDULER_WORKER_ENABLED: '1',
        MESSAGE_DISPATCHER_ENABLED: '1',
        MESSAGE_ORCHESTRATOR_ENABLED: '0',
        ARRIVAL_AUTOMATION_WORKER_EMAIL_ALLOWLIST: 'jose@driftdwells.com'
      }),
    /MESSAGE_DISPATCHER_ENABLED/
  );
});

test('claim policy: staff allowlist skips guest and legacy payloads', () => {
  const env = {
    [ENV_WORKER_MODE]: '1',
    [ENV_EMAIL_ALLOWLIST]: 'jose@driftdwells.com'
  };
  const staffJob = {
    ruleKey: 'arrival_instructions_pre_arrival_cabin',
    payloadSnapshot: { arrivalAutomationV2: true }
  };
  assert.equal(
    evaluateArrivalWorkerClaim({
      job: staffJob,
      booking: { guestInfo: { email: 'jose@driftdwells.com' } },
      env
    }).ok,
    true
  );
  assert.equal(
    evaluateArrivalWorkerClaim({
      job: staffJob,
      booking: { guestInfo: { email: 'guest@example.com' } },
      env
    }).reason,
    'email_not_allowlisted'
  );
  assert.equal(
    evaluateArrivalWorkerClaim({
      job: {
        ruleKey: 'arrival_instructions_pre_arrival_cabin',
        payloadSnapshot: {}
      },
      booking: { guestInfo: { email: 'jose@driftdwells.com' } },
      env
    }).reason,
    'missing_v2_payload'
  );
  assert.equal(
    evaluateArrivalWorkerClaim({
      job: {
        ruleKey: 'check_in_access_day_before_cabin',
        payloadSnapshot: { arrivalAutomationV2: true }
      },
      booking: { guestInfo: { email: 'jose@driftdwells.com' } },
      env
    }).reason,
    'not_arrival_allowlist'
  );
});

test('MESSAGE_ORCHESTRATOR_ENABLED=0 does NOT block V2 scheduling via reservation notify', async () => {
  const cabinId = await insertCabin();
  const checkIn = checkInDaysFromNow(10);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const booking = await makeBooking({
    cabinId,
    email: 'jose@driftdwells.com',
    checkIn,
    checkOut
  });

  await withEnv(
    {
      [ENV_ARRIVAL_EMAIL_V2]: '1',
      [ENV_ARRIVAL_AUTOMATION_V2]: '1',
      MESSAGE_ORCHESTRATOR_ENABLED: '0'
    },
    async () => {
      const { notifyManualReservationCreated } = require('../services/messaging/messageOrchestrator');
      const hook = await notifyManualReservationCreated({ bookingId: booking._id });
      assert.equal(hook.disabled, true, 'GMA orchestrator body must stay disabled');

      // fireAndForgetSync is async; wait for schedule write
      for (let i = 0; i < 40; i += 1) {
        const n = await ScheduledMessageJob.countDocuments({
          bookingId: booking._id,
          'payloadSnapshot.arrivalAutomationV2': true
        });
        if (n >= 1) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      const jobs = await ScheduledMessageJob.find({ bookingId: booking._id }).lean();
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].payloadSnapshot.arrivalAutomationV2, true);
      assert.equal(jobs[0].ruleKey, 'arrival_instructions_pre_arrival_cabin');
    }
  );
});

test('MESSAGE_ORCHESTRATOR_ENABLED=0 does NOT block V2 via reservationWriteService notify path', async () => {
  const cabinId = await insertValleyCabin();
  const checkIn = checkInDaysFromNow(14);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const booking = await makeBooking({
    cabinId,
    email: 'jose@driftdwells.com',
    checkIn,
    checkOut
  });

  await withEnv(
    {
      [ENV_ARRIVAL_EMAIL_V2]: '1',
      [ENV_ARRIVAL_AUTOMATION_V2]: '1',
      MESSAGE_ORCHESTRATOR_ENABLED: '0'
    },
    async () => {
      // Reproduce the dual path used by reservationWriteService:
      // orchestrator notify (disabled body) + independent fireAndForgetSync.
      const { fireAndForgetSync } = require('../services/messaging/arrival/arrivalAutomationScheduler');
      fireAndForgetSync(booking._id, 'notifyManualReservationCreated');
      for (let i = 0; i < 40; i += 1) {
        const n = await ScheduledMessageJob.countDocuments({ bookingId: booking._id });
        if (n >= 1) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      const job = await ScheduledMessageJob.findOne({ bookingId: booking._id }).lean();
      assert.ok(job);
      assert.equal(job.ruleKey, 'arrival_instructions_pre_arrival_valley');
      assert.equal(job.payloadSnapshot.arrivalAutomationV2, true);
    }
  );
});

test('MESSAGE_DISPATCHER_ENABLED=0 still SMTP via scheduler → arrival adapter', async () => {
  const cabinId = await insertCabin();
  const checkIn = checkInDaysFromNow(10);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const booking = await makeBooking({
    cabinId,
    email: 'jose@driftdwells.com',
    checkIn,
    checkOut
  });

  await withEnv(
    {
      [ENV_ARRIVAL_EMAIL_V2]: '1',
      [ENV_ARRIVAL_AUTOMATION_V2]: '1',
      MESSAGE_DISPATCHER_ENABLED: '0',
      MESSAGE_SCHEDULER_WORKER_ENABLED: '0',
      [ENV_WORKER_MODE]: '1',
      [ENV_EMAIL_ALLOWLIST]: 'jose@driftdwells.com'
    },
    async () => {
      const { syncArrivalAutomationForBooking } = require('../services/messaging/arrival/arrivalAutomationScheduler');
      const {
        tickOnce,
        setAwaitDispatcherForTests,
        isDispatcherEnabled
      } = require('../services/messaging/schedulerWorker');

      assert.equal(isDispatcherEnabled(), false);

      const sync = await syncArrivalAutomationForBooking({ bookingId: booking._id });
      assert.equal(sync.purpose, 'initial');
      await ScheduledMessageJob.updateOne(
        { bookingId: booking._id },
        { $set: { scheduledFor: new Date(Date.now() - 1000) } }
      );

      setAwaitDispatcherForTests(true);
      const tick = await tickOnce({ now: new Date() });
      setAwaitDispatcherForTests(false);

      assert.ok(tick.claimed >= 1, JSON.stringify(tick));
      assert.equal(sendEmailCalls.length, 1, 'SMTP via adapter with dispatcher off');
      assert.equal(String(sendEmailCalls[0].to).toLowerCase(), 'jose@driftdwells.com');
      const accepted = await MessageDispatch.findOne({
        idempotencyKey: buildInitialArrivalIdempotencyKey(booking._id),
        status: 'accepted'
      }).lean();
      assert.ok(accepted);
      const job = await ScheduledMessageJob.findOne({ bookingId: booking._id }).lean();
      assert.equal(job.status, 'sent');
    }
  );
});

test('staff-scoped worker claims only jose@; leaves guest V2 job scheduled', async () => {
  const cabinId = await insertCabin();
  const checkIn = checkInDaysFromNow(10);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const staff = await makeBooking({
    cabinId,
    email: 'jose@driftdwells.com',
    checkIn,
    checkOut,
    overrides: { manualReservationPurpose: 'staff_stay' }
  });
  const guest = await makeBooking({
    cabinId,
    email: 'real.guest@example.com',
    checkIn,
    checkOut
  });

  await withEnv(
    {
      [ENV_ARRIVAL_EMAIL_V2]: '1',
      [ENV_ARRIVAL_AUTOMATION_V2]: '1',
      MESSAGE_DISPATCHER_ENABLED: '0',
      [ENV_WORKER_MODE]: '1',
      [ENV_EMAIL_ALLOWLIST]: 'jose@driftdwells.com'
    },
    async () => {
      const { syncArrivalAutomationForBooking } = require('../services/messaging/arrival/arrivalAutomationScheduler');
      const { tickOnce, setAwaitDispatcherForTests } = require('../services/messaging/schedulerWorker');

      await syncArrivalAutomationForBooking({ bookingId: staff._id });
      await syncArrivalAutomationForBooking({ bookingId: guest._id });
      await ScheduledMessageJob.updateMany(
        { bookingId: { $in: [staff._id, guest._id] } },
        { $set: { scheduledFor: new Date(Date.now() - 1000) } }
      );

      setAwaitDispatcherForTests(true);
      const tick = await tickOnce({ now: new Date() });
      setAwaitDispatcherForTests(false);

      assert.equal(tick.claimed, 1, JSON.stringify(tick));
      assert.ok(tick.skippedByClaimGate >= 1, JSON.stringify(tick));
      assert.equal(sendEmailCalls.length, 1);

      const staffJob = await ScheduledMessageJob.findOne({ bookingId: staff._id }).lean();
      const guestJob = await ScheduledMessageJob.findOne({ bookingId: guest._id }).lean();
      assert.equal(staffJob.status, 'sent');
      assert.equal(guestJob.status, 'scheduled', 'guest job must remain unclaimed');
    }
  );
});

test('unrelated GMA due job is not claimed by arrival worker mode', async () => {
  const cabinId = await insertCabin();
  const checkIn = checkInDaysFromNow(10);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const booking = await makeBooking({
    cabinId,
    email: 'jose@driftdwells.com',
    checkIn,
    checkOut
  });

  await ScheduledMessageJob.create({
    ruleKey: 'some_other_gma_rule',
    ruleVersionAtSchedule: 1,
    bookingId: booking._id,
    audience: 'guest',
    propertyKind: 'cabin',
    scheduledFor: new Date(Date.now() - 1000),
    status: 'scheduled',
    payloadSnapshot: { purpose: 'unrelated' }
  });

  await withEnv(
    {
      [ENV_ARRIVAL_EMAIL_V2]: '1',
      [ENV_ARRIVAL_AUTOMATION_V2]: '1',
      MESSAGE_DISPATCHER_ENABLED: '0',
      [ENV_WORKER_MODE]: '1',
      [ENV_EMAIL_ALLOWLIST]: 'jose@driftdwells.com'
    },
    async () => {
      const { tickOnce, setAwaitDispatcherForTests } = require('../services/messaging/schedulerWorker');
      setAwaitDispatcherForTests(true);
      const tick = await tickOnce({ now: new Date() });
      setAwaitDispatcherForTests(false);
      assert.equal(tick.claimed, 0, JSON.stringify(tick));
      assert.ok(tick.skippedByClaimGate >= 1);
      const job = await ScheduledMessageJob.findOne({ ruleKey: 'some_other_gma_rule' }).lean();
      assert.equal(job.status, 'scheduled');
      assert.equal(sendEmailCalls.length, 0);
    }
  );
});

test('late catch-up schedules ~now+5m and dispatches through worker path', async () => {
  const cabinId = await insertCabin();
  // check-in tomorrow → past nominal T-3 → catch_up
  const checkIn = checkInDaysFromNow(1);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const booking = await makeBooking({
    cabinId,
    email: 'jose@driftdwells.com',
    checkIn,
    checkOut,
    overrides: { manualReservationPurpose: 'staff_stay' }
  });

  await withEnv(
    {
      [ENV_ARRIVAL_EMAIL_V2]: '1',
      [ENV_ARRIVAL_AUTOMATION_V2]: '1',
      MESSAGE_DISPATCHER_ENABLED: '0',
      [ENV_WORKER_MODE]: '1',
      [ENV_EMAIL_ALLOWLIST]: 'jose@driftdwells.com'
    },
    async () => {
      const { syncArrivalAutomationForBooking } = require('../services/messaging/arrival/arrivalAutomationScheduler');
      const { tickOnce, setAwaitDispatcherForTests } = require('../services/messaging/schedulerWorker');
      const sync = await syncArrivalAutomationForBooking({ bookingId: booking._id });
      assert.equal(sync.purpose, 'initial');
      assert.equal(sync.mode, 'catch_up');
      const job = await ScheduledMessageJob.findOne({ bookingId: booking._id }).lean();
      assert.ok(job);
      // Force due for claim (catch-up would be ~5m ahead)
      await ScheduledMessageJob.updateOne(
        { _id: job._id },
        { $set: { scheduledFor: new Date(Date.now() - 500) } }
      );
      setAwaitDispatcherForTests(true);
      await tickOnce({ now: new Date() });
      setAwaitDispatcherForTests(false);
      assert.equal(sendEmailCalls.length, 1);
      const accepted = await MessageDispatch.countDocuments({
        idempotencyKey: buildInitialArrivalIdempotencyKey(booking._id),
        status: 'accepted'
      });
      assert.equal(accepted, 1);
    }
  );
});

test('cancellation cancels active V2 job; date change reschedules generation', async () => {
  const cabinId = await insertCabin();
  const checkIn = checkInDaysFromNow(20);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const booking = await makeBooking({
    cabinId,
    email: 'jose@driftdwells.com',
    checkIn,
    checkOut
  });

  await withEnv(
    {
      [ENV_ARRIVAL_EMAIL_V2]: '1',
      [ENV_ARRIVAL_AUTOMATION_V2]: '1',
      MESSAGE_ORCHESTRATOR_ENABLED: '0'
    },
    async () => {
      const { syncArrivalAutomationForBooking } = require('../services/messaging/arrival/arrivalAutomationScheduler');
      const first = await syncArrivalAutomationForBooking({ bookingId: booking._id });
      assert.equal(first.purpose, 'initial');
      const job1 = await ScheduledMessageJob.findOne({ bookingId: booking._id, status: 'scheduled' }).lean();
      assert.ok(job1);

      const newCi = checkInDaysFromNow(25);
      booking.checkIn = newCi;
      booking.checkOut = moment(newCi).add(2, 'days').toDate();
      await booking.save();
      const second = await syncArrivalAutomationForBooking({
        bookingId: booking._id,
        reason: 'dates_changed'
      });
      assert.equal(second.purpose, 'initial');
      const active = await ScheduledMessageJob.find({
        bookingId: booking._id,
        status: 'scheduled'
      }).lean();
      assert.equal(active.length, 1);
      assert.notEqual(String(active[0]._id), String(job1._id));
      assert.ok(Number(second.scheduleGeneration) > Number(first.scheduleGeneration));

      booking.status = 'cancelled';
      await booking.save();
      const cancel = await syncArrivalAutomationForBooking({
        bookingId: booking._id,
        reason: 'cancelled'
      });
      assert.equal(cancel.skipped, 'cancelled');
      const still = await ScheduledMessageJob.countDocuments({
        bookingId: booking._id,
        status: { $in: ['scheduled', 'claimed'] }
      });
      assert.equal(still, 0);
    }
  );
});

test('ALLOW_ALL_GUESTS path still rejects dispatcher=1 at boot assert', () => {
  assert.throws(
    () =>
      assertArrivalWorkerEnv({
        [ENV_WORKER_MODE]: '1',
        ARRIVAL_EMAIL_V2: '1',
        ARRIVAL_AUTOMATION_V2: '1',
        MESSAGE_SCHEDULER_WORKER_ENABLED: '1',
        MESSAGE_DISPATCHER_ENABLED: '1',
        MESSAGE_ORCHESTRATOR_ENABLED: '0',
        [ENV_ALLOW_ALL_GUESTS]: '1'
      }),
    /MESSAGE_DISPATCHER_ENABLED/
  );
});

test('shared scheduler refuses start when automation authorized without worker mode', async () => {
  await withEnv(
    {
      [ENV_ARRIVAL_EMAIL_V2]: '1',
      [ENV_ARRIVAL_AUTOMATION_V2]: '1',
      MESSAGE_SCHEDULER_WORKER_ENABLED: '1',
      [ENV_WORKER_MODE]: null,
      ARRIVAL_AUTOMATION_ALLOW_SHARED_SCHEDULER: null
    },
    async () => {
      const {
        startSchedulerWorkerIfEnabled,
        stopSchedulerWorkerForTest
      } = require('../services/messaging/schedulerWorker');
      stopSchedulerWorkerForTest();
      const r = startSchedulerWorkerIfEnabled();
      assert.equal(r.started, false);
      assert.equal(r.refused, 'unscoped_arrival_automation');
    }
  );
});

test('adapter accepts ObjectId argument without mistaking it for a job doc', async () => {
  const cabinId = await insertCabin();
  const checkIn = checkInDaysFromNow(10);
  const checkOut = moment(checkIn).add(2, 'days').toDate();
  const booking = await makeBooking({
    cabinId,
    email: 'jose@driftdwells.com',
    checkIn,
    checkOut
  });

  await withEnv(
    {
      [ENV_ARRIVAL_EMAIL_V2]: '1',
      [ENV_ARRIVAL_AUTOMATION_V2]: '1'
    },
    async () => {
      const { syncArrivalAutomationForBooking } = require('../services/messaging/arrival/arrivalAutomationScheduler');
      const { processArrivalAutomationJob } = require('../services/messaging/arrival/arrivalAutoDispatchAdapter');
      await syncArrivalAutomationForBooking({ bookingId: booking._id });
      const job = await ScheduledMessageJob.findOneAndUpdate(
        { bookingId: booking._id },
        {
          $set: {
            status: 'claimed',
            scheduledFor: new Date(Date.now() - 1000),
            claimedBy: 'test',
            claimedAt: new Date(),
            visibilityTimeoutAt: new Date(Date.now() + 60_000)
          }
        },
        { new: true }
      );
      // Pass bare ObjectId — previously returned not_arrival_allowlist.
      const r = await processArrivalAutomationJob(job._id);
      assert.equal(r.terminal, 'sent', JSON.stringify(r));
      assert.equal(sendEmailCalls.length, 1);
    }
  );
});
