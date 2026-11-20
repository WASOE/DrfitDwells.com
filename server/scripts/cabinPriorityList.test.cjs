const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CabinPriorityList = require('../models/CabinPriorityList');
const CabinPriorityUnsubscribeToken = require('../models/CabinPriorityUnsubscribeToken');
const {
  createCabinPriorityList,
  validateCabinPriorityList
} = require('../services/cabinPriorityList/service');
const {
  deliverGuestEmail,
  deliverAdminEmail
} = require('../services/cabinPriorityList/deliveryService');
const {
  getUnsubscribeState,
  confirmUnsubscribe
} = require('../services/cabinPriorityList/unsubscribeService');
const {
  issueUnsubscribeToken
} = require('../services/cabinPriorityList/unsubscribeTokenService');
const { buildCabinWelcomeEmail } = require('../services/cabinPriorityList/welcomeEmail');

let mongo;
let sent = [];
let emailResult = { success: true, method: 'sent' };

const emailService = {
  async sendEmail(options) {
    sent.push({ to: options.to, subject: options.subject, html: options.html, text: options.text });
    return emailResult;
  }
};

function validBody(overrides = {}) {
  return {
    email: '  Guest@Example.com ',
    preferredMonth: 'January',
    checkIn: '2027-01-15',
    checkOut: '2027-01-18',
    language: 'en',
    sourcePath: '/search?checkIn=2027-01-15',
    sourcePage: 'search',
    consent: true,
    attribution: { utmSource: 'instagram', utmCampaign: 'winter' },
    ...overrides
  };
}

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await CabinPriorityList.syncIndexes();
  await CabinPriorityUnsubscribeToken.syncIndexes();
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test.beforeEach(async () => {
  sent = [];
  emailResult = { success: true, method: 'sent' };
  await CabinPriorityList.deleteMany({});
  await CabinPriorityUnsubscribeToken.deleteMany({});
});

test('first signup persists once and sends one guest and one admin email', async () => {
  const result = await createCabinPriorityList(validBody(), { emailService });
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, false);
  assert.equal(sent.length, 2);
  assert.equal(sent.filter((m) => m.to === 'guest@example.com').length, 1);
  assert.equal(sent.filter((m) => m.to === 'jose@driftdwells.com').length, 1);

  const lead = await CabinPriorityList.findOne({}).lean();
  assert.equal(lead.email, 'guest@example.com');
  assert.equal(lead.status, 'active');
  assert.equal(lead.guestEmail.status, 'sent');
  assert.equal(lead.emailDelivery.status, 'sent');
  assert.equal(lead.guestEmail.attempts, 1);
});

