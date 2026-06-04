'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const MessageTemplate = require('../models/MessageTemplate');
const {
  APPROVED_BY,
  TARGET_IDENTITY,
  TARGETS,
  isProductionApplyAllowed,
  runApproval
} = require('./gmaApproveCabinArrivalTemplates.cjs');

let mongoServer;

const CABIN_EMAIL_SUBJECT = 'Cabin arrival subject — {{checkInDate}}';
const CABIN_EMAIL_BODY = '<p>Cabin body {{guestFirstName}}</p>';
const CABIN_WHATSAPP_NAME = 'arrival_3d_the_cabin_v1';

async function createTemplate({
  key,
  channel,
  locale = 'en',
  propertyKind,
  version = 1,
  status = 'draft',
  approvedBy = null,
  approvedAt = null
}) {
  const base = {
    key,
    version,
    channel,
    locale,
    propertyKind,
    status,
    approvedBy,
    approvedAt
  };

  if (channel === 'email') {
    return MessageTemplate.create({
      ...base,
      emailSubject: propertyKind === 'cabin' ? CABIN_EMAIL_SUBJECT : 'Valley subject',
      emailBodyMarkup: propertyKind === 'cabin' ? CABIN_EMAIL_BODY : '<p>Valley body</p>'
    });
  }

  return MessageTemplate.create({
    ...base,
    whatsappTemplateName: propertyKind === 'cabin' ? CABIN_WHATSAPP_NAME : 'arrival_3d_the_valley_v1',
    whatsappLocale: 'en'
  });
}

async function seedCabinArrivalDraftPair() {
  await createTemplate({
    key: TARGET_IDENTITY.key,
    channel: 'email',
    propertyKind: 'cabin'
  });
  await createTemplate({
    key: TARGET_IDENTITY.key,
    channel: 'whatsapp',
    propertyKind: 'cabin'
  });
}

async function seedFullTemplateSet() {
  await seedCabinArrivalDraftPair();
  await createTemplate({
    key: 'arrival_3d_the_valley',
    channel: 'email',
    propertyKind: 'valley'
  });
  await createTemplate({
    key: 'arrival_3d_the_valley',
    channel: 'whatsapp',
    propertyKind: 'valley'
  });
  await createTemplate({
    key: 'ops_alert_arriving_8d',
    channel: 'email',
    propertyKind: 'any'
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await MessageTemplate.syncIndexes();
});

test.beforeEach(async () => {
  await MessageTemplate.deleteMany({});
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('dry-run writes nothing', async () => {
  await seedCabinArrivalDraftPair();
  const before = await MessageTemplate.find({ key: TARGET_IDENTITY.key }).lean();

  const { summary, fatal } = await runApproval({ apply: false });
  assert.equal(fatal, false);
  assert.equal(summary.to_write, TARGETS.length);

  const after = await MessageTemplate.find({ key: TARGET_IDENTITY.key }).lean();
  for (const row of after) {
    const prev = before.find((b) => String(b._id) === String(row._id));
    assert.equal(row.status, prev.status);
    assert.equal(row.approvedBy, prev.approvedBy);
  }
});

test('apply approves exactly two cabin templates', async () => {
  await seedCabinArrivalDraftPair();
  const fixedNow = new Date('2026-05-27T12:00:00.000Z');

  const { summary, fatal } = await runApproval({ apply: true, now: fixedNow });
  assert.equal(fatal, false);
  assert.equal(summary.written, TARGETS.length);
  assert.equal(summary.to_write, TARGETS.length);

  const approved = await MessageTemplate.find({
    key: TARGET_IDENTITY.key,
    propertyKind: 'cabin',
    status: 'approved'
  }).lean();
  assert.equal(approved.length, 2);

  for (const doc of approved) {
    assert.equal(doc.approvedBy, APPROVED_BY);
    assert.equal(doc.approvedAt.toISOString(), fixedNow.toISOString());
  }

  const email = await MessageTemplate.findOne({
    key: TARGET_IDENTITY.key,
    channel: 'email',
    propertyKind: 'cabin'
  }).lean();
  assert.equal(email.emailSubject, CABIN_EMAIL_SUBJECT);
  assert.equal(email.emailBodyMarkup, CABIN_EMAIL_BODY);
});

test('does not approve valley or ops templates', async () => {
  await seedFullTemplateSet();

  const { summary, fatal } = await runApproval({ apply: true });
  assert.equal(fatal, false);
  assert.equal(summary.written, TARGETS.length);

  const valley = await MessageTemplate.find({
    key: 'arrival_3d_the_valley',
    status: 'approved'
  }).lean();
  assert.equal(valley.length, 0);

  const ops = await MessageTemplate.findOne({ key: 'ops_alert_arriving_8d' }).lean();
  assert.equal(ops.status, 'draft');
});

test('idempotent second run', async () => {
  await seedCabinArrivalDraftPair();
  await runApproval({ apply: true });

  const { summary, fatal } = await runApproval({ apply: true });
  assert.equal(fatal, false);
  assert.equal(summary.already_correct, TARGETS.length);
  assert.equal(summary.to_write, 0);
  assert.equal(summary.written, 0);
});

test('missing target fails', async () => {
  await createTemplate({
    key: TARGET_IDENTITY.key,
    channel: 'email',
    propertyKind: 'cabin'
  });

  const { summary, fatal } = await runApproval({ apply: false });
  assert.equal(fatal, true);
  assert.equal(summary.missing, 1);
});

test('mismatch fails when extra cabin version row exists', async () => {
  await seedCabinArrivalDraftPair();
  await createTemplate({
    key: TARGET_IDENTITY.key,
    channel: 'email',
    propertyKind: 'cabin',
    version: 2
  });

  const { summary, fatal } = await runApproval({ apply: false });
  assert.equal(fatal, true);
  assert.equal(summary.mismatch, 1);
});

test('mismatch fails when template approved by another actor', async () => {
  await seedCabinArrivalDraftPair();
  await MessageTemplate.updateOne(
    { key: TARGET_IDENTITY.key, channel: 'email', propertyKind: 'cabin' },
    {
      $set: {
        status: 'approved',
        approvedBy: 'human-reviewer',
        approvedAt: new Date('2026-01-01T00:00:00Z')
      }
    }
  );

  const { summary, fatal } = await runApproval({ apply: false });
  assert.equal(fatal, true);
  assert.equal(summary.mismatch, 1);
});

test('production apply requires env gate', () => {
  const prevNode = process.env.NODE_ENV;
  const prevFlag = process.env.ALLOW_PRODUCTION_GMA_TEMPLATE_APPROVAL;

  process.env.NODE_ENV = 'production';
  delete process.env.ALLOW_PRODUCTION_GMA_TEMPLATE_APPROVAL;
  assert.equal(isProductionApplyAllowed(true), false);

  process.env.ALLOW_PRODUCTION_GMA_TEMPLATE_APPROVAL = '1';
  assert.equal(isProductionApplyAllowed(true), true);

  assert.equal(isProductionApplyAllowed(false), true);

  if (prevNode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNode;
  if (prevFlag === undefined) delete process.env.ALLOW_PRODUCTION_GMA_TEMPLATE_APPROVAL;
  else process.env.ALLOW_PRODUCTION_GMA_TEMPLATE_APPROVAL = prevFlag;
});
