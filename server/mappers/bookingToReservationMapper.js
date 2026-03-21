function mapBookingToReservationCompatible(bookingDoc = {}) {
  const booking = bookingDoc.toObject ? bookingDoc.toObject() : bookingDoc;

  return {
    reservationId: booking._id ? String(booking._id) : null,
    legacyBookingId: booking._id ? String(booking._id) : null,
    cabinId: booking.cabinId ? String(booking.cabinId._id || booking.cabinId) : null,
    checkInDate: booking.checkIn || null,
    checkOutDate: booking.checkOut || null,
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
    provenance: {
      mappedFrom: 'Booking',
      mappingVersion: 1
    }
  };
}

module.exports = {
  mapBookingToReservationCompatible
};
