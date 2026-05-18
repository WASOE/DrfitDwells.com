/* eslint-disable no-console */
/**
 * Read-only audit: duplicate stripePaymentIntentId values on bookings.
 * Run before creating/enforcing the unique partial index on Booking.stripePaymentIntentId.
 *
 * Exit 0 when no duplicates; exit 1 when duplicates exist; exit 2 on connection/runtime error.
 */
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const Booking = require('../models/Booking');

const NON_EMPTY_PI_MATCH = {
  stripePaymentIntentId: { $exists: true, $type: 'string', $gt: '' }
};

async function runAudit() {
  const duplicates = await Booking.aggregate([
    { $match: NON_EMPTY_PI_MATCH },
    {
      $group: {
        _id: '$stripePaymentIntentId',
        count: { $sum: 1 },
        bookings: {
          $push: {
            bookingId: '$_id',
            status: '$status',
            paymentMethod: '$paymentMethod',
            checkoutId: '$checkoutId',
            createdAt: '$createdAt'
          }
        }
      }
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1, _id: 1 } }
  ]);

  return {
    audit: 'booking_stripe_payment_intent_uniqueness_readonly_v1',
    readOnly: true,
    scannedAt: new Date().toISOString(),
    duplicatePaymentIntentCount: duplicates.length,
    duplicates: duplicates.map((row) => ({
      stripePaymentIntentId: row._id,
      count: row.count,
      bookings: row.bookings.map((b) => ({
        bookingId: String(b.bookingId),
        status: b.status,
        paymentMethod: b.paymentMethod || null,
        checkoutId: b.checkoutId || null,
        createdAt: b.createdAt ? new Date(b.createdAt).toISOString() : null
      }))
    }))
  };
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
  try {
    const summary = await runAudit();
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = summary.duplicatePaymentIntentCount > 0 ? 1 : 0;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.log(
      JSON.stringify({
        audit: 'booking_stripe_payment_intent_uniqueness_readonly_v1',
        error: true,
        message: err?.message || String(err)
      })
    );
    process.exit(2);
  });
}

module.exports = { runAudit, NON_EMPTY_PI_MATCH };
