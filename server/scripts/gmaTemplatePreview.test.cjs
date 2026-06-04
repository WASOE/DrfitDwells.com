'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const crypto = require('crypto');

const Cabin = require('../models/Cabin');
const Booking = require('../models/Booking');
const MessageAutomationRule = require('../models/MessageAutomationRule');
const MessageTemplate = require('../models/MessageTemplate');
const ScheduledMessageJob = require('../models/ScheduledMessageJob');
const MessageDispatch = require('../models/MessageDispatch');
const MessageDeliveryEvent = require('../models/MessageDeliveryEvent');
const ManualReviewItem = require('../models/ManualReviewItem');
const {
  GUEST_TEMPLATE_VARIABLE_SCHEMA,
  CABIN_WHATSAPP_BODY,
  whatsappNotes
} = require('../data/messageTemplates/gmaApprovedCopy');
const {
  previewGmaMessageForReservation,
  MessageTemplatePreviewError,
  renderTemplateString
} = require('../services/messaging/messageTemplatePreviewService');

let mongoServer;

async function seedCabinArrivalRuleAndTemplates({ emailStatus = 'draft', whatsappStatus = 'draft' } = {}) {
  await MessageAutomationRule.create({
    ruleKey: 'arrival_instructions_pre_arrival_cabin',
    description: 'Cabin arrival',
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

  await MessageTemplate.create({
    key: 'arrival_3d_the_cabin',
    version: 1,
    channel: 'email',
    locale: 'en',
    propertyKind: 'cabin',
    status: emailStatus,
    emailSubject: 'Your arrival to {{propertyName}} — {{checkInDate}}',
    emailBodyMarkup: '<p>Hi {{guestFirstName}}, meet at {{meetingPointLabel}}.</p>',
    variableSchema: GUEST_TEMPLATE_VARIABLE_SCHEMA
  });

  await MessageTemplate.create({
    key: 'arrival_3d_the_cabin',
    version: 1,
    channel: 'whatsapp',
    locale: 'en',
    propertyKind: 'cabin',
    status: whatsappStatus,
    whatsappTemplateName: 'arrival_3d_the_cabin_v1',
    whatsappLocale: 'en',
    variableSchema: GUEST_TEMPLATE_VARIABLE_SCHEMA,
    notes: whatsappNotes('arrival_3d_the_cabin_v1', CABIN_WHATSAPP_BODY)
  });
}

async function createCabinWithArrivalMetadata(overrides = {}) {
  return Cabin.create({
    name: 'The Cabin',
    description: 'test',
    location: 'Rhodopes',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/cabin.jpg',
    propertyKind: 'cabin',
    meetingPoint: {
      label: 'Park here',
      googleMapsUrl: 'https://www.google.com/maps/place/park'
    },
    arrivalGuideUrl: '/guides/the-cabin',
    arrivalWindowDefault: '14:00–18:00',
    ...overrides
  });
}

async function createConfirmedBooking(cabinId, guestOverrides = {}) {
  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 10);
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 3);
  return Booking.create({
    cabinId,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Jose',
      lastName: 'Test',
      email: 'jose.preview@example.com',
      phone: '+359881234567',
      ...guestOverrides
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
}

async function countAutomationArtifacts() {
  const [jobs, dispatches, events, mris] = await Promise.all([
    ScheduledMessageJob.countDocuments({}),
    MessageDispatch.countDocuments({}),
    MessageDeliveryEvent.countDocuments({}),
    ManualReviewItem.countDocuments({ category: /^comms_/ })
  ]);
  return { jobs, dispatches, events, mris };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Promise.all([
    Cabin.syncIndexes(),
    Booking.syncIndexes(),
    MessageAutomationRule.syncIndexes(),
    MessageTemplate.syncIndexes()
  ]);
});

test.beforeEach(async () => {
  await Promise.all([
    Cabin.deleteMany({}),
    Booking.deleteMany({}),
    MessageAutomationRule.deleteMany({}),
    MessageTemplate.deleteMany({}),
    ScheduledMessageJob.deleteMany({}),
    MessageDispatch.deleteMany({}),
    MessageDeliveryEvent.deleteMany({}),
    ManualReviewItem.deleteMany({})
  ]);
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('renderTemplateString matches dispatcher substitution semantics', () => {
  const dispatcher = require('../services/messaging/messageDispatcher');
  const { renderTemplateString: dispatcherRender } = dispatcher.__internals;
  const vars = { guestFirstName: 'Ada', guideUrl: '/guides/the-cabin', bogus: 'x' };
  const tpl = 'Hi {{guestFirstName}}, {{guideUrl}}, x={{bogus}}, y={{unknown}}';
  assert.equal(renderTemplateString(tpl, vars), dispatcherRender(tpl, vars));
});

test('renders draft email template for a booking', async () => {
  await seedCabinArrivalRuleAndTemplates();
  const cabin = await createCabinWithArrivalMetadata();
  const booking = await createConfirmedBooking(cabin._id);
  const before = await countAutomationArtifacts();

  const data = await previewGmaMessageForReservation({
    reservationId: String(booking._id),
    ruleKey: 'arrival_instructions_pre_arrival_cabin',
    channel: 'email'
  });

  const after = await countAutomationArtifacts();
  assert.deepEqual(after, before);

  assert.equal(data.template.status, 'draft');
  assert.match(data.email.subject, /The Cabin/);
  assert.match(data.email.html, /Hi Jose/);
  assert.match(data.email.html, /Park here/);
  assert.ok(data.email.text.length > 0);
  assert.equal(data.whatsapp, null);
  assert.equal(data.propertyKind, 'cabin');
});

test('renders draft WhatsApp template variable payload', async () => {
  await seedCabinArrivalRuleAndTemplates();
  const cabin = await createCabinWithArrivalMetadata();
  const booking = await createConfirmedBooking(cabin._id);
  const before = await countAutomationArtifacts();

  const data = await previewGmaMessageForReservation({
    reservationId: String(booking._id),
    ruleKey: 'arrival_instructions_pre_arrival_cabin',
    channel: 'whatsapp'
  });

  const after = await countAutomationArtifacts();
  assert.deepEqual(after, before);

  assert.equal(data.template.status, 'draft');
  assert.equal(data.whatsapp.templateName, 'arrival_3d_the_cabin_v1');
  assert.equal(data.whatsapp.locale, 'en');
  assert.equal(data.variables.guestFirstName, 'Jose');
  assert.equal(data.variables.propertyName, 'The Cabin');
  assert.ok(data.whatsapp.note.includes('template notes'));
  assert.ok(typeof data.whatsapp.body === 'string' && data.whatsapp.body.length > 0);
  assert.match(data.whatsapp.body, /Hi Jose/);
  assert.match(data.whatsapp.body, /Здравейте, Jose/);
  assert.match(data.whatsapp.body, /https:\/\/driftdwells\.com\/guides\/the-cabin/);
  assert.ok(!data.whatsapp.body.includes('href="/guides/'));
  assert.equal(data.email, null);
});

test('fails with 422 when required variables are missing', async () => {
  await seedCabinArrivalRuleAndTemplates();
  const cabin = await createCabinWithArrivalMetadata({
    meetingPoint: { label: '', googleMapsUrl: '' },
    arrivalGuideUrl: ''
  });
  const booking = await createConfirmedBooking(cabin._id);

  await assert.rejects(
    () =>
      previewGmaMessageForReservation({
        reservationId: String(booking._id),
        ruleKey: 'arrival_instructions_pre_arrival_cabin',
        channel: 'email'
      }),
    (err) => {
      assert.ok(err instanceof MessageTemplatePreviewError);
      assert.equal(err.status, 422);
      assert.equal(err.errorType, 'missing_variables');
      assert.ok(Array.isArray(err.details?.missing));
      assert.ok(err.details.missing.length > 0);
      return true;
    }
  );
});

test('rejects unknown ruleKey', async () => {
  await seedCabinArrivalRuleAndTemplates();
  const cabin = await createCabinWithArrivalMetadata();
  const booking = await createConfirmedBooking(cabin._id);

  await assert.rejects(
    () =>
      previewGmaMessageForReservation({
        reservationId: String(booking._id),
        ruleKey: 'not_a_real_rule',
        channel: 'email'
      }),
    (err) => {
      assert.ok(err instanceof MessageTemplatePreviewError);
      assert.equal(err.status, 400);
      return true;
    }
  );
});

test('rejects rule scope mismatch for valley rule on cabin stay', async () => {
  await MessageAutomationRule.create({
    ruleKey: 'arrival_instructions_pre_arrival_valley',
    description: 'Valley',
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
  await seedCabinArrivalRuleAndTemplates();
  const cabin = await createCabinWithArrivalMetadata({ propertyKind: 'cabin' });
  const booking = await createConfirmedBooking(cabin._id);

  await assert.rejects(
    () =>
      previewGmaMessageForReservation({
        reservationId: String(booking._id),
        ruleKey: 'arrival_instructions_pre_arrival_valley',
        channel: 'email'
      }),
    (err) => {
      assert.ok(err instanceof MessageTemplatePreviewError);
      assert.equal(err.status, 409);
      return true;
    }
  );
});

test('preview service module does not require dispatcher or emailService', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../services/messaging/messageTemplatePreviewService.js'),
    'utf8'
  );
  assert.ok(!/require\(['"].*messageDispatcher/.test(src));
  assert.ok(!/require\(['"].*emailService/.test(src));
  assert.ok(!/require\(['"].*providerRegistry/.test(src));
  assert.ok(!/require\(['"].*devShadow/.test(src));
});
