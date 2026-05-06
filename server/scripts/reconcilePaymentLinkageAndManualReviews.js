/* eslint-disable no-console */
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const ManualReviewItem = require('../models/ManualReviewItem');

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  const getLimit = () => {
    for (const token of argv.slice(2)) {
      if (!token.startsWith('--limit=')) continue;
      const raw = token.split('=')[1];
      const value = parseInt(raw, 10);
      return Number.isFinite(value) && value > 0 ? value : null;
    }
    return 100;
  };
  return {
    apply: args.has('--apply'),
    limit: getLimit()
  };
}

function normalizePi(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return v || null;
}

function amountMatches(paymentAmount, bookingTotalPrice) {
  if (!Number.isFinite(paymentAmount) || !Number.isFinite(bookingTotalPrice)) return true;
  return Math.abs(Number(paymentAmount) - Number(bookingTotalPrice)) < 0.01;
}

function getPaymentIntentCandidates(payment) {
  const values = [
    payment.providerReference,
    payment.paymentIntentId,
    payment.stripePaymentIntentId,
    payment.metadata?.paymentIntentId,
    payment.metadata?.stripePaymentIntentId,
    payment.metadata?.id
  ]
    .map(normalizePi)
    .filter(Boolean);
  return [...new Set(values)];
}