test('guest email renders EN and BG copy with unsubscribe and real assets', async () => {
  const lead = {
    email: 'guest@example.com',
    cabinId: 'the-cabin',
    preferredMonth: 'february',
    language: 'en'
  };
  const en = buildCabinWelcomeEmail({
    lead,
    unsubscribeUrl: 'https://driftdwells.com/cabin-priority/unsubscribe/test-token',
    language: 'en'
  });
  assert.equal(en.subject, "You're on The Cabin priority list");
  assert.match(en.html, /Some places are worth waiting for\./);
  assert.match(en.html, /THE CABIN · DRIFT &amp; DWELLS|THE CABIN · DRIFT & DWELLS/);
  assert.match(en.html, /https:\/\/driftdwells\.com\/uploads\/Videos\/The-cabin-header\.winter-poster\.jpg/);
  assert.match(en.html, /https:\/\/driftdwells\.com\/uploads\/Logo\/DRIFTS-01\.png/);
  assert.match(en.html, /unsubscribe\/test-token/);
  assert.match(en.text, /EXPLORE THE CABIN: https:\/\/driftdwells\.com\/cabin\//);
  assert.match(en.text, /We noted that you prefer February\./);

  const bg = buildCabinWelcomeEmail({
    lead: { ...lead, language: 'bg' },
    unsubscribeUrl: 'https://driftdwells.com/cabin-priority/unsubscribe/test-token',
    language: 'bg'
  });
  assert.equal(bg.subject, 'Вие сте в списъка с приоритети на The Cabin');
  assert.match(bg.html, /Някои места си заслужава да почакаш\./);
  assert.match(bg.text, /РАЗГЛЕДАЙТЕ THE CABIN/);
});

test('duplicate active signup does not resend either email', async () => {
  await createCabinPriorityList(validBody(), { emailService });
  sent = [];
  const again = await createCabinPriorityList(
    validBody({ preferredMonth: 'flexible', language: 'bg' }),
    { emailService }
  );
  assert.equal(again.duplicate, true);
  assert.equal(sent.length, 0);
  assert.equal(await CabinPriorityList.countDocuments({}), 1);
});

test('concurrent signups create one record and send each lane once', async () => {
  const results = await Promise.all([
    createCabinPriorityList(validBody(), { emailService }),
    createCabinPriorityList(validBody(), { emailService })
  ]);
  assert.equal(results.filter((r) => r.ok).length, 2);
  assert.equal(await CabinPriorityList.countDocuments({}), 1);
  assert.equal(sent.filter((m) => m.to === 'guest@example.com').length, 1);
  assert.equal(sent.filter((m) => m.to === 'jose@driftdwells.com').length, 1);
});

test('SMTP failure preserves the signup and retry sends without unlimited attempts', async () => {
  emailResult = { success: false, method: 'failed', error: 'smtp unavailable' };
  const result = await createCabinPriorityList(validBody(), { emailService });
  assert.equal(result.ok, true);

  let lead = await CabinPriorityList.findOne({}).lean();
  assert.equal(lead.guestEmail.status, 'failed');
  assert.equal(lead.emailDelivery.status, 'failed');
  assert.match(lead.guestEmail.lastError, /smtp unavailable/);
  assert.ok(lead.guestEmail.nextAttemptAt);

  emailResult = { success: true, method: 'sent' };
  await CabinPriorityList.updateOne(
    { _id: lead._id },
    {
      $set: {
        'guestEmail.nextAttemptAt': new Date(Date.now() - 1000),
        'emailDelivery.nextAttemptAt': new Date(Date.now() - 1000)
      }
    }
  );
  const guest = await deliverGuestEmail(lead._id, { emailService });
  const admin = await deliverAdminEmail(lead._id, { emailService });
  assert.equal(guest.status, 'sent');
  assert.equal(admin.status, 'sent');
  lead = await CabinPriorityList.findOne({}).lean();
  assert.equal(lead.guestEmail.status, 'sent');
  assert.equal(lead.emailDelivery.status, 'sent');
});

test('unclear logged transport is treated as not sent', async () => {
  emailResult = { success: true, method: 'logged' };
  await createCabinPriorityList(validBody(), { emailService });
  const lead = await CabinPriorityList.findOne({}).lean();
  assert.equal(lead.guestEmail.status, 'failed');
  assert.equal(lead.guestEmail.lastError, 'email_transport_logged_not_sent');
});

test('unsubscribe requires POST, is idempotent and blocks future guest sends', async () => {
  await createCabinPriorityList(validBody(), { emailService });
  const lead = await CabinPriorityList.findOne({}).lean();
  const token = await issueUnsubscribeToken({ email: lead.email, cabinId: lead.cabinId });

  const preview = await getUnsubscribeState(token);
  assert.equal(preview.ok, true);
  assert.equal((await CabinPriorityList.findById(lead._id).lean()).status, 'active');

  const first = await confirmUnsubscribe(token);
  assert.equal(first.ok, true);
  assert.equal(first.idempotent, false);
  const second = await confirmUnsubscribe(token);
  assert.equal(second.ok, true);
  assert.equal(second.idempotent, true);

  const after = await CabinPriorityList.findById(lead._id).lean();
  assert.equal(after.status, 'unsubscribed');
  assert.equal(after.consent, false);

  sent = [];
  const blocked = await deliverGuestEmail(lead._id, { emailService });
  assert.equal(blocked.skipped, true);
  assert.equal(sent.length, 0);
});

test('explicit rejoin after unsubscribe restores consent and sends one new welcome', async () => {
  await createCabinPriorityList(validBody(), { emailService });
  const lead = await CabinPriorityList.findOne({}).lean();
  const token = await issueUnsubscribeToken({ email: lead.email, cabinId: lead.cabinId });
  await confirmUnsubscribe(token);

  sent = [];
  const rejoin = await createCabinPriorityList(validBody({ preferredMonth: 'march' }), { emailService });
  assert.equal(rejoin.ok, true);
  assert.equal(rejoin.rejoined, true);
  assert.equal(sent.filter((m) => m.to === 'guest@example.com').length, 1);

  const restored = await CabinPriorityList.findById(lead._id).lean();
  assert.equal(restored.status, 'active');
  assert.equal(restored.consent, true);
  assert.equal(restored.guestEmail.status, 'sent');
});

test('retry stops after the bounded attempt limit', async () => {
  emailResult = { success: false, method: 'failed', error: 'smtp unavailable' };
  await createCabinPriorityList(validBody(), { emailService });
  const lead = await CabinPriorityList.findOne({}).lean();

  for (let i = 0; i < 6; i += 1) {
    await CabinPriorityList.updateOne(
      { _id: lead._id },
      { $set: { 'guestEmail.nextAttemptAt': new Date(Date.now() - 1000) } }
    );
    await deliverGuestEmail(lead._id, { emailService });
  }

  const after = await CabinPriorityList.findById(lead._id).lean();
  assert.equal(after.guestEmail.status, 'failed');
  assert.equal(after.guestEmail.attempts, 5);
});

test('historical subscribers without a guest lane are never queued', async () => {
  const old = await CabinPriorityList.collection.insertOne({
    email: 'historical@example.com',
    cabinId: 'the-cabin',
    consent: true,
    consentAt: new Date('2026-11-01T00:00:00Z'),
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z')
  });
  const result = await deliverGuestEmail(old.insertedId, { emailService });
  assert.equal(result.skipped, true);
  const after = await CabinPriorityList.findById(old.insertedId).lean();
  assert.equal(after.guestEmail, undefined);
});

test('validation still rejects invalid email, consent and dates', () => {
  assert.equal(validateCabinPriorityList(validBody({ email: 'bad' })).ok, false);
  assert.equal(validateCabinPriorityList(validBody({ consent: false })).ok, false);
  assert.equal(
    validateCabinPriorityList(validBody({ checkIn: '2027-02-01', checkOut: '2027-01-01' })).ok,
    false
  );
});
