/**
 * Review ownership & visibility (shared public + admin)
 *
 * Product rule — admin list / cabin edit counts / admin cabins index:
 *   Show all non-deleted reviews for the resolved property context (all statuses).
 *   This is the moderation surface: pending/hidden/approved are all editable.
 *
 * Public GET /cabins/:id/reviews is stricter: same owner resolution + soft-delete,
 * plus status === 'approved' and rating >= minRating (default 2).
 *
 * If product ever requires admin to default to the guest-visible subset only,
 * apply that filter in admin routes when cabinId is present (or add a query flag).
 */
const mongoose = require('mongoose');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Review = require('../models/Review');

function dedupeObjectIds(ids) {
  const seen = new Set();
  const out = [];
  for (const o of ids) {
    const s = o.toString();
    if (!seen.has(s)) {
      seen.add(s);
      out.push(o);
    }
  }
  return out;
}

/**
 * Soft-delete semantics aligned with public reviews: treat as active when
 * `deletedAt` is missing or explicitly null (schema default is null).
 */
function softDeleteOrCondition() {
  return {
    $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }]
  };
}

/**
 * Resolve all Review.cabinId ObjectIds that share the same guest-facing review
 * pool as `rawId` (Cabin or CabinType _id). Matches public GET /cabins/:id/reviews,
 * with inventoryMode === 'multi' honored alongside inventoryType.
 */
async function resolveReviewOwnerObjectIds(rawId) {
  if (rawId == null || rawId === '') return [];
  const id = String(rawId);
  if (!mongoose.Types.ObjectId.isValid(id)) return [];

  const cabinType = await CabinType.findById(id).select('_id').lean();
  if (cabinType) {
    const cabins = await Cabin.find(
      { $or: [{ cabinTypeRef: id }, { cabinTypeId: id }] },
      '_id'
    ).lean();
    const cabinIds = cabins.map((c) => c._id);
    cabinIds.push(new mongoose.Types.ObjectId(id));
    return dedupeObjectIds(cabinIds);
  }

  const cabin = await Cabin.findById(id)
    .select('_id inventoryType inventoryMode cabinTypeId')
    .lean();
  const cabinIds = [new mongoose.Types.ObjectId(id)];

  const isMulti =
    cabin &&
    cabin.cabinTypeId &&
    (cabin.inventoryType === 'multi' || cabin.inventoryMode === 'multi');

  if (isMulti) {
    const typeId = cabin.cabinTypeId.toString();
    const relatedCabins = await Cabin.find(
      { $or: [{ cabinTypeRef: typeId }, { cabinTypeId: typeId }] },
      '_id'
    ).lean();
    cabinIds.push(new mongoose.Types.ObjectId(typeId));
    cabinIds.push(...relatedCabins.map((c) => c._id));
  }

  return dedupeObjectIds(cabinIds);
}

/** Non-deleted count + average for a pre-resolved owner id set (admin: all statuses). */
async function aggregateNonDeletedReviewStatsForOwnerIds(ownerIds) {
  if (!ownerIds.length) {
    return { reviewsCount: 0, averageRating: 0 };
  }
  const match = { cabinId: { $in: ownerIds }, ...softDeleteOrCondition() };
  const [row] = await Review.aggregate([
    { $match: match },
    { $group: { _id: null, count: { $sum: 1 }, avgRating: { $avg: '$rating' } } }
  ]);
  return {
    reviewsCount: row?.count ?? 0,
    averageRating: Math.round((row?.avgRating || 0) * 10) / 10
  };
}

/** Resolve context then aggregate (admin surfaces). */
async function aggregateNonDeletedReviewStatsForContext(rawId) {
  const ownerIds = await resolveReviewOwnerObjectIds(rawId);
  return aggregateNonDeletedReviewStatsForOwnerIds(ownerIds);
}

module.exports = {
  resolveReviewOwnerObjectIds,
  softDeleteOrCondition,
  aggregateNonDeletedReviewStatsForOwnerIds,
  aggregateNonDeletedReviewStatsForContext
};