async function run() {
  const { apply, limit } = parseArgs(process.argv);
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);

  const nowIso = new Date().toISOString();
  const summary = {
    apply,
    limit,
    scannedUnlinkedPayments: 0,
    unlinkedPaymentsWithoutPi: 0,
    noBookingMatch: 0,
    amountMismatch: 0,
    bookingConflicts: 0,
    alreadyLinked: 0,
    wouldLink: 0,
    linked: 0,
    writeErrors: 0,
    staleReviewsScanned: 0,
    staleReviewsWouldResolve: 0,
    staleReviewsResolved: 0,
    staleReviewResolveErrors: 0,
    bozhidarCheck: {
      bookingId: '69f8c505872d0d92a0efdd47',
      paymentId: '69f8c504d383478dc6cbacb4',
      matched: false,
      result: null
    },
    sampleLinks: [],
    sampleConflicts: [],
    sampleResolvedReviews: []
  };

  try {
    let paymentQuery = Payment.find({ reservationId: null, provider: 'stripe' })
      .sort({ createdAt: -1 })
      .limit(limit);
    const unlinkedPayments = await paymentQuery.lean();
    summary.scannedUnlinkedPayments = unlinkedPayments.length;

    const allPi = new Set();
    const piByPaymentId = new Map();
    for (const payment of unlinkedPayments) {
      const keys = getPaymentIntentCandidates(payment);
      piByPaymentId.set(String(payment._id), keys);
      for (const key of keys) allPi.add(key);
    }

    const bookings = await Booking.find({
      status: { $in: ['confirmed', 'in_house', 'completed', 'cancelled'] },
      stripePaymentIntentId: { $in: [...allPi] },
      isTest: { $ne: true },
      $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }]
    })
      .select('_id status stripePaymentIntentId totalPrice isTest archivedAt')
      .lean();

    const bookingsByPi = new Map();
    for (const booking of bookings) {
      const key = normalizePi(booking.stripePaymentIntentId);
      if (!key) continue;
      if (!bookingsByPi.has(key)) bookingsByPi.set(key, []);
      bookingsByPi.get(key).push(booking);
    }

    for (const payment of unlinkedPayments) {
      const paymentId = String(payment._id);
      const keys = piByPaymentId.get(paymentId) || [];
      if (keys.length === 0) {
        summary.unlinkedPaymentsWithoutPi += 1;
        continue;
      }

      const candidateBookings = [];
      for (const key of keys) {
        const hits = bookingsByPi.get(key) || [];
        for (const b of hits) candidateBookings.push({ key, booking: b });
      }

      if (candidateBookings.length === 0) {
        summary.noBookingMatch += 1;
        continue;
      }

      const amountCompatible = candidateBookings.filter(({ booking }) =>
        amountMatches(payment.amount, booking.totalPrice)
      );
      if (amountCompatible.length === 0) {
        summary.amountMismatch += 1;
        continue;
      }

      const uniqBookingIds = [...new Set(amountCompatible.map(({ booking }) => String(booking._id)))];
      if (uniqBookingIds.length !== 1) {
        summary.bookingConflicts += 1;
        if (summary.sampleConflicts.length < 20) {
          summary.sampleConflicts.push({
            paymentId,
            paymentReference: payment.providerReference || null,
            paymentIntentCandidates: keys,
            bookingIds: uniqBookingIds
          });
        }
        continue;
      }

      const chosen = amountCompatible.find(({ booking }) => String(booking._id) === uniqBookingIds[0]);
      const booking = chosen.booking;
      const payload = {
        paymentId,
        bookingId: String(booking._id),
        bookingStatus: booking.status,
        paymentStatus: payment.status,
        paymentReference: payment.providerReference || null,
        paymentIntentMatchKey: chosen.key,
        amount: payment.amount,
        bookingTotalPrice: booking.totalPrice
      };

      if (!apply) {
        summary.wouldLink += 1;
        if (summary.sampleLinks.length < 30) summary.sampleLinks.push({ ...payload, action: 'would_link' });
      } else {
        try {
          const updateRes = await Payment.updateOne(
            { _id: payment._id, reservationId: null },
            {
              $set: {
                reservationId: booking._id,
                metadata: {
                  ...(payment.metadata || {}),
                  linkedBy: 'script_reconcile_payment_linkage_manual_reviews',
                  linkedAt: nowIso,
                  linkageConfidence: 'high',
                  linkageReason: 'exact_payment_intent_match'
                }
              }
            }
          );
          if (updateRes.modifiedCount === 1) {
            summary.linked += 1;
            if (summary.sampleLinks.length < 30) summary.sampleLinks.push({ ...payload, action: 'linked' });
          } else {
            const latest = await Payment.findById(payment._id).lean();
            if (latest?.reservationId) {
              summary.alreadyLinked += 1;
            } else {
              summary.writeErrors += 1;
            }
          }
        } catch (error) {
          summary.writeErrors += 1;
          if (summary.sampleLinks.length < 30) summary.sampleLinks.push({ ...payload, action: 'error', error: error.message });
        }
      }

      if (paymentId === summary.bozhidarCheck.paymentId || String(booking._id) === summary.bozhidarCheck.bookingId) {
        summary.bozhidarCheck.matched = true;
        summary.bozhidarCheck.result = {
          paymentId,
          bookingId: String(booking._id),
          bookingStatus: booking.status,
          paymentStatus: payment.status,
          action: apply ? 'linked_or_already' : 'would_link'
        };
      }
    }

    const staleReviews = await ManualReviewItem.find({
      status: 'open',
      category: 'payment_unlinked',
      entityType: 'Payment',
      entityId: { $ne: null }
    })
      .sort({ createdAt: -1 })
      .lean();
    summary.staleReviewsScanned = staleReviews.length;

    const paymentIdsFromReviews = [...new Set(staleReviews.map((r) => String(r.entityId)).filter(Boolean))];
    const reviewPayments = paymentIdsFromReviews.length
      ? await Payment.find({ _id: { $in: paymentIdsFromReviews } }).select('_id reservationId').lean()
      : [];
    const paymentById = new Map(reviewPayments.map((p) => [String(p._id), p]));

    for (const review of staleReviews) {
      const payment = paymentById.get(String(review.entityId));
      if (!payment?.reservationId) continue;

      if (!apply) {
        summary.staleReviewsWouldResolve += 1;
        if (summary.sampleResolvedReviews.length < 30) {
          summary.sampleResolvedReviews.push({
            reviewId: String(review._id),
            paymentId: String(review.entityId),
            reservationId: String(payment.reservationId),
            action: 'would_resolve'
          });
        }
        continue;
      }

      try {
        const updateRes = await ManualReviewItem.updateOne(
          { _id: review._id, status: 'open' },
          {
            $set: {
              status: 'resolved',
              resolution: {
                resolvedAt: new Date(),
                resolvedBy: 'script_reconcile_payment_linkage_manual_reviews',
                note: 'Auto-resolved: referenced payment now linked to reservation.'
              }
            }
          }
        );
        if (updateRes.modifiedCount === 1) {
          summary.staleReviewsResolved += 1;
          if (summary.sampleResolvedReviews.length < 30) {
            summary.sampleResolvedReviews.push({
              reviewId: String(review._id),
              paymentId: String(review.entityId),
              reservationId: String(payment.reservationId),
              action: 'resolved'
            });
          }
        }
      } catch (error) {
        summary.staleReviewResolveErrors += 1;
      }
    }

    summary.notes = {
      bozhidarTarget: {
        bookingId: '69f8c505872d0d92a0efdd47',
        paymentId: '69f8c504d383478dc6cbacb4',
        paymentIntent: 'pi_3TTP34ITK7w1tlgb02aKB6xG'
      },
      legacyScriptExplanation:
        'reconcileStripePaymentLinks scans bookings (not unlinked payments), excludes cancelled status, and reads result.existingReservationId only on conflict; already_linked can still print existingReservationId: null because that field is not set in already_linked result payload.'
    };

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
  process.exit(1);
});

