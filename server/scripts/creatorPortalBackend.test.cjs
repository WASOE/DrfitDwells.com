/**
 * Creator portal backend (11B): access tokens, session cookie, /me DTO privacy.
 * Run: cd server && node --test scripts/creatorPortalBackend.test.cjs
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const crypto = require('crypto');

process.env.CREATOR_PORTAL_SESSION_SECRET = 'unit-test-creator-portal-session-secret-32';
process.env.CREATOR_PORTAL_TOKEN_VERSION = '1';
process.env.NODE_ENV = 'test';

const CreatorPartner = require('../models/CreatorPartner');
const CreatorPortalAccess = require('../models/CreatorPortalAccess');
const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const { createCreatorPortalAccessLink, exchangeMagicTokenForSession } = require('../services/creatorPortal/creatorPortalAccessService');
const { issueSessionToken, verifySessionToken } = require('../services/creatorPortal/creatorPortalSession');
const { buildCreatorPortalMe } = require('../services/creatorPortal/creatorPortalMeService');
const { redactAccessLogUrl } = require('../utils/redactAccessLogUrl');

let mongoServer;

test('redactAccessLogUrl redacts creator-portal verify magic token', () => {
  assert.equal(
    redactAccessLogUrl('/api/creator-portal/verify?token=supersecret'),
    '/api/creator-portal/verify?token=[redacted]'
  );
});

test('redactAccessLogUrl redacts token with other query params', () => {
  assert.equal(
    redactAccessLogUrl('/api/creator-portal/verify?x=1&token=abc&y=2'),
    '/api/creator-portal/verify?x=1&token=[redacted]&y=2'
  );
});

test('redactAccessLogUrl does not touch other paths', () => {
  assert.equal(
    redactAccessLogUrl('/api/booking/foo?token=leave'),
    '/api/booking/foo?token=leave'
  );
});

async function createCabin() {
  return Cabin.create({
    name: 'Portal Cabin',
    description: 't',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/cabin.jpg',
    location: 'B',
    isActive: true,
    transportOptions: []
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await CreatorPartner.syncIndexes();
  await CreatorPortalAccess.syncIndexes();
  await Booking.syncIndexes();
  await Cabin.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await CreatorPortalAccess.deleteMany({});
  await Booking.deleteMany({});
  await Cabin.deleteMany({});
  await CreatorPartner.deleteMany({});
});

test('createCreatorPortalAccessLink returns verifyUrl and single-use exchange works', async () => {
  const p = await CreatorPartner.create({
    name: 'T',
    slug: 't-portal',
    status: 'active',
    referral: { code: 't.ref', cookieDays: 60 },
    commission: { rateBps: 500, basis: 'accommodation_net', eligibleAfter: 'stay_completed' }
  });
  const { verifyUrl, creatorPartnerId } = await createCreatorPortalAccessLink(String(p._id), 'ops@test');
  assert.match(verifyUrl, /\/api\/creator-portal\/verify\?token=/);
  assert.equal(creatorPartnerId, String(p._id));
  const u = new URL(verifyUrl, 'http://localhost');
  const raw = u.searchParams.get('token');
  assert.ok(raw && raw.length > 20);

  const out1 = await exchangeMagicTokenForSession(raw);
  assert.equal(out1.ok, true);
  assert.ok(out1.session?.token);

  const out2 = await exchangeMagicTokenForSession(raw);
  assert.equal(out2.ok, false);
  assert.equal(out2.code, 'used');
});

test('invalid token rejected', async () => {
  const out = await exchangeMagicTokenForSession('not-a-real-token');
  assert.equal(out.ok, false);
});

test('session token roundtrip', async () => {
  const p = await CreatorPartner.create({
    name: 'S',
    slug: 's-portal',
    status: 'active',
    referral: { code: 's.ref', cookieDays: 60 },
    commission: { rateBps: 1000, basis: 'accommodation_net', eligibleAfter: 'stay_completed' }
  });
  const { token } = issueSessionToken(String(p._id));
  const payload = verifySessionToken(token);
  assert.ok(payload);
  assert.equal(payload.cp, String(p._id));
});

test('buildCreatorPortalMe has no guest email in JSON', async () => {
  const p = await CreatorPartner.create({
    name: 'GuestHide',
    slug: 'gh-portal',
    status: 'active',
    referral: { code: 'gh.ref', cookieDays: 60 },
    promo: { code: 'GHPROMO' },
    commission: { rateBps: 1000, basis: 'accommodation_net', eligibleAfter: 'stay_completed' }
  });
  const cabin = await createCabin();
  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 10);
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 2);
  await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Secret',
      lastName: 'Person',
      email: 'secret-leak-test@example.com',
      phone: '+1000000000'
    },
    status: 'confirmed',
    totalPrice: 200,
    subtotalPrice: 200,
    discountAmount: 0,
    totalValueCents: 20000,
    giftVoucherAppliedCents: 0,
    stripePaidAmountCents: 20000,
    stripePaymentIntentId: `pi_${crypto.randomBytes(4).toString('hex')}`,
    promoCode: 'GHPROMO',
    attribution: { referralCode: 'gh.ref' }
  });

  const me = await buildCreatorPortalMe(p._id);
  assert.ok(me);
  const json = JSON.stringify(me);
  assert.equal(json.includes('secret-leak-test'), false);
  assert.equal(json.includes('+1000000000'), false);
  assert.equal(json.includes('pi_'), false);
  assert.equal(json.includes('Secret'), false);
  assert.ok(Array.isArray(me.recentBookings));
});

test('draft partner cannot get portal link', async () => {
  const p = await CreatorPartner.create({
    name: 'D',
    slug: 'd-portal',
    status: 'draft',
    referral: { code: 'd.ref', cookieDays: 60 },
    commission: { rateBps: 1000, basis: 'accommodation_net', eligibleAfter: 'stay_completed' }
  });
  await assert.rejects(() => createCreatorPortalAccessLink(String(p._id), 'ops'), (e) => e.code === 'INVALID_STATUS');
});
