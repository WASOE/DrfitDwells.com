module.exports = {
  sourceTruth: {
    reservationLegacy: 'Booking',
    guest: 'Guest',
    availabilityBlock: 'AvailabilityBlock',
    auditEvent: 'AuditEvent',
    channelSyncEvent: 'ChannelSyncEvent',
    payment: 'Payment',
    payout: 'Payout',
    manualReviewItem: 'ManualReviewItem',
    reservationNote: 'ReservationNote',
    stripeEventEvidence: 'StripeEventEvidence',
    cabinChannelSyncState: 'CabinChannelSyncState',
    communicationLegacy: 'EmailEvent'
  },
  serviceLayer: {
    permission: 'permissionService',
    audit: 'auditWriter',
    idempotency: 'idempotencyService',
    dateTime: 'dateTime',
    readModels: 'services/ops/readModels/*',
    domainWrites: 'services/ops/domain/*',
    ingestion: 'services/ops/ingestion/*'
  },
  mappingLayer: {
    bookingToReservation: 'bookingToReservationMapper',
    emailToCommunication: 'emailEventToCommunicationMapper'
  }
};
