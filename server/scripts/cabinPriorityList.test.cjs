const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CabinPriorityList = require('../models/CabinPriorityList');
const {
  createCabinPriorityList,
  validateCabinPriorityList
} = require('../services/cabinPriorityList/service');

let mongo;
let sendCalls = 0;
let emailResult = { success: true, method: 'sent' };

const emailService = {
  async sendEmail() {
    sendCalls += 1;
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
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test.beforeEach(async () => {
  sendCalls = 0;
  emailResult = { success: true, method: 'sent' };
  await CabinPriorityList.deleteMany({});
});

test('valid signup persists and sends one notification', async () => {
  const result = await createCabinPriorityList(validBody(), { emailService });
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, false);
  assert.equal(sendCalls, 1);

  const lead = await CabinPriorityList.findOne({}).lean();
  assert.equal(lead.email, 'guest@example.com');
  assert.equal(lead.cabinId, 'the-cabin');
  assert.equal(lead.preferredMonth, 'january');
  assert.equal(lead.language, 'en');
  assert.equal(lead.consent, true);
  assert.equal(lead.emailDelivery.status, 'sent');
  assert.equal(lead.checkIn.toISOString().slice(0, 10), '2027-01-15');
  assert.equal(lead.attribution.utmSource, 'instagram');
});

test('duplicate email is idempotent and does not notify twice', async () => {
  await createCabinPriorityList(validBody(), { emailService });
  const again = await createCabinPriorityList(
    validBody({ preferredMonth: 'flexible', language: 'bg' }),
    { emailService }
  );

  assert.equal(again.ok, true);
  assert.equal(again.duplicate, true);
  assert.equal(sendCalls, 1);
  assert.equal(await CabinPriorityList.countDocuments({}), 1);

  const lead = await CabinPriorityList.findOne({}).lean();
  assert.equal(lead.preferredMonth, 'flexible');
  assert.equal(lead.language, 'bg');
});

test('honeypot submissions are discarded without persistence', async () => {
  const result = await createCabinPriorityList(
    validBody({ website: 'https://spam.example' }),
    { emailService }
  );
  assert.equal(result.honeypot, true);
  assert.equal(sendCalls, 0);
  assert.equal(await CabinPriorityList.countDocuments({}), 0);
});

test('invalid email and missing consent are rejected', () => {
  const invalidEmail = validateCabinPriorityList(validBody({ email: 'not-an-email' }));
  assert.equal(invalidEmail.ok, false);
  assert.ok(invalidEmail.errors.email);

  const noConsent = validateCabinPriorityList(validBody({ consent: false }));
  assert.equal(noConsent.ok, false);
  assert.ok(noConsent.errors.consent);
});

test('invalid dates are rejected', () => {
  const reversed = validateCabinPriorityList(
    validBody({ checkIn: '2027-02-01', checkOut: '2027-01-01' })
  );
  assert.equal(reversed.ok, false);
  assert.ok(reversed.errors.dates);
});

test('email delivery failure keeps the lead and reports failure in the record', async () => {
  emailResult = { success: false, method: 'failed', error: 'smtp unavailable' };
  const result = await createCabinPriorityList(validBody(), { emailService });
  assert.equal(result.ok, true);

  const lead = await CabinPriorityList.findOne({}).lean();
  assert.equal(lead.emailDelivery.status, 'failed');
  assert.match(lead.emailDelivery.lastError, /smtp unavailable/);
});

test('selected dates are optional', async () => {
  const result = await createCabinPriorityList(
    validBody({ checkIn: undefined, checkOut: undefined }),
    { emailService }
  );
  assert.equal(result.ok, true);
  const lead = await CabinPriorityList.findOne({}).lean();
  assert.equal(lead.checkIn, null);
  assert.equal(lead.checkOut, null);
});
