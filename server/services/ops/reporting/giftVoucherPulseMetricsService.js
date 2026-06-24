'use strict';

const moment = require('moment-timezone');
const GiftVoucher = require('../../../models/GiftVoucher');
const GiftVoucherEvent = require('../../../models/GiftVoucherEvent');
const { purchasedGiftVoucherQuery } = require('../../giftVouchers/giftVoucherIssuance');
const { smokeRecordMatchClause } = require('../../giftVouchers/giftVoucherOpsVisibility');

const PROPERTY_TIMEZONE = 'Europe/Sofia';

const PAID_LIFECYCLE_STATUSES = ['active', 'partially_redeemed', 'redeemed', 'expired'];
const LIABILITY_STATUSES = ['active', 'partially_redeemed'];

const PULSE_EXCLUSION_NOR_CLAUSES = [
  smokeRecordMatchClause(),
  {
    $or: [
      { purchaseRequestId: { $regex: /^gvr_(audit|ratelimit)_/i } },
      { buyerEmail: { $regex: /@example\.com$/i } },
      { recipientEmail: { $regex: /@example\.com$/i } }
    ]
  }
];

function buildSofiaCalendarMonthRange(now = new Date()) {
  const anchor = moment.tz(now, PROPERTY_TIMEZONE);
  const monthStart = anchor.clone().startOf('month').toDate();
  const monthEndExclusive = anchor.clone().add(1, 'month').startOf('month').toDate();
  return {
    monthStart,
    monthEndExclusive,
    monthLabel: anchor.format('YYYY-MM'),
    timezone: PROPERTY_TIMEZONE
  };
}

function appendNorClauses(filter, norClauses) {
  if (!norClauses.length) return filter;
  if (!filter.$nor) {
    return { ...filter, $nor: norClauses };
  }
  return {
    ...filter,
    $nor: [...filter.$nor, ...norClauses]
  };
}

/**
 * Purchased gift vouchers eligible for OPS dashboard financial pulse.
 * Excludes smoke, audit/ratelimit noise, example.com fixtures, compensation, and goodwill.
 */
function buildGiftVoucherPulseEligibleFilter(extra = {}) {
  const { $nor: extraNor, ...rest } = extra;
  const withExclusions = appendNorClauses(rest, [
    ...PULSE_EXCLUSION_NOR_CLAUSES,
    ...(Array.isArray(extraNor) ? extraNor : extraNor ? [extraNor] : [])
  ]);
  return purchasedGiftVoucherQuery(withExclusions);
}

function buildMtdSalesFilter(monthStart, monthEndExclusive) {
  return buildGiftVoucherPulseEligibleFilter({
    status: { $in: PAID_LIFECYCLE_STATUSES },
    activatedAt: { $gte: monthStart, $lt: monthEndExclusive }
  });
}

function buildLiabilityFilter() {
  return buildGiftVoucherPulseEligibleFilter({
    status: { $in: LIABILITY_STATUSES }
  });
}

function emptyPulseMetrics(monthLabel) {
  return {
    month: monthLabel,
    salesMTDCents: 0,
    cashCollectedMTDCents: 0,
    physicalCardFeesMTDCents: 0,
    liabilityOutstandingCents: 0,
    redemptionsMTDCents: 0
  };
}

async function aggregateGiftVoucherMtdSalesMetrics({ monthStart, monthEndExclusive, monthLabel }) {
  const filter = buildMtdSalesFilter(monthStart, monthEndExclusive);
  const [agg] = await GiftVoucher.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        salesMTDCents: { $sum: '$amountOriginalCents' },
        cashCollectedMTDCents: {
          $sum: {
            $add: ['$amountOriginalCents', { $ifNull: ['$physicalCardFeeCents', 0] }]
          }
        },
        physicalCardFeesMTDCents: { $sum: { $ifNull: ['$physicalCardFeeCents', 0] } }
      }
    }
  ]);

  return {
    month: monthLabel,
    salesMTDCents: Math.max(0, Math.trunc(agg?.salesMTDCents || 0)),
    cashCollectedMTDCents: Math.max(0, Math.trunc(agg?.cashCollectedMTDCents || 0)),
    physicalCardFeesMTDCents: Math.max(0, Math.trunc(agg?.physicalCardFeesMTDCents || 0))
  };
}

