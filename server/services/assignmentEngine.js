const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const {
  findParentCabinForCabinType,
  isUnitGuestStayAvailable
} = require('./publicAvailabilityService');
const { BLOCKING_BOOKING_STATUSES } = require('./calendar/blockingStatusConstants');

/**
 * Assignment Engine for A-frame bookings
 * 
 * Automatically assigns the best available unit to a booking based on:
 * 1. Availability (no conflicts)
 * 2. Unit-specific blocked dates
 * 3. Load balancing (prefer units with fewer bookings)
 * 4. Unit number order (prefer lower numbers first)
 */
class AssignmentEngine {
  /**
   * Find and assign the best available unit for a booking
   * @param {ObjectId} cabinTypeId - The cabin type ID
   * @param {Date} checkIn - Check-in date
   * @param {Date} checkOut - Check-out date
   * @param {ObjectId} excludeUnitId - Optional: exclude this unit (for reassignment)
   * @returns {Object|null} - The assigned unit or null if none available
   */
  static async assignUnit(cabinTypeId, checkIn, checkOut, excludeUnitId = null) {
    try {
      const units = await Unit.find({
        cabinTypeId,
        isActive: true
      }).sort({ unitNumber: 1 });

      if (units.length === 0) return null;

      const unitIds = units.map(u => u._id);

      const parentCabin = await findParentCabinForCabinType(cabinTypeId);

      const counts = await Booking.aggregate([
        { $match: { unitId: { $in: unitIds }, status: { $in: BLOCKING_BOOKING_STATUSES } } },
        { $group: { _id: '$unitId', count: { $sum: 1 } } }
      ]);
      const countMap = new Map(counts.map(c => [c._id.toString(), c.count]));

      const availableUnits = [];
      for (const unit of units) {
        if (excludeUnitId && unit._id.toString() === excludeUnitId.toString()) continue;

        // Canonical: bookings + AvailabilityBlock (incl. external_hold) + unit blockedDates
        const ok = await isUnitGuestStayAvailable(unit._id, cabinTypeId, checkIn, checkOut, parentCabin);
        if (!ok) continue;

        availableUnits.push({
          unit,
          bookingCount: countMap.get(unit._id.toString()) || 0
        });
      }

      if (availableUnits.length === 0) return null;

      availableUnits.sort((a, b) => {
        if (a.bookingCount !== b.bookingCount) return a.bookingCount - b.bookingCount;
        return a.unit.unitNumber.localeCompare(b.unit.unitNumber);
      });

      return availableUnits[0].unit;
    } catch (error) {
      console.error('Assignment engine error:', error);
      throw error;
    }
  }

  /**
   * Check if a specific unit is available for given dates
   * @param {ObjectId} unitId - The unit ID
   * @param {Date} checkIn - Check-in date
   * @param {Date} checkOut - Check-out date
   * @returns {Boolean} - True if available
   */
  static async isUnitAvailable(unitId, checkIn, checkOut) {
    try {
      const unit = await Unit.findById(unitId);
      if (!unit || !unit.isActive) {
        return false;
      }

      const parentCabin = await findParentCabinForCabinType(unit.cabinTypeId);
      return isUnitGuestStayAvailable(unit._id, unit.cabinTypeId, checkIn, checkOut, parentCabin);
    } catch (error) {
      console.error('Check unit availability error:', error);
      return false;
    }
  }

  /**
   * Get availability summary for all units of a cabin type
   * @param {ObjectId} cabinTypeId - The cabin type ID
   * @param {Date} checkIn - Check-in date
   * @param {Date} checkOut - Check-out date
   * @returns {Object} - Summary with available count and unit details
   */
  static async getAvailabilitySummary(cabinTypeId, checkIn, checkOut) {
    try {
      const units = await Unit.find({
        cabinTypeId,
        isActive: true
      }).sort({ unitNumber: 1 });

      const parentCabin = await findParentCabinForCabinType(cabinTypeId);

      const summary = {
        totalUnits: units.length,
        availableUnits: [],
        unavailableUnits: []
      };

      for (const unit of units) {
        const isAvailable = await isUnitGuestStayAvailable(unit._id, cabinTypeId, checkIn, checkOut, parentCabin);

        const entry = { unitId: unit._id, unitNumber: unit.unitNumber, displayName: unit.displayName };
        if (isAvailable) {
          summary.availableUnits.push(entry);
        } else {
          summary.unavailableUnits.push(entry);
        }
      }

      return summary;
    } catch (error) {
      console.error('Get availability summary error:', error);
      throw error;
    }
  }
}

module.exports = AssignmentEngine;



