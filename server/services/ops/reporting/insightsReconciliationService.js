'use strict';

const Payment = require('../../../models/Payment');
const Booking = require('../../../models/Booking');
const { normalizeStayRow } = require('./normalizedStayRow');
const {
  resolveSummaryContext,
  baseLocationBookingRevenueFilter,
  locationBookingRevenueCents,
  locationBookingCashCollectedCents,
  locationBookingChannel,
  locationBookingPropertyKind
} = require('./revenueMetricsService');
const { baseBookingFilter } = require('./reportingFilters');
const { majorCurrencyAmountToCents, isGiftVoucherPaymentMetadata } = require('./moneyCents');

const PAID_LIKE_STATUSES = new Set(['paid', 'partial']);

function amountField(value, source, basis) {
  return { value, source, basis };
}

async function loadStaySet(ctx) {
  const bookings = await Booking.find({
    ...baseBookingFilter(),
    excludeFromRevenueReporting: { $ne: true },
    ...ctx.dateFilterResult.filter,
    ...ctx.bookingEntityMatch
  })
    .select(
      '_id status checkIn checkOut totalPrice totalValueCents stripePaidAmountCents provenance cabinId cabinTypeId unitId createdAt'
    )
    .lean();

  const LocationBooking = require('../../../models/LocationBooking');
  const locationBookings = ctx.includeLocationBookings
    ? await LocationBooking.find({
        ...baseLocationBookingRevenueFilter(),
        ...ctx.dateFilterResult.filter,
        locationKey: 'valley'
      })
        .select('_id status checkIn checkOut totalPrice stripePaymentIntentId source locationKey createdAt')
        .lean()
    : [];

  const activeBookingIds = [];
  let grossBookedRevenueCents = 0;
  let paymentSnapshotAtBookingCents = 0;
  let cancelledCount = 0;

  for (const booking of bookings) {
    const row = normalizeStayRow(booking, ctx.entity.maps);
    if (row.propertyKind !== ctx.propertyKind) continue;
    if (ctx.channelFilter && row.channel !== ctx.channelFilter) continue;

    if (row.status === 'cancelled') {
      cancelledCount += 1;
      continue;
    }

    activeBookingIds.push(booking._id);
    grossBookedRevenueCents += row.bookedRevenueCents;
    paymentSnapshotAtBookingCents += row.cashCollectedCents;
  }

  let locationBookingActiveCount = 0;
  for (const locationBooking of locationBookings) {
    if (locationBookingPropertyKind(locationBooking) !== ctx.propertyKind) continue;
    const channel = locationBookingChannel(locationBooking);
    if (ctx.channelFilter && channel !== ctx.channelFilter) continue;
    if (locationBooking.status === 'cancelled') {
      cancelledCount += 1;
      continue;
    }
    locationBookingActiveCount += 1;
    grossBookedRevenueCents += locationBookingRevenueCents(locationBooking);
    paymentSnapshotAtBookingCents += locationBookingCashCollectedCents(locationBooking);
  }

  return {
    activeBookingIds,
    grossBookedRevenueCents,
    paymentSnapshotAtBookingCents,
    cancelledCount,
    locationBookingActiveCount
  };
}

async function aggregateLinkedPayments(bookingIds) {
  if (!bookingIds.length) {
    return {
      grossPaidAmountCents: 0,
      refundedAmountCents: 0,
      netPaidAmountCents: 0,
      linkedPaymentCount: 0,
      giftVoucherPaymentsExcludedCount: 0
    };
  }

  const payments = await Payment.find({
    reservationId: { $in: bookingIds }
  })
    .select('status amount reservationId metadata')
    .lean();

  let grossPaidAmountCents = 0;
  let refundedAmountCents = 0;
  let linkedPaymentCount = 0;
  let giftVoucherPaymentsExcludedCount = 0;

  for (const payment of payments) {
    if (isGiftVoucherPaymentMetadata(payment.metadata)) {
      giftVoucherPaymentsExcludedCount += 1;
      continue;
    }
    linkedPaymentCount += 1;
    const cents = majorCurrencyAmountToCents(payment.amount);
    if (PAID_LIKE_STATUSES.has(payment.status)) {
      grossPaidAmountCents += cents;
    } else if (payment.status === 'refunded') {
      refundedAmountCents += cents;
    }
  }

  return {
    grossPaidAmountCents,
    refundedAmountCents,
    netPaidAmountCents: grossPaidAmountCents - refundedAmountCents,
    linkedPaymentCount,
    giftVoucherPaymentsExcludedCount
  };
}

async function aggregateSiteWideUnlinkedPayments(range) {
  const payments = await Payment.find({
    $or: [{ reservationId: null }, { reservationId: { $exists: false } }],
    createdAt: { $gte: range.start, $lt: range.endExclusive }
  })
    .select('amount metadata status')
    .lean();

  let count = 0;
  let amountCents = 0;
  for (const payment of payments) {
    if (isGiftVoucherPaymentMetadata(payment.metadata)) continue;
    count += 1;
    amountCents += majorCurrencyAmountToCents(payment.amount);
  }

  return { count, amountCents };
}

