'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const crypto = require('crypto');

const MessageTemplate = require('../models/MessageTemplate');
const MessageAutomationRule = require('../models/MessageAutomationRule');
const Cabin = require('../models/Cabin');
const Booking = require('../models/Booking');
const {
  GMA_TEMPLATE_COPY_TARGETS,
  isProductionApplyAllowed,
  runReplaceTemplateCopy
} = require('./gmaReplaceTemplateCopy.cjs');
const { previewGmaMessageForReservation } = require('../services/messaging/messageTemplatePreviewService');
const { buildAllTemplates } = require('./seedMessageAutomation.js');

let mongoServer;

const FORBIDDEN_GUEST_MARKERS = [
  '+359 88 800 0000',
  '{{supportPhone}}',
  '{{transportNote}}',
  '{{packingReminderShort}}',
  'Standard arrival; contact us if you need transport arrangements',
  'Layered clothing, sturdy shoes, rain gear'
];

const CABIN_FORBIDDEN = ['Chereshovo', 'Kraishte', 'ATV', 'A-Frame', 'Lux Cabin', 'Stone House', 'Eleshnitsa', 'Palatik'];
const VALLEY_REQUIRED = ['Kraishte', 'Eleshnitsa', 'Palatik', 'Chereshovo'];
const CABIN_PARK_WALK = 'park at the designated point and continue on foot';

async function seedOldPlaceholderTemplates() {
  const oldSchema = {
    type: 'object',
    required: [
      'guestFirstName',
      'propertyName',
      'checkInDate',
      'checkOutDate',
      'arrivalWindow',
      'guideUrl',
      'meetingPointLabel',
      'googleMapsUrl',
      'supportPhone',
      'transportNote',
      'packingReminderShort'
    ]
  };

  await MessageTemplate.create({
    key: 'arrival_3d_the_cabin',
    version: 1,
    channel: 'email',
    locale: 'en',
    propertyKind: 'cabin',
    status: 'draft',
    emailSubject: 'Your arrival to {{propertyName}} — {{checkInDate}}',
    emailBodyMarkup: '<p>Hi {{guestFirstName}}, call {{supportPhone}}. {{transportNote}}</p>',
    variableSchema: oldSchema,
    notes: 'old placeholder'
  });

  await MessageTemplate.create({
    key: 'arrival_3d_the_cabin',
    version: 1,
    channel: 'whatsapp',
    locale: 'en',
    propertyKind: 'cabin',
    status: 'draft',
    whatsappTemplateName: 'arrival_3d_the_cabin_v1',
    whatsappLocale: 'en',
    variableSchema: oldSchema,
    notes: 'old whatsapp'
  });

  await MessageTemplate.create({
    key: 'arrival_3d_the_valley',
    version: 1,
    channel: 'email',
    locale: 'en',
    propertyKind: 'valley',
    status: 'draft',
    emailSubject: 'Valley {{checkInDate}}',
    emailBodyMarkup: '<p>Hi {{guestFirstName}} {{packingReminderShort}}</p>',
    variableSchema: oldSchema,
    notes: 'old valley'
  });

  await MessageTemplate.create({
    key: 'arrival_3d_the_valley',
    version: 1,
    channel: 'whatsapp',
    locale: 'en',
    propertyKind: 'valley',
    status: 'draft',
    whatsappTemplateName: 'arrival_3d_the_valley_v1',
    whatsappLocale: 'en',
    variableSchema: oldSchema,
    notes: 'old valley wa'
  });

  const opsSchema = {
    type: 'object',
    required: ['guestFirstName', 'propertyName', 'checkInDate', 'checkOutDate', 'arrivalWindow']
  };

  await MessageTemplate.create({
    key: 'ops_alert_arriving_8d',
    version: 1,
    channel: 'email',
    locale: 'en',
    propertyKind: 'any',
    status: 'draft',
    emailSubject: '[OPS] old',
    emailBodyMarkup: '<p>Guest arrives in 8 days.</p>',
    variableSchema: opsSchema,
    notes: 'old ops'
  });

  await MessageTemplate.create({
    key: 'ops_alert_check_in_tomorrow',
    version: 1,
    channel: 'email',
    locale: 'en',
    propertyKind: 'any',
    status: 'draft',
    emailSubject: '[OPS] old',
    emailBodyMarkup: '<p>Guest checks in tomorrow.</p>',
    variableSchema: opsSchema,
    notes: 'old ops'
  });

  await MessageTemplate.create({
    key: 'ops_alert_checkout_today',
    version: 1,
    channel: 'email',
    locale: 'en',
    propertyKind: 'any',
    status: 'draft',
    emailSubject: '[OPS] old',
    emailBodyMarkup: '<p>Guest checks out today.</p>',
    variableSchema: opsSchema,
    notes: 'old ops'
  });
}

