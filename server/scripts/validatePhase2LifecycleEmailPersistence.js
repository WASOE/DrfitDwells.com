/* eslint-disable no-console */
/**
 * Narrow integration: one real sendBookingLifecycleEmail + EmailEvent row in Mongo.
 * Skips (exit 0) if Mongo is unreachable. Refuses non-local URIs without DRIFT_ALLOW_VALIDATE_WRITE.
 *
 * Run from server/: npm run validate:phase2-lifecycle-email
 */
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const { assertScriptWriteAllowedForMongoUri } = require('../utils/scriptProductionGuard');
const Cabin = require('../models/Cabin');
const Booking = require('../models/Booking');
const EmailEvent = require('../models/EmailEvent');
const bookingLifecycleEmailService = require('../services/bookingLifecycleEmailService');

const CONNECT_MS = 4000;

async function main() {
  const uri = process.env.MONGODB_URI || DEFAULT_MONGO_URI;
  assertScriptWriteAllowedForMongoUri(uri);

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: CONNECT_MS });
  } catch (err) {
    console.log('[validate:phase2-lifecycle-email] SKIP: MongoDB not reachable:', err.message);
    process.exit(0);
  }

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  let cabin;
  let booking;

  try {
    cabin = await Cabin.create({
      name: `LifecyclePersist ${suffix}`,
      description: 'validatePhase2LifecycleEmailPersistence',
      capacity: 2,
      pricePerNight: 50,
      minNights: 1,
      imageUrl: 'https://example.com/a.jpg',
      location: 'Bulgaria'
    });

    const checkIn = new Date();
    checkIn.setUTCDate(checkIn.getUTCDate() + 60);
    const checkOut = new Date(checkIn);
    checkOut.setUTCDate(checkOut.getUTCDate() + 2);

    booking = await Booking.create({
      cabinId: cabin._id,
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      status: 'pending',
      guestInfo: {
        firstName: 'Persist',
        lastName: 'Test',
        email: `lifecycle-persist-${suffix}@example.com`,
        phone: '+359000000'
      },
      totalPrice: 100,
      isProductionSafe: true,
      isTest: true
    });

    const before = await EmailEvent.countDocuments({ bookingId: booking._id, type: 'LifecycleEmail' });

    const result = await bookingLifecycleEmailService.sendBookingLifecycleEmail({
      booking,
      templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_RECEIVED,
      overrideRecipient: null,
      lifecycleSource: 'automatic',
      actorContext: null
    });

    if (!result.success) {
      throw new Error(`sendBookingLifecycleEmail failed: ${result.sendResult?.error || 'unknown'}`);
    }

    const after = await EmailEvent.countDocuments({ bookingId: booking._id, type: 'LifecycleEmail' });
    if (after !== before + 1) {
      throw new Error(`Expected one new LifecycleEmail row, before=${before} after=${after}`);
    }

    const row = await EmailEvent.findOne({ bookingId: booking._id, type: 'LifecycleEmail' })
      .sort({ createdAt: -1 })
      .lean();

    if (!row) throw new Error('LifecycleEmail row missing');
    if (row.templateKey !== 'booking_received') throw new Error(`templateKey: want booking_received got ${row.templateKey}`);
    if (row.lifecycleSource !== 'automatic') throw new Error(`lifecycleSource: want automatic got ${row.lifecycleSource}`);
    if (!['success', 'skipped'].includes(row.sendStatus)) {
      throw new Error(`sendStatus unexpected: ${row.sendStatus}`);
    }
    if (row.tag !== 'lifecycle:booking_received') throw new Error(`tag: ${row.tag}`);
    if (row.overrideRecipientUsed !== false) throw new Error('overrideRecipientUsed should be false');

    console.log('[validate:phase2-lifecycle-email] OK', {
      bookingId: String(booking._id),
      sendStatus: row.sendStatus,
      deliveryMethod: row.deliveryMethod
    });
  } finally {
    if (booking?._id) {
      await EmailEvent.deleteMany({ bookingId: booking._id });
      await Booking.deleteOne({ _id: booking._id });
    }
    if (cabin?._id) {
      await Cabin.deleteOne({ _id: cabin._id });
    }
    await mongoose.disconnect().catch(() => {});
  }
}

main().catch((err) => {
  console.error('[validate:phase2-lifecycle-email] FAIL:', err);
  process.exit(1);
});