async function aggregateInsightsReconciliation({
  propertyKind,
  from,
  to,
  revenueBasis = 'checkIn',
  cabinId = null,
  cabinTypeId = null,
  unitId = null
}) {
  const ctx = await resolveSummaryContext({
    propertyKind,
    from,
    to,
    revenueBasis,
    cabinId,
    cabinTypeId,
    unitId,
    channel: null
  });

  const staySet = await loadStaySet(ctx);
  const linked = await aggregateLinkedPayments(staySet.activeBookingIds);
  const unlinked = await aggregateSiteWideUnlinkedPayments(ctx.dateFilterResult.range);

  return {
    propertyKind: ctx.propertyKind,
    period: {
      from: String(from).trim().slice(0, 10),
      to: String(to).trim().slice(0, 10)
    },
    revenueBasis: ctx.basis,
    filters: {
      cabinId: ctx.entity.cabinId ? String(ctx.entity.cabinId) : null,
      cabinTypeId: ctx.entity.cabinTypeId ? String(ctx.entity.cabinTypeId) : null,
      unitId: ctx.entity.unitId ? String(ctx.entity.unitId) : null
    },
    commercial: {
      grossBookedRevenueCents: amountField(
        staySet.grossBookedRevenueCents,
        'Booking.totalValueCents|totalPrice (+ LocationBooking.totalPrice for valley masters)',
        ctx.basis
      )
    },
    paymentSnapshotAtBooking: {
      amountCents: amountField(
        staySet.paymentSnapshotAtBookingCents,
        'Booking.stripePaidAmountCents',
        'booking_finalize_snapshot'
      ),
      limitations: [
        'Does not reflect later refunds',
        'Does not necessarily reflect later partial or additional payments',
        'LocationBooking snapshot uses totalPrice when stripePaymentIntentId is present'
      ]
    },
    linkedPaymentLedger: {
      grossPaidAmountCents: amountField(
        linked.grossPaidAmountCents,
        'Payment.amount for status paid|partial linked by reservationId',
        'linked_payment_ledger'
      ),
      refundedAmountCents: amountField(
        linked.refundedAmountCents,
        'Payment.amount for status refunded linked by reservationId',
        'linked_payment_ledger'
      ),
      netPaidAmountCents: amountField(
        linked.netPaidAmountCents,
        'grossPaidAmountCents - refundedAmountCents',
        'linked_payment_ledger'
      ),
      linkedPaymentCount: linked.linkedPaymentCount,
      giftVoucherPaymentsExcludedCount: linked.giftVoucherPaymentsExcludedCount
    },
    variance: {
      snapshotVsLinkedLedgerCents:
        staySet.paymentSnapshotAtBookingCents - linked.netPaidAmountCents,
      commercialVsLinkedNetPaidCents:
        staySet.grossBookedRevenueCents - linked.netPaidAmountCents
    },
    siteWideUnlinkedPayments: {
      count: unlinked.count,
      amountCents: unlinked.amountCents,
      source: 'Payment rows with null reservationId in period (createdAt), excluding gift voucher product payments',
      includedInZoneVariance: false,
      propertyKindAttributed: false
    },
    exclusions: {
      giftVoucherProductPaymentsExcluded: true,
      giftVoucherRedemptionNotNewCash: true,
      cancelledCommercialTreatment:
        'Cancelled stays are excluded from commercial gross and payment snapshot totals used here',
      locationBookingTreatment: ctx.includeLocationBookings
        ? 'Valley LocationBooking masters are included in commercial/snapshot totals. Linked Payment ledger only joins Booking.reservationId; LocationBooking PI linkage may be incomplete.'
        : 'LocationBooking masters omitted for this filter set or propertyKind.',
      cancelledCountExcludedFromCommercial: staySet.cancelledCount,
      locationBookingActiveCount: staySet.locationBookingActiveCount
    },
    provenance: {
      filtersApplied: [
        'baseBookingFilter',
        'fixtureExclusion',
        'propertyKindStrictJoin',
        'entityFiltersOptional',
        'excludeFromRevenueReporting'
      ],
      paymentAmountStorageUnit: 'major_currency_units',
      conversionMethod: 'majorCurrencyAmountToCents (toFixed(2) then integer cents)',
      readOnly: true,
      writesPerformed: false,
      computedAt: new Date().toISOString()
    }
  };
}

module.exports = {
  aggregateInsightsReconciliation,
  majorCurrencyAmountToCents,
  isGiftVoucherPaymentMetadata,
  aggregateLinkedPayments,
  aggregateSiteWideUnlinkedPayments
};
