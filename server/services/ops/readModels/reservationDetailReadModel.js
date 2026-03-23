const Booking = require('../../../models/Booking');
const Guest = require('../../../models/Guest');
const Payment = require('../../../models/Payment');
const Payout = require('../../../models/Payout');
const EmailEvent = require('../../../models/EmailEvent');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const AuditEvent = require('../../../models/AuditEvent');
const ReservationNote = require('../../../models/ReservationNote');
const { mapBookingToReservationCompatible } = require('../../../mappers/bookingToReservationMapper');
const { mapEmailEventToCommunicationCompatible } = require('../../../mappers/emailEventToCommunicationMapper');
const { isPublicIcsStrictEligibility, isPublicIcsExportSafetyEnforced } = require('../../../config/publicIcsConfig');
const { isBookingEligibleForPublicIcs, loadPaidOrPartialReservationIdSet } = require('../../calendar/icsBlockingEligibility');
const { resolveBookingExportSafety } = require('../../calendar/bookingExportSafety');

async function getReservationDetailReadModel(reservationId) {
  const booking = await Booking.findById(reservationId).lean();
  if (!booking) return null;
  if (booking.isTest || booking.archivedAt) return null;

  const mapped = mapBookingToReservationCompatible(booking);
  const [guest, availability, payments, payouts, emailEvents, auditSummary, notes] = await Promise.all([
    Guest.findOne({ email: booking.guestInfo?.email || null }).lean(),
    AvailabilityBlock.find({ reservationId: booking._id }).lean(),
    Payment.find({ reservationId: booking._id }).sort({ createdAt: -1 }).lean(),
    Payout.find({ 'metadata.reservationId': String(booking._id) }).sort({ createdAt: -1 }).lean(),
    EmailEvent.find({ bookingId: booking._id }).sort({ createdAt: -1 }).lean(),
    AuditEvent.find({ entityType: 'Reservation', entityId: String(booking._id) })
      .sort({ happenedAt: -1 })
      .limit(20)
      .lean(),
    ReservationNote.find({ reservationId: booking._id, 'tombstone.isTombstoned': false })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const strictIcs = isPublicIcsStrictEligibility();
  const paidSet = await loadPaidOrPartialReservationIdSet([String(booking._id)]);
  const exportSafety = resolveBookingExportSafety(booking, paidSet);
  const outboundIcsEligible = isBookingEligibleForPublicIcs(booking, paidSet, strictIcs);

  return {
    reservation: mapped,
    guestDetail: guest
      ? {
          guestId: String(guest._id),
          firstName: guest.firstName,
          lastName: guest.lastName,
          email: guest.email,
          phone: guest.phone
        }
      : {
          guestId: null,
          firstName: mapped.guest.firstName,
          lastName: mapped.guest.lastName,
          email: mapped.guest.email,
          phone: mapped.guest.phone
        },
    availabilityLinkage: availability.map((block) => ({
      blockId: String(block._id),
      blockType: block.blockType,
      startDate: block.startDate,
      endDate: block.endDate,
      status: block.status
    })),
    paymentTrail: payments.map((payment) => ({
      paymentId: String(payment._id),
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      providerReference: payment.providerReference,
      sourceReference: payment.sourceReference || null,
      createdAt: payment.createdAt
    })),
    payoutRelevance: {
      payoutCount: payouts.length,
      latestPayout: payouts[0]
        ? {
            payoutId: String(payouts[0]._id),
            status: payouts[0].status,
            amount: payouts[0].amount,
            currency: payouts[0].currency
          }
        : null
    },
    communicationHistory: emailEvents.map((evt) => mapEmailEventToCommunicationCompatible(evt)),
    arrivalLifecycle: {
      arrivalStatus: booking.status === 'confirmed' ? 'sent' : null,
      viewedAt: null,
      completedAt: null
    },
    conflictContext: {
      hasHardConflict: availability.some((b) => b.status === 'active' && b.blockType !== 'external_hold'),
      hasWarning: availability.some((b) => b.status === 'active' && b.blockType === 'external_hold')
    },
    auditSummary: {
      totalRecentEvents: auditSummary.length,
      latestEventAt: auditSummary[0]?.happenedAt || null,
      events: auditSummary.map((evt) => ({
        id: String(evt._id),
        happenedAt: evt.happenedAt,
        action: evt.action,
        actorType: evt.actorType
      }))
    },
    notes: {
      backing: 'source_truth',
      items: notes.map((note) => ({
        noteId: String(note._id),
        content: note.content,
        author: {
          actorType: note.author?.actorType || null,
          actorId: note.author?.actorId || null,
          role: note.author?.role || null
        },
        createdAt: note.createdAt,
        editedAt: note.editedAt || null
      }))
    },
    degraded: {
      guestEntityMissing: !guest,
      payoutLinkageIncomplete: payouts.length === 0
    },
    provenance: booking.provenance || null,
    outboundCalendar: {
      publicIcsStrictEligibility: strictIcs,
      exportSafetyEnforced: isPublicIcsExportSafetyEnforced(),
      exportSafety,
      eligibleForSingleCabinOutboundIcs: outboundIcsEligible
    }
  };
}

module.exports = {
  getReservationDetailReadModel
};
