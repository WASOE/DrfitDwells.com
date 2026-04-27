const { formatSofiaDateOnly } = require('../utils/dateTime');

function mapBookingToReservationCompatible(bookingDoc = {}) {
  const booking = bookingDoc.toObject ? bookingDoc.toObject() : bookingDoc;

  const checkInRaw = booking.checkIn || null;
  const checkOutRaw = booking.checkOut || null;

  return {
    reservationId: booking._id ? String(booking._id) : null,
    legacyBookingId: booking._id ? String(booking._id) : null,
    cabinId: booking.cabinId ? String(booking.cabinId._id || booking.cabinId) : null,
    checkInDate: checkInRaw,
    checkOutDate: checkOutRaw,
    checkInDateOnly: checkInRaw ? formatSofiaDateOnly(checkInRaw) : null,
    checkOutDateOnly: checkOutRaw ? formatSofiaDateOnly(checkOutRaw) : null,
    guest: {
      firstName: booking.guestInfo?.firstName || null,
      lastName: booking.guestInfo?.lastName || null,
      email: booking.guestInfo?.email || null,
      phone: booking.guestInfo?.phone || null
    },
    amount: booking.totalPrice ?? null,
    currency: null,
    reservationStatus: booking.status || null,
    paymentStatus: null, // derived by Payment model in final architecture
    arrivalStatus: null,
    source: 'internal',
    sourceReference: null,
    importedAt: null,
    lastSyncedAt: null,
    isProductionSafe: booking.isProductionSafe !== undefined ? booking.isProductionSafe : null,
    isTest: booking.isTest === true,
    intakeProvenance: booking.provenance || null,
    provenance: {
      mappedFrom: 'Booking',
      mappingVersion: 1
    }
  };
}

module.exports = {
  mapBookingToReservationCompatible
};
