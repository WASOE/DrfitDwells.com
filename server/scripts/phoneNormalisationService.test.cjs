/**
 * Phone normalisation + GuestContactPreference sync (flag-gated) tests.
 *
 * Run: npm run test:phone-normalisation (from server/)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { normaliseGuestPhoneRaw } = require('../services/messaging/phoneNormalisationService');
const GuestContactPreference = require('../models/GuestContactPreference');

function makeBooking(overrides = {}) {
  const id = overrides._id || new mongoose.Types.ObjectId();
  const guestInfo = {
    phone: '0888123456',
    email: 'Guest@Example.com',
    ...(overrides.guestInfo || {})
  };
  return { _id: id, guestInfo };
}

// ---------------------------------------------------------------------------
// normaliseGuestPhoneRaw (pure)
// ---------------------------------------------------------------------------

test('empty / whitespace-only → invalid, empty rawValueLastSeen', () => {
  assert.equal(normaliseGuestPhoneRaw('').phoneStatus, 'invalid');
  assert.equal(normaliseGuestPhoneRaw('   ').phoneStatus, 'invalid');
  assert.equal(normaliseGuestPhoneRaw('').rawValueLastSeen, '');
});

test('BG national mobile with default BG → valid E.164', () => {
  const r = normaliseGuestPhoneRaw('0888123456', { defaultCountry: 'BG' });
  assert.equal(r.phoneStatus, 'valid');
  assert.equal(r.recipientValue, '+359888123456');
  assert.equal(r.phoneCountry, 'BG');
  assert.equal(r.rawValueLastSeen, '0888123456');
});

test('leading + uses international parse (no default country)', () => {
  const r = normaliseGuestPhoneRaw('+12025550123', { defaultCountry: 'BG' });
  assert.equal(r.phoneStatus, 'valid');
  assert.equal(r.recipientValue, '+12025550123');
  assert.equal(r.phoneCountry, 'US');
});

test('gibberish → invalid', () => {
  const r = normaliseGuestPhoneRaw('not-a-phone', { defaultCountry: 'BG' });
  assert.equal(r.phoneStatus, 'invalid');
  assert.equal(r.recipientValue, null);
});

// ---------------------------------------------------------------------------
// syncGuestContactPreferencesForBooking — flag off (no mongoose)
// ---------------------------------------------------------------------------

test('sync with flag unset performs no DB work and does not throw', async () => {
  const prev = process.env.MESSAGE_GUEST_CONTACT_PREF_SYNC_ENABLED;
  delete process.env.MESSAGE_GUEST_CONTACT_PREF_SYNC_ENABLED;
  const { syncGuestContactPreferencesForBooking } = require('../services/messaging/guestContactPreferenceSync');
  await syncGuestContactPreferencesForBooking(makeBooking({ guestInfo: { phone: 'x', email: 'a@b.c' } }));
  if (prev === undefined) delete process.env.MESSAGE_GUEST_CONTACT_PREF_SYNC_ENABLED;
  else process.env.MESSAGE_GUEST_CONTACT_PREF_SYNC_ENABLED = prev;
});

// ---------------------------------------------------------------------------
// syncGuestContactPreferencesForBooking — flag on + MongoMemoryServer
// ---------------------------------------------------------------------------

test.describe('sync with MESSAGE_GUEST_CONTACT_PREF_SYNC_ENABLED=1', () => {
  let mongoServer;
  let prevFlag;
  let prevDefaultCc;

  test.before(async () => {
    prevFlag = process.env.MESSAGE_GUEST_CONTACT_PREF_SYNC_ENABLED;
    prevDefaultCc = process.env.DEFAULT_PHONE_COUNTRY;
    process.env.MESSAGE_GUEST_CONTACT_PREF_SYNC_ENABLED = '1';
    process.env.DEFAULT_PHONE_COUNTRY = 'BG';

    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
    await GuestContactPreference.syncIndexes();
  });

  test.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();

    if (prevFlag === undefined) delete process.env.MESSAGE_GUEST_CONTACT_PREF_SYNC_ENABLED;
    else process.env.MESSAGE_GUEST_CONTACT_PREF_SYNC_ENABLED = prevFlag;
    if (prevDefaultCc === undefined) delete process.env.DEFAULT_PHONE_COUNTRY;
    else process.env.DEFAULT_PHONE_COUNTRY = prevDefaultCc;
  });

  test.beforeEach(async () => {
    await GuestContactPreference.deleteMany({});
  });

  test('invalid phone → whatsapp stub invalid:<bookingId>', async () => {
    const { syncGuestContactPreferencesForBooking } = require('../services/messaging/guestContactPreferenceSync');
    const booking = makeBooking({ guestInfo: { phone: 'nope', email: 'skip@invalid' } });
    await syncGuestContactPreferencesForBooking(booking);

    const stub = await GuestContactPreference.findOne({
      recipientType: 'whatsapp_phone',
      recipientValue: `invalid:${String(booking._id)}`
    });
    assert.ok(stub);
    assert.equal(stub.phoneStatus, 'invalid');
    assert.ok(stub.linkedBookingIds.some((id) => String(id) === String(booking._id)));
  });

  test('valid phone → whatsapp E.164 row; malformed email skipped', async () => {
    const { syncGuestContactPreferencesForBooking } = require('../services/messaging/guestContactPreferenceSync');
    const booking = makeBooking({ guestInfo: { phone: '0888123456', email: 'not an email' } });
    await syncGuestContactPreferencesForBooking(booking);

    const wa = await GuestContactPreference.findOne({
      recipientType: 'whatsapp_phone',
      recipientValue: '+359888123456'
    });
    assert.ok(wa);
    assert.equal(wa.phoneStatus, 'valid');
    assert.equal(wa.phoneCountry, 'BG');
    assert.equal(wa.rawValueLastSeen, '0888123456');
    assert.equal(wa.transactional, 'unknown');
    assert.equal(wa.marketing, 'denied');

    const emails = await GuestContactPreference.find({ recipientType: 'email' });
    assert.equal(emails.length, 0);
  });

  test('valid phone + valid email → both rows', async () => {
    const { syncGuestContactPreferencesForBooking } = require('../services/messaging/guestContactPreferenceSync');
    const booking = makeBooking({ guestInfo: { phone: '+359888123456', email: 'Guest@Example.com' } });
    await syncGuestContactPreferencesForBooking(booking);

    const em = await GuestContactPreference.findOne({ recipientType: 'email', recipientValue: 'guest@example.com' });
    assert.ok(em);
    assert.equal(em.transactional, 'unknown');
    assert.equal(em.marketing, 'denied');
  });

  test('invalid then valid same booking removes stub and uses E.164', async () => {
    const { syncGuestContactPreferencesForBooking } = require('../services/messaging/guestContactPreferenceSync');
    const booking = makeBooking({ guestInfo: { phone: 'bad', email: 'x@y.z' } });
    await syncGuestContactPreferencesForBooking(booking);

    booking.guestInfo.phone = '0888123456';
    await syncGuestContactPreferencesForBooking(booking);

    const stub = await GuestContactPreference.findOne({
      recipientType: 'whatsapp_phone',
      recipientValue: `invalid:${String(booking._id)}`
    });
    assert.equal(stub, null);

    const wa = await GuestContactPreference.findOne({
      recipientType: 'whatsapp_phone',
      recipientValue: '+359888123456'
    });
    assert.ok(wa);
    assert.ok(wa.linkedBookingIds.some((id) => String(id) === String(booking._id)));
  });
});