function templateText(doc) {
  return [doc.emailSubject, doc.emailBodyMarkup, doc.notes].filter(Boolean).join('\n');
}

async function seedCabinBookingContext() {
  await MessageAutomationRule.create({
    ruleKey: 'arrival_instructions_pre_arrival_cabin',
    description: 'cabin',
    triggerType: 'time_relative_to_check_in',
    triggerConfig: { offsetHours: -72, sofiaHour: 17, sofiaMinute: 0 },
    propertyScope: 'cabin',
    channelStrategy: 'whatsapp_first_email_fallback',
    templateKeyByChannel: { whatsapp: 'arrival_3d_the_cabin', email: 'arrival_3d_the_cabin' },
    requiresConsent: 'transactional',
    enabled: false,
    mode: 'shadow',
    audience: 'guest',
    requiredBookingStatus: ['confirmed'],
    requirePaidIfStripe: true
  });

  const cabin = await Cabin.create({
    name: 'The Cabin',
    description: 'd',
    location: 'Rhodopes',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/cabin.jpg',
    propertyKind: 'cabin',
    meetingPoint: {
      label: 'Park-and-walk point for The Cabin',
      googleMapsUrl: 'https://www.google.com/maps/example'
    },
    arrivalGuideUrl: '/guides/the-cabin',
    arrivalWindowDefault: 'From 15:00'
  });

  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 10);
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 2);

  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Jose',
      lastName: 'Test',
      email: 'jose@example.com',
      phone: '+359881234567'
    },
    status: 'confirmed',
    totalPrice: 300,
    subtotalPrice: 300,
    discountAmount: 0,
    totalValueCents: 30000,
    giftVoucherAppliedCents: 0,
    stripePaidAmountCents: 30000,
    stripePaymentIntentId: `pi_${crypto.randomBytes(8).toString('hex')}`
  });

  return { cabin, booking };
}

async function seedValleyBookingContext() {
  await MessageAutomationRule.create({
    ruleKey: 'arrival_instructions_pre_arrival_valley',
    description: 'valley',
    triggerType: 'time_relative_to_check_in',
    triggerConfig: { offsetHours: -72, sofiaHour: 17, sofiaMinute: 0 },
    propertyScope: 'valley',
    channelStrategy: 'whatsapp_first_email_fallback',
    templateKeyByChannel: { whatsapp: 'arrival_3d_the_valley', email: 'arrival_3d_the_valley' },
    requiresConsent: 'transactional',
    enabled: false,
    mode: 'shadow',
    audience: 'guest',
    requiredBookingStatus: ['confirmed'],
    requirePaidIfStripe: true
  });

  const cabin = await Cabin.create({
    name: 'Stone House',
    description: 'd',
    location: 'Valley',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/valley.jpg',
    propertyKind: 'valley',
    meetingPoint: {
      label: 'Chereshovo parking — Eleshnitsa, Palatik, Chereshovo',
      googleMapsUrl: 'https://maps.app.goo.gl/example'
    },
    arrivalGuideUrl: '/guides/the-valley',
    arrivalWindowDefault: 'From 15:00. Last 1 km on foot.'
  });

  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 12);
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 3);

  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Guest',
      lastName: 'Valley',
      email: 'valley@example.com',
      phone: '+359881234567'
    },
    status: 'confirmed',
    totalPrice: 400,
    subtotalPrice: 400,
    discountAmount: 0,
    totalValueCents: 40000,
    giftVoucherAppliedCents: 0,
    stripePaidAmountCents: 40000,
    stripePaymentIntentId: `pi_${crypto.randomBytes(8).toString('hex')}`
  });

  return { booking };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await MessageTemplate.syncIndexes();
});

