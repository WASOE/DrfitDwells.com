'use strict';

const Booking = require('../../../models/Booking');
const Cabin = require('../../../models/Cabin');
const CabinType = require('../../../models/CabinType');
const Unit = require('../../../models/Unit');
const CabinNightClaim = require('../../../models/CabinNightClaim');
const UnitNightClaim = require('../../../models/UnitNightClaim');
const { resolveOccupiedNightDates } = require('../../inventory/cabinNightClaimService');
const { requirePermission, ACTIONS } = require('../../permissionService');
const { createDomainError } = require('../domain/errors');
const { formatSofiaDateOnly } = require('../../../utils/dateTime');
const { assertRebookEnabled } = require('../../stayChange/rebookWriteGate');
const {
  assertRebookSourceEligible,
  assertRebookTargetCapacity,
  loadRebookMoney,
  quoteRebookTarget,
  evaluateExternalAndHardConflicts
} = require('../../stayChange/rebookStayChangeService');

// Advisory only. The REBOOK command repeats all checks and atomically acquires inventory.
async function getRebookCandidatesReadModel(reservationId, ctx = {}) {
  requirePermission({ role: ctx.user?.role, action: ACTIONS.OPS_RESERVATION_REASSIGN });
  assertRebookEnabled();
  const booking = await Booking.findById(reservationId).lean();
  if (!booking) {
    throw createDomainError('validation', 'Reservation not found', { code: 'UNSUPPORTED_SOURCE' }, 404);
  }
  await assertRebookSourceEligible(booking);
  const { contractual, transferred } = await loadRebookMoney(booking);
  const [cabins, types, units] = await Promise.all([
    Cabin.find({ isActive: true, archivedAt: null }).sort({ name: 1 }).lean(),
    CabinType.find({ isActive: true, archivedAt: null }).sort({ name: 1 }).lean(),
    Unit.find({ isActive: true }).sort({ unitNumber: 1 }).lean()
  ]);
  const targets = [];
  for (const cabin of cabins) {
    if (cabin.inventoryType === 'multi' ||
        String(cabin._id) === String(booking.cabinId)) continue;
    targets.push({
      entity: cabin, cabinId: cabin._id, cabinTypeId: null, unitId: null,
      label: cabin.name, commercialProductKey: `cabin:${cabin._id}`
    });
  }
  for (const type of types) {
    if (String(type._id) === String(booking.cabinTypeId)) continue;
    const parent = cabins.find(cabin => String(cabin.cabinTypeId) === String(type._id));
    if (!parent) continue;
    for (const unit of units.filter(item => String(item.cabinTypeId) === String(type._id))) {
      targets.push({
        entity: type, cabinId: null, cabinTypeId: type._id, unitId: unit._id,
        label: `${type.name} - ${unit.displayName || `Unit ${unit.unitNumber}`}`,
        commercialProductKey: `cabinType:${type._id}`
      });
    }
  }
  const candidates = [];
  const nights = resolveOccupiedNightDates({ checkIn: booking.checkIn, checkOut: booking.checkOut });
  for (const target of targets) {
    try {
      assertRebookTargetCapacity(booking, target);
    } catch (error) {
      if (error.details?.code === 'TARGET_CAPACITY') continue;
      throw error;
    }
    const conflicts = await evaluateExternalAndHardConflicts(booking, target);
    if (conflicts.hasHardConflicts) continue;
    const claimed = target.unitId
      ? await UnitNightClaim.exists({ unitId: target.unitId, night: { $in: nights } })
      : await CabinNightClaim.exists({ cabinId: target.cabinId, night: { $in: nights } });
    if (claimed) continue;
    const priceCents = await quoteRebookTarget(booking, target);
    if (priceCents < contractual.cents) continue;
    candidates.push({
      id: String(target.unitId || target.cabinId),
      label: target.label,
      targetCabinId: target.cabinId ? String(target.cabinId) : null,
      targetCabinTypeId: target.cabinTypeId ? String(target.cabinTypeId) : null,
      targetUnitId: target.unitId ? String(target.unitId) : null,
      capacity: target.entity.capacity,
      canonicalTargetQuoteCents: priceCents,
      differenceCents: priceCents - contractual.cents,
      settlementType: priceCents === contractual.cents ? 'equal_price' : 'complimentary_upgrade',
      externalHoldWarning: conflicts.warnings.length > 0
    });
  }
  return {
    reservationId: String(booking._id),
    checkInDateOnly: formatSofiaDateOnly(booking.checkIn),
    checkOutDateOnly: formatSofiaDateOnly(booking.checkOut),
    adults: booking.adults,
    children: booking.children || 0,
    contractualTotalCents: contractual.cents,
    transferableValueCents: transferred.cents,
    currency: 'EUR',
    candidates
  };
}

module.exports = { getRebookCandidatesReadModel };
