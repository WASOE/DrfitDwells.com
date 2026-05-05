/* eslint-disable no-console */
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const Booking = require('../models/Booking');
const { linkStripePaymentToBooking } = require('../services/payments/paymentLinkingService');

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  const getLimit = () => {
    for (const token of argv.slice(2)) {
      if (!token.startsWith('--limit=')) continue;
      const raw = token.split('=')[1];
      const value = parseInt(raw, 10);
      return Number.isFinite(value) && value > 0 ? value : null;
    }
    return null;
  };
  return {
    apply: args.has('--apply'),
    limit: getLimit()
  };
}

function isActiveOrConfirmedStatus(status) {
  return ['confirmed', 'in_house', 'completed'].includes(status);
}

async function run() {
  const { apply, limit } = parseArgs(process.argv);
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);

  const summary = {
    apply,
    scanned: 0,
    alreadyLinked: 0,
    wouldLink: 0,
    linked: 0,
    notFound: 0,
    conflicts: 0,
    errors: 0,
    sampleRows: []
  };

  try {
    const filter = {
      status: { $in: ['confirmed', 'in_house', 'completed'] },
      stripePaymentIntentId: { $exists: true, $nin: [null, ''] },
      totalPrice: { $gt: 0 },
      isTest: { $ne: true },
      $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }]
    };

    let query = Booking.find(filter)
      .select('_id status stripePaymentIntentId totalPrice provenance')
      .sort({ createdAt: -1 });
    if (limit) {
      query = query.limit(limit);
    }
    const bookings = await query.lean();

    for (const booking of bookings) {
      if (!isActiveOrConfirmedStatus(booking.status)) continue;
      summary.scanned += 1;

      try {
        const result = await linkStripePaymentToBooking({
          booking,
          linkedBy: apply ? 'script_reconcile_apply' : 'script_reconcile_dry_run',
          apply
        });

        if (result.status === 'already_linked') {
          summary.alreadyLinked += 1;
        } else if (result.status === 'linked') {
          if (apply) {
            summary.linked += 1;
          } else {
            summary.wouldLink += 1;
          }
        } else if (result.status === 'not_found') {
          summary.notFound += 1;
        } else if (result.status === 'conflict') {
          summary.conflicts += 1;
        } else if (result.status === 'invalid_input') {
          summary.errors += 1;
        } else if (result.status === 'error') {
          summary.errors += 1;
        }

        if (summary.sampleRows.length < 20) {
          summary.sampleRows.push({
            bookingId: String(booking._id),
            status: booking.status,
            stripePaymentIntentId: booking.stripePaymentIntentId,
            totalPrice: booking.totalPrice,
            result: result.status,
            paymentId: result.paymentId || null,
            existingReservationId: result.existingReservationId || null
          });
        }

      } catch (error) {
        summary.errors += 1;
        if (summary.sampleRows.length < 20) {
          summary.sampleRows.push({
            bookingId: String(booking._id),
            status: booking.status,
            stripePaymentIntentId: booking.stripePaymentIntentId,
            totalPrice: booking.totalPrice,
            result: 'error',
            error: error.message
          });
        }
      }
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
  process.exit(1);
});