test.beforeEach(async () => {
  await MessageTemplate.deleteMany({});
  await MessageAutomationRule.deleteMany({});
  await Cabin.deleteMany({});
  await Booking.deleteMany({});
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('dry-run writes nothing', async () => {
  await seedOldPlaceholderTemplates();
  const before = await MessageTemplate.findOne({ key: 'arrival_3d_the_cabin', channel: 'email' }).lean();

  const { summary, fatal } = await runReplaceTemplateCopy({ apply: false });
  assert.equal(fatal, false);
  assert.ok(summary.to_write > 0);

  const after = await MessageTemplate.findOne({ key: 'arrival_3d_the_cabin', channel: 'email' }).lean();
  assert.equal(after.emailBodyMarkup, before.emailBodyMarkup);
});

test('apply updates exactly 7 templates', async () => {
  await seedOldPlaceholderTemplates();

  const { summary, fatal } = await runReplaceTemplateCopy({ apply: true });
  assert.equal(fatal, false);
  assert.equal(summary.written, 7);
  assert.equal(await MessageTemplate.countDocuments({}), 7);
});

test('status remains draft after apply', async () => {
  await seedOldPlaceholderTemplates();
  await runReplaceTemplateCopy({ apply: true });

  const drafts = await MessageTemplate.countDocuments({ status: 'draft' });
  assert.equal(drafts, 7);
  const approved = await MessageTemplate.countDocuments({ status: 'approved' });
  assert.equal(approved, 0);
});

test('guest templates contain no forbidden placeholder markers', async () => {
  await seedOldPlaceholderTemplates();
  await runReplaceTemplateCopy({ apply: true });

  const guestKeys = ['arrival_3d_the_cabin', 'arrival_3d_the_valley'];
  const docs = await MessageTemplate.find({ key: { $in: guestKeys } }).lean();
  assert.equal(docs.length, 4);

  for (const doc of docs) {
    const text = templateText(doc);
    for (const bad of FORBIDDEN_GUEST_MARKERS) {
      assert.ok(!text.includes(bad), `${doc.key}/${doc.channel} contains forbidden: ${bad}`);
    }
  }
});

test('cabin email does not contain valley-only markers', async () => {
  await seedOldPlaceholderTemplates();
  await runReplaceTemplateCopy({ apply: true });

  const doc = await MessageTemplate.findOne({ key: 'arrival_3d_the_cabin', channel: 'email' }).lean();
  const text = templateText(doc);
  for (const marker of CABIN_FORBIDDEN) {
    assert.ok(!text.includes(marker), `cabin email contains ${marker}`);
  }
  assert.ok(text.includes(CABIN_PARK_WALK));
});

test('valley email contains required route markers', async () => {
  await seedOldPlaceholderTemplates();
  await runReplaceTemplateCopy({ apply: true });

  const doc = await MessageTemplate.findOne({ key: 'arrival_3d_the_valley', channel: 'email' }).lean();
  const text = templateText(doc);
  for (const marker of VALLEY_REQUIRED) {
    assert.ok(text.includes(marker), `valley email missing ${marker}`);
  }
  assert.ok(!text.toLowerCase().includes('park-and-walk'));
});

test('OPS templates are bilingual', async () => {
  await seedOldPlaceholderTemplates();
  await runReplaceTemplateCopy({ apply: true });

  const opsDocs = await MessageTemplate.find({ key: /^ops_alert_/ }).lean();
  assert.equal(opsDocs.length, 3);
  for (const doc of opsDocs) {
    const text = templateText(doc);
    assert.ok(text.includes('lang="en"'), `${doc.key} missing English section`);
    assert.ok(text.includes('lang="bg"'), `${doc.key} missing Bulgarian section`);
  }
});

test('idempotent second run', async () => {
  await seedOldPlaceholderTemplates();
  await runReplaceTemplateCopy({ apply: true });

  const { summary, fatal } = await runReplaceTemplateCopy({ apply: true });
  assert.equal(fatal, false);
  assert.equal(summary.already_correct, 7);
  assert.equal(summary.to_write, 0);
});

test('missing template fails', async () => {
  const rows = buildAllTemplates();
  for (const row of rows.slice(0, 6)) {
    await MessageTemplate.create(row);
  }

  const { summary, fatal } = await runReplaceTemplateCopy({ apply: false });
  assert.equal(fatal, true);
  assert.equal(summary.missing, 1);
});

test('template count mismatch fails', async () => {
  await seedOldPlaceholderTemplates();
  await MessageTemplate.create({
    key: 'arrival_3d_the_cabin',
    version: 2,
    channel: 'email',
    locale: 'en',
    propertyKind: 'cabin',
    status: 'draft',
    emailSubject: 'extra',
    emailBodyMarkup: '<p>extra</p>'
  });

  const { summary, fatal } = await runReplaceTemplateCopy({ apply: false });
  assert.equal(fatal, true);
  assert.equal(summary.mismatch, 1);
});

test('production apply requires env gate', () => {
  const prevNode = process.env.NODE_ENV;
  const prevFlag = process.env.ALLOW_PRODUCTION_GMA_TEMPLATE_COPY;

  process.env.NODE_ENV = 'production';
  delete process.env.ALLOW_PRODUCTION_GMA_TEMPLATE_COPY;
  assert.equal(isProductionApplyAllowed(true), false);

  process.env.ALLOW_PRODUCTION_GMA_TEMPLATE_COPY = '1';
  assert.equal(isProductionApplyAllowed(true), true);

  if (prevNode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNode;
  if (prevFlag === undefined) delete process.env.ALLOW_PRODUCTION_GMA_TEMPLATE_COPY;
  else process.env.ALLOW_PRODUCTION_GMA_TEMPLATE_COPY = prevFlag;
});

test('GMA preview renders cabin email with absolute guideUrl', async () => {
  await seedOldPlaceholderTemplates();
  await runReplaceTemplateCopy({ apply: true });
  const { booking } = await seedCabinBookingContext();

  process.env.APP_URL = 'https://driftdwells.com';

  const data = await previewGmaMessageForReservation({
    reservationId: String(booking._id),
    ruleKey: 'arrival_instructions_pre_arrival_cabin',
    channel: 'email'
  });

  assert.ok(data.email.html.includes('https://driftdwells.com/guides/the-cabin'));
  assert.ok(!data.email.html.includes('href="/guides/the-cabin"'));
  assert.equal(data.variables.guideUrl, 'https://driftdwells.com/guides/the-cabin');
  assert.ok(!data.variables.supportPhone);
  assert.ok(data.email.html.includes('lang="en"'));
  assert.ok(!data.email.fragmentHtml.includes('lang="bg"'));
  assert.ok(!data.email.text.includes('Здравейте'));
  assert.ok(data.email.html.includes('<!DOCTYPE html>'));
  assert.ok(data.email.html.includes('email-outer'));
  assert.ok(data.email.html.includes('email-card'));
});

test('GMA preview renders cabin WhatsApp body from template notes', async () => {
  await seedOldPlaceholderTemplates();
  await runReplaceTemplateCopy({ apply: true });
  const { booking } = await seedCabinBookingContext();

  process.env.APP_URL = 'https://driftdwells.com';

  const data = await previewGmaMessageForReservation({
    reservationId: String(booking._id),
    ruleKey: 'arrival_instructions_pre_arrival_cabin',
    channel: 'whatsapp'
  });

  assert.equal(data.template.status, 'draft');
  assert.ok(typeof data.whatsapp.body === 'string' && data.whatsapp.body.length > 200);
  assert.match(data.whatsapp.body, /Hi Jose/);
  assert.match(data.whatsapp.body, /Здравейте, Jose/);
  assert.match(data.whatsapp.body, /https:\/\/driftdwells\.com\/guides\/the-cabin/);
  assert.ok(!data.whatsapp.body.includes('{{guideUrl}}'));
  assert.ok(!data.whatsapp.body.includes('+359 88 800 0000'));
});

test('GMA preview renders valley email from draft template', async () => {
  await seedOldPlaceholderTemplates();
  await runReplaceTemplateCopy({ apply: true });
  const { booking } = await seedValleyBookingContext();

  process.env.APP_URL = 'https://driftdwells.com';

  const data = await previewGmaMessageForReservation({
    reservationId: String(booking._id),
    ruleKey: 'arrival_instructions_pre_arrival_valley',
    channel: 'email'
  });

  assert.ok(data.email.html.includes('Kraishte'));
  assert.ok(data.variables.guideUrl.startsWith('https://'));
});

test('seed source templates match approved copy targets', () => {
  const rows = buildAllTemplates();
  assert.equal(rows.length, 23);
  for (const target of GMA_TEMPLATE_COPY_TARGETS) {
    const row = rows.find(
      (r) =>
        r.key === target.key
        && r.channel === target.channel
        && r.propertyKind === target.propertyKind
    );
    assert.ok(row, `seed missing ${target.label}`);
    assert.equal(row.emailSubject, target.desired.emailSubject);
    assert.equal(row.emailBodyMarkup, target.desired.emailBodyMarkup);
    assert.equal(row.notes, target.desired.notes);
  }
});
