const mongoose = require('mongoose');
const Cabin = require('../../models/Cabin');
const Booking = require('../../models/Booking');
const { normalizeDateToSofiaDayStart } = require('../../utils/dateTime');
const { BLOCKING_BOOKING_STATUSES } = require('../calendar/blockingStatusConstants');

function httpError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

/**
 * Soft-archive an existing single-inventory cabin (not multi / cabin-type-backed).
 *
 * @param {object} params
 * @param {string} params.cabinId
 * @param {string} params.reason trimmed archive reason (min 8, max 500)
 * @param {object} [params.actor] reserved for future audit enrichment
 * @param {string} [params.confirmName] when set (OPS), must match cabin.name exactly after trim
 * @returns {Promise<{ cabinId: string, name: string, isActive: boolean, archivedAt: Date, archivedReason: string, _auditBefore: object }>}
 */
async function archiveSingleCabin({ cabinId, reason, actor: _actor, confirmName } = {}) {
  void _actor;
  if (!mongoose.Types.ObjectId.isValid(String(cabinId))) {
    throw httpError(400, 'VALIDATION', 'Invalid cabin id');
  }

  const trimmedReason = reason != null ? String(reason).trim() : '';
  if (trimmedReason.length < 8) {
    throw httpError(400, 'VALIDATION', 'reason must be at least 8 characters');
  }
  if (trimmedReason.length > 500) {
    throw httpError(400, 'VALIDATION', 'reason must be at most 500 characters');
  }

  const cabin = await Cabin.findById(cabinId);
  if (!cabin) {
    throw httpError(404, 'NOT_FOUND', 'Cabin not found');
  }

  if (cabin.archivedAt) {
    throw httpError(400, 'ALREADY_ARCHIVED', 'Cabin is already archived');
  }

  if (confirmName !== undefined) {
    const expect = String(cabin.name || '').trim();
    const got = String(confirmName || '').trim();
    if (got !== expect) {
      throw httpError(400, 'CONFIRM_NAME_MISMATCH', 'Confirmation name does not match cabin name');
    }
  }

  const mode = String(cabin.inventoryMode || cabin.inventoryType || 'single').toLowerCase();
  if (mode === 'multi' || cabin.cabinTypeRef || cabin.cabinTypeId) {
    throw httpError(
      400,
      'NOT_SINGLE_CABIN',
      'Only single cabins can be archived through this action (multi-unit / cabin-type listings are excluded)'
    );
  }

  const todayStart = normalizeDateToSofiaDayStart(new Date());
  const blocking = await Booking.exists({
    cabinId: cabin._id,
    status: { $in: BLOCKING_BOOKING_STATUSES },
    checkOut: { $gte: todayStart },
    $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }]
  });

  if (blocking) {
    throw httpError(
      409,
      'BOOKING_CONFLICT',
      'Cannot archive this cabin while it has current or upcoming reservations (pending, confirmed, or in-house). Cancel or complete stays first.'
    );
  }

  const auditBefore = {
    archivedAt: cabin.archivedAt || null,
    isActive: cabin.isActive,
    name: cabin.name
  };

  const now = new Date();
  cabin.isActive = false;
  cabin.archivedAt = now;
  cabin.archivedReason = trimmedReason;
  await cabin.save();

  return {
    cabinId: String(cabin._id),
    name: cabin.name,
    isActive: false,
    archivedAt: now,
    archivedReason: trimmedReason,
    _auditBefore: auditBefore
  };
}

module.exports = {
  archiveSingleCabin
};
