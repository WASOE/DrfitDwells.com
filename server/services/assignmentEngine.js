const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const moment = require('moment');

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
      // Get all active units for this cabin type
      const units = await Unit.find({ 
        cabinTypeId,
        isActive: true 
      }).sort({ unitNumber: 1 });

      if (units.length === 0) {
        return null;
      }

      // Normalize dates
      const checkInDate = moment(checkIn).startOf('day').toDate();
      const checkOutDate = moment(checkOut).startOf('day').toDate();

      // Check each unit for availability
      const availableUnits = [];

      for (const unit of units) {
        // Skip excluded unit
        if (excludeUnitId && unit._id.toString() === excludeUnitId.toString()) {
          continue;
        }

        // Check unit-specific blocked dates
        const unitBlocked = Array.isArray(unit.blockedDates) ? unit.blockedDates : [];
        const hasBlockedDates = unitBlocked.some(blockedDate => {
          const blocked = moment(blockedDate).startOf('day').toDate();
          return blocked >= checkInDate && blocked < checkOutDate;
        });

        if (hasBlockedDates) {
          continue;
        }

        // Check for conflicting bookings on this unit
        const conflictingBookings = await Booking.find({
          unitId: unit._id,
          status: { $in: ['pending', 'confirmed'] },
          $or: [
            {
              checkIn: { $lt: checkOutDate },
              checkOut: { $gt: checkInDate }
            }
          ]
        });

        if (conflictingBookings.length === 0) {
          // Count total bookings for this unit (for load balancing)
          const totalBookings = await Booking.countDocuments({
            unitId: unit._id,
            status: { $in: ['pending', 'confirmed'] }
          });

          availableUnits.push({
            unit,
            bookingCount: totalBookings
          });
        }
      }

      if (availableUnits.length === 0) {
        return null;
      }

      // Sort by booking count (load balancing) then by unit number
      availableUnits.sort((a, b) => {
        if (a.bookingCount !== b.bookingCount) {
          return a.bookingCount - b.bookingCount;
        }
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

      const checkInDate = moment(checkIn).startOf('day').toDate();
      const checkOutDate = moment(checkOut).startOf('day').toDate();

      // Check unit-specific blocked dates
      const unitBlocked = Array.isArray(unit.blockedDates) ? unit.blockedDates : [];
      const hasBlockedDates = unitBlocked.some(blockedDate => {
        const blocked = moment(blockedDate).startOf('day').toDate();
        return blocked >= checkInDate && blocked < checkOutDate;
      });

      if (hasBlockedDates) {
        return false;
      }

      // Check for conflicting bookings
      const conflictingBookings = await Booking.find({
        unitId: unit._id,
        status: { $in: ['pending', 'confirmed'] },
        $or: [
          {
            checkIn: { $lt: checkOutDate },
            checkOut: { $gt: checkInDate }
          }
        ]
      });

      return conflictingBookings.length === 0;
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

      const checkInDate = moment(checkIn).startOf('day').toDate();
      const checkOutDate = moment(checkOut).startOf('day').toDate();

      const summary = {
        totalUnits: units.length,
        availableUnits: [],
        unavailableUnits: []
      };

      for (const unit of units) {
        const isAvailable = await this.isUnitAvailable(unit._id, checkInDate, checkOutDate);
        
        if (isAvailable) {
          summary.availableUnits.push({
            unitId: unit._id,
            unitNumber: unit.unitNumber,
            displayName: unit.displayName
          });
        } else {
          summary.unavailableUnits.push({
            unitId: unit._id,
            unitNumber: unit.unitNumber,
            displayName: unit.displayName
          });
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



