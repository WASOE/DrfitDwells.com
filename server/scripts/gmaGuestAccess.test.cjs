/**
 * GMA-GUEST-ACCESS-1 — access credential resolver, templates, and security tests.
 * Run: npm run test:gma-guest-access (from server/)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const {
  CABIN_EMAIL_BODY,
  VALLEY_EMAIL_BODY,
  ACCESS_CABIN_EMAIL_BODY,
  ACCESS_VALLEY_EMAIL_BODY
} = require('../data/messageTemplates/gmaApprovedCopy');
const { cabinAccessEmailTemplate } = require('../data/messageTemplates/access_day_before_the_cabin');
const { valleyAccessEmailTemplate } = require('../data/messageTemplates/access_day_before_the_valley');
const {
  checkInAccessDayBeforeCabinRule,
  checkInAccessDayBeforeValleyRule
} = require('../data/messageAutomationRules');
const {
  resolveGuestVariables,
  resolveGuestAccessVariables
} = require('../services/messaging/messageVariableResolver');
const { renderTemplateString } = require('../services/messaging/messageTemplatePreviewService');
const { CABIN_GOOGLE_EARTH_URL } = require('../data/stayAccessCredentials');

let mongoServer;
let bookingSeq = 0;

function futureDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

async function insertCabin(overrides = {}) {
  return Cabin.create({
    name: 'The Cabin',
    slug: 'the-cabin',
    description: 'test',
    location: 'Rhodopes',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/cabin.jpg',
    propertyKind: 'cabin',
    meetingPoint: {
      label: 'Park point',
      googleMapsUrl: 'https://www.google.com/maps/place/cabin-park'
    },
    arrivalGuideUrl: '/guides/the-cabin',
    arrivalWindowDefault: 'From 15:00',
    ...overrides
  });
}

async function insertLuxCabin() {
  return insertCabin({
    name: 'Lux Cabin',
    slug: 'lux-cabin',
    propertyKind: 'valley',
    cleaningTags: ['lux-cabin'],
    arrivalGuideUrl: '/guides/the-valley/lux-cabin'
  });
}

async function insertStoneHouse() {
  return insertCabin({
    name: 'Stone House',
    slug: 'stone-house',
    propertyKind: 'valley',
    cleaningTags: ['stone-house'],
    arrivalGuideUrl: '/guides/the-valley/stone-house'
  });
}

async function insertAFrameType() {
  return CabinType.create({
    name: 'A-Frame',
    slug: 'a-frame',
    description: 'test',
    location: 'Valley',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 120,
    minNights: 1,
    imageUrl: 'https://example.com/aframe.jpg',
    propertyKind: 'valley',
    meetingPoint: {
      label: 'Chereshovo parking',
      googleMapsUrl: 'https://maps.app.goo.gl/vTk7jCrGtxvbKsJB6'
    },
    arrivalGuideUrl: '/guides/the-valley/a-frame',
    arrivalWindowDefault: 'From 15:00'
  });
}

async function insertAFrameUnit(cabinTypeId, { unitNumber, displayName }) {
  return Unit.create({ cabinTypeId, unitNumber, displayName, isActive: true });
}

async function insertBooking({ cabin, cabinType, unit, overrides = {} }) {
  bookingSeq += 1;
  return Booking.create({
    cabinId: cabin?._id || null,
    cabinTypeId: cabinType?._id || null,
    unitId: unit?._id || null,
    checkIn: futureDate(5),
    checkOut: futureDate(8),
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Alex',
      lastName: 'Guest',
      email: 'alex.guest@example.com',
      phone: '+359881234567'
    },
    status: 'confirmed',
    totalPrice: 300,
    subtotalPrice: 300,
    discountAmount: 0,
    totalValueCents: 30000,
    giftVoucherAppliedCents: 0,
    stripePaidAmountCents: 30000,
    stripePaymentIntentId: `pi_access_test_${bookingSeq}`,
    ...overrides
  });
}

function renderAccessBody(templateBody, variables) {
  return renderTemplateString(templateBody, variables);
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    Cabin.deleteMany({}),
    CabinType.deleteMany({}),
    Unit.deleteMany({}),
    Booking.deleteMany({})
  ]);
});

test('access rules ship shadow-gated and email_only', () => {
  for (const rule of [checkInAccessDayBeforeCabinRule, checkInAccessDayBeforeValleyRule]) {
    assert.equal(rule.enabled, false);
    assert.equal(rule.mode, 'shadow');
    assert.equal(rule.channelStrategy, 'email_only');
    assert.equal(rule.triggerConfig.offsetHours, -24);
    assert.equal(rule.triggerConfig.sofiaHour, 9);
    assert.equal(rule.audience, 'guest');
    assert.equal(rule.templateKeyByChannel.whatsapp, undefined);
  }
});

test('Lux Cabin resolves lock code 0707', async () => {
  const cabin = await insertLuxCabin();
  const booking = await insertBooking({ cabin });
  const result = await resolveGuestAccessVariables({
    booking,
    stayTarget: cabin,
    propertyKind: 'valley'
  });
  assert.equal(result.ok, true);
  assert.equal(result.variables.lockCode, '0707');
  assert.equal(result.resolutionSource, 'valley:cabin:lux-cabin');
});

test('Stone House resolves lock code 9797 and WiFi', async () => {
  const cabin = await insertStoneHouse();
  const booking = await insertBooking({ cabin });
  const result = await resolveGuestAccessVariables({
    booking,
    stayTarget: cabin,
    propertyKind: 'valley'
  });
  assert.equal(result.ok, true);
  assert.equal(result.variables.lockCode, '9797');
  assert.equal(result.variables.wifiNetworkName, 'Drift&Dwells');
  assert.match(result.variables.wifiAccessBlock, /Stone House/);
});

test('A-Frame 2 resolves lock code 2727', async () => {
  const cabinType = await insertAFrameType();
  const unit = await insertAFrameUnit(cabinType._id, {
    unitNumber: 'AF-02',
    displayName: 'A-Frame 2'
  });
  const booking = await insertBooking({ cabinType, unit });
  const result = await resolveGuestAccessVariables({
    booking,
    stayTarget: cabinType,
    propertyKind: 'valley'
  });
  assert.equal(result.ok, true);
  assert.equal(result.variables.lockCode, '2727');
  assert.equal(result.variables.propertyName, 'A-Frame 2');
});

test('A-Frame 3 resolves lock code 3737', async () => {
  const cabinType = await insertAFrameType();
  const unit = await insertAFrameUnit(cabinType._id, {
    unitNumber: 'AF-03',
    displayName: 'A-Frame 3'
  });
  const booking = await insertBooking({ cabinType, unit });
  const result = await resolveGuestAccessVariables({
    booking,
    stayTarget: cabinType,
    propertyKind: 'valley'
  });
  assert.equal(result.ok, true);
  assert.equal(result.variables.lockCode, '3737');
});

test('A-Frame without unit assignment blocks access resolution', async () => {
  const cabinType = await insertAFrameType();
  const booking = await insertBooking({ cabinType, unit: null });
  const result = await resolveGuestAccessVariables({
    booking,
    stayTarget: cabinType,
    propertyKind: 'valley'
  });
  assert.equal(result.ok, false);
  assert.equal(result.blockReason, 'a_frame_unit_unassigned');
  assert.ok(result.missing.includes('lockCode'));
});

test('A-Frame 1 blocks automated access code', async () => {
  const cabinType = await insertAFrameType();
  const unit = await insertAFrameUnit(cabinType._id, {
    unitNumber: 'AF-01',
    displayName: 'A-Frame 1'
  });
  const booking = await insertBooking({ cabinType, unit });
  const result = await resolveGuestAccessVariables({
    booking,
    stayTarget: cabinType,
    propertyKind: 'valley'
  });
  assert.equal(result.ok, false);
  assert.equal(result.blockReason, 'a_frame_1_not_automated');
});

test('The Cabin resolves 2727 and Google Earth URL', async () => {
  const cabin = await insertCabin();
  const booking = await insertBooking({ cabin });
  const result = await resolveGuestAccessVariables({
    booking,
    stayTarget: cabin,
    propertyKind: 'cabin'
  });
  assert.equal(result.ok, true);
  assert.equal(result.variables.lockCode, '2727');
  assert.equal(result.variables.googleEarthUrl, CABIN_GOOGLE_EARTH_URL);
  const body = renderAccessBody(ACCESS_CABIN_EMAIL_BODY, result.variables);
  assert.match(body, /Google Earth/);
  assert.match(body, /earth\.google\.com/);
});

test('Cabin access email does not include Valley route text', async () => {
  const cabin = await insertCabin();
  const booking = await insertBooking({ cabin });
  const result = await resolveGuestAccessVariables({
    booking,
    stayTarget: cabin,
    propertyKind: 'cabin'
  });
  const body = renderAccessBody(ACCESS_CABIN_EMAIL_BODY, result.variables);
  assert.equal(body.includes('Kraishte'), false);
  assert.equal(body.includes('Eleshnitsa'), false);
  assert.equal(body.includes('Palatik'), false);
  assert.equal(body.includes('Chereshovo'), false);
});

test('Valley access email includes route and Kraishte warning', async () => {
  const cabin = await insertLuxCabin();
  const booking = await insertBooking({ cabin });
  const result = await resolveGuestAccessVariables({
    booking,
    stayTarget: cabin,
    propertyKind: 'valley'
  });
  const body = renderAccessBody(ACCESS_VALLEY_EMAIL_BODY, result.variables);
  assert.match(body, /Eleshnitsa/);
  assert.match(body, /Palatik/);
  assert.match(body, /Chereshovo/);
  assert.match(body, /Kraishte/);
  assert.match(body, /Transfer: €20/);
});

test('T-72h preparation emails unchanged — guest variable bag has 8 keys only', async () => {
  const cabin = await insertCabin();
  const booking = await insertBooking({ cabin });
  const prep = resolveGuestVariables({ booking, stayTarget: cabin });
  assert.equal(prep.ok, true);
  assert.deepEqual(Object.keys(prep.variables).sort(), [
    'arrivalWindow',
    'checkInDate',
    'checkOutDate',
    'googleMapsUrl',
    'guestFirstName',
    'guideUrl',
    'meetingPointLabel',
    'propertyName'
  ]);
  const prepBody = renderAccessBody(CABIN_EMAIL_BODY, prep.variables);
  assert.equal(prepBody.includes('{{lockCode}}'), false);
  assert.equal(prepBody.includes('0707'), false);
  assert.equal(prepBody.includes('2727'), false);
});

test('access templates declare extended variable schemas', () => {
  assert.ok(cabinAccessEmailTemplate.variableSchema.required.includes('lockCode'));
  assert.ok(cabinAccessEmailTemplate.variableSchema.required.includes('googleEarthUrl'));
  assert.ok(valleyAccessEmailTemplate.variableSchema.required.includes('transferOfferNote'));
  assert.equal(valleyAccessEmailTemplate.variableSchema.required.includes('googleEarthUrl'), false);
});

test('no lock codes in public guide API or client guide pages', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const lockPatterns = ['0707', '9797', '3737'];
  const publicApi = fs.readFileSync(
    path.join(repoRoot, 'server/routes/publicGuideRoutes.js'),
    'utf8'
  );
  for (const code of lockPatterns) {
    assert.equal(publicApi.includes(code), false, `publicGuideRoutes must not contain ${code}`);
  }

  const guideDirs = [
    path.join(repoRoot, 'client/src/pages/guides'),
    path.join(repoRoot, 'server/routes/publicGuideRoutes.js')
  ];
  const combined = guideDirs
    .map((p) => (fs.statSync(p).isDirectory()
      ? fs.readdirSync(p, { recursive: true })
          .filter((f) => String(f).endsWith('.jsx') || String(f).endsWith('.js'))
          .map((f) => fs.readFileSync(path.join(p, f), 'utf8'))
          .join('\n')
      : fs.readFileSync(p, 'utf8')))
    .join('\n');

  for (const code of lockPatterns) {
    assert.equal(combined.includes(code), false, `public guides must not contain lock code ${code}`);
  }
});

test('preparation valley body still renders without access variables', async () => {
  const cabin = await insertStoneHouse();
  const booking = await insertBooking({ cabin });
  const prep = resolveGuestVariables({ booking, stayTarget: cabin });
  const body = renderAccessBody(VALLEY_EMAIL_BODY, prep.variables);
  assert.match(body, /Kraishte/);
  assert.equal(body.includes('Access code'), false);
});
