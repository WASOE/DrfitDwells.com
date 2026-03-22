/** Booking rows that occupy inventory for calendar / conflict purposes (not terminal). */
const BLOCKING_BOOKING_STATUSES = ['pending', 'confirmed', 'in_house'];

module.exports = { BLOCKING_BOOKING_STATUSES };