async function aggregateGiftVoucherLiabilityOutstandingCents() {
  const filter = buildLiabilityFilter();
  const [agg] = await GiftVoucher.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        liabilityOutstandingCents: { $sum: '$balanceRemainingCents' }
      }
    }
  ]);
  return Math.max(0, Math.trunc(agg?.liabilityOutstandingCents || 0));
}

async function aggregateGiftVoucherRedemptionsMTDCents({ monthStart, monthEndExclusive }) {
  const voucherColl = GiftVoucher.collection.collectionName;
  const redemptionColl = GiftVoucherRedemptionCollectionName();
  const eligibleVoucherMatch = buildGiftVoucherPulseEligibleFilter();

  const [agg] = await GiftVoucherEvent.aggregate([
    {
      $match: {
        type: 'redeemed_confirmed',
        createdAt: { $gte: monthStart, $lt: monthEndExclusive }
      }
    },
    {
      $lookup: {
        from: voucherColl,
        let: { voucherId: '$giftVoucherId' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$_id', '$$voucherId'] },
              ...eligibleVoucherMatch
            }
          },
          { $project: { _id: 1 } }
        ],
        as: 'eligibleVoucher'
      }
    },
    { $match: { 'eligibleVoucher.0': { $exists: true } } },
    {
      $addFields: {
        redemptionObjectId: {
          $convert: {
            input: '$metadata.redemptionId',
            to: 'objectId',
            onError: null,
            onNull: null
          }
        }
      }
    },
    {
      $lookup: {
        from: redemptionColl,
        localField: 'redemptionObjectId',
        foreignField: '_id',
        as: 'redemption'
      }
    },
    { $unwind: { path: '$redemption', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: null,
        redemptionsMTDCents: {
          $sum: {
            $cond: [
              { $gt: [{ $ifNull: ['$redemption.amountAppliedCents', 0] }, 0] },
              '$redemption.amountAppliedCents',
              {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$previousBalanceCents', null] },
                      { $ne: ['$newBalanceCents', null] },
                      { $gt: ['$previousBalanceCents', '$newBalanceCents'] }
                    ]
                  },
                  { $subtract: ['$previousBalanceCents', '$newBalanceCents'] },
                  0
                ]
              }
            ]
          }
        }
      }
    }
  ]);

  return Math.max(0, Math.trunc(agg?.redemptionsMTDCents || 0));
}

function GiftVoucherRedemptionCollectionName() {
  // Lazy require avoids circular import; collection name is stable.
  // eslint-disable-next-line global-require
  const GiftVoucherRedemption = require('../../../models/GiftVoucherRedemption');
  return GiftVoucherRedemption.collection.collectionName;
}

async function aggregateGiftVoucherPulseMetrics({ now = new Date() } = {}) {
  const { monthStart, monthEndExclusive, monthLabel } = buildSofiaCalendarMonthRange(now);

  const [mtdSales, liabilityOutstandingCents, redemptionsMTDCents] = await Promise.all([
    aggregateGiftVoucherMtdSalesMetrics({ monthStart, monthEndExclusive, monthLabel }),
    aggregateGiftVoucherLiabilityOutstandingCents(),
    aggregateGiftVoucherRedemptionsMTDCents({ monthStart, monthEndExclusive })
  ]);

  return {
    ...mtdSales,
    liabilityOutstandingCents,
    redemptionsMTDCents,
    provenance: {
      timezone: PROPERTY_TIMEZONE,
      monthBasis: 'activatedAt for sales/cash/fees; event.createdAt for redemptions',
      salesStatusFilter: PAID_LIFECYCLE_STATUSES.join(','),
      liabilityStatusFilter: LIABILITY_STATUSES.join(','),
      exclusions: 'purchase issuance only; smoke/audit/ratelimit/example.com excluded'
    }
  };
}

module.exports = {
  PROPERTY_TIMEZONE,
  PAID_LIFECYCLE_STATUSES,
  LIABILITY_STATUSES,
  buildSofiaCalendarMonthRange,
  buildGiftVoucherPulseEligibleFilter,
  buildMtdSalesFilter,
  buildLiabilityFilter,
  emptyPulseMetrics,
  aggregateGiftVoucherMtdSalesMetrics,
  aggregateGiftVoucherLiabilityOutstandingCents,
  aggregateGiftVoucherRedemptionsMTDCents,
  aggregateGiftVoucherPulseMetrics
};
