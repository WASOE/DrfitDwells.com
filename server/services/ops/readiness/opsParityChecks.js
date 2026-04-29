const Booking = require('../../../models/Booking');
const Guest = require('../../../models/Guest');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const AuditEvent = require('../../../models/AuditEvent');
const ChannelSyncEvent = require('../../../models/ChannelSyncEvent');
const CabinChannelSyncState = require('../../../models/CabinChannelSyncState');
const Payment = require('../../../models/Payment');
const Payout = require('../../../models/Payout');
const EmailEvent = require('../../../models/EmailEvent');
const ManualReviewItem = require('../../../models/ManualReviewItem');
const Cabin = require('../../../models/Cabin');
const ReservationNote = require('../../../models/ReservationNote');
const StripeEventEvidence = require('../../../models/StripeEventEvidence');

const { mapBookingToReservationCompatible } = require('../../../mappers/bookingToReservationMapper');
const { mapEmailEventToCommunicationCompatible } = require('../../../mappers/emailEventToCommunicationMapper');

const { normalizeExclusiveDateRange, normalizeDateToSofiaDayStart } = require('../../../utils/dateTime');

const {
  getDashboardReadModel
} = require('../readModels/dashboardReadModel');
const { getCalendarReadModel, syncIndicatorsForCabin } = require('../readModels/calendarReadModel');
const { getReservationsWorkspaceReadModel } = require('../readModels/reservationsReadModel');
const { getReservationDetailReadModel } = require('../readModels/reservationDetailReadModel');
const { getPaymentsSummaryReadModel, getPaymentsLedgerReadModel, getPayoutsListReadModel, getPayoutDetailReadModel, getPayoutReconciliationSummaryReadModel } = require('../readModels/paymentsReadModel');
const { getSyncCenterReadModel } = require('../readModels/syncCenterReadModel');
const { getCabinsListReadModel, getCabinDetailReadModel } = require('../readModels/cabinsReadModel');
const { getReviewsReadModel, getCommunicationOversightReadModel } = require('../readModels/reviewsCommsReadModel');
const { listReviewsForModeration } = require('../../reviews/reviewModerationService');

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function derivePaymentStatus(payments) {
  if (!payments || payments.length === 0) return null;
  if (payments.some((p) => p.status === 'disputed')) return 'disputed';
  if (payments.some((p) => p.status === 'failed')) return 'failed';
  if (payments.some((p) => p.status === 'refunded')) return 'refunded';
  if (payments.some((p) => p.status === 'partial')) return 'partial';
  if (payments.some((p) => p.status === 'paid')) return 'paid';
  return null;
}

function deriveArrivalStatus(booking) {
  if (booking.status === 'confirmed') return 'sent';
  if (booking.status === 'cancelled') return 'not_sent';
  return null;
}

function deriveSyncStatus(lastEvent) {
  if (!lastEvent) return 'stale';
  if (lastEvent.outcome === 'failed') return 'failed';
  if (lastEvent.outcome === 'warning') return 'warning';
  return 'healthy';
}

async function runDashboardParity({ comparisonDate = new Date() } = {}) {
  const actual = await getDashboardReadModel();

  const start = normalizeDateToSofiaDayStart(comparisonDate);
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 1);

  const [arrivalsToday, departuresToday, inHouse, failedPayments, failedEmails, upcomingPayouts, openManualReviews] = await Promise.all([
    Booking.countDocuments({ checkIn: { $gte: start, $lt: end } }),
    Booking.countDocuments({ checkOut: { $gte: start, $lt: end } }),
    Booking.countDocuments({ checkIn: { $lte: start }, checkOut: { $gt: start }, status: { $in: ['pending', 'confirmed'] } }),
    Payment.countDocuments({ status: { $in: ['failed', 'disputed'] } }),
    EmailEvent.countDocuments({ type: { $in: ['Bounce', 'SpamComplaint'] } }),
    Payout.countDocuments({ expectedArrivalDate: { $gte: start } }),
    ManualReviewItem.countDocuments({ status: 'open' })
  ]);

  const latestSync = await ChannelSyncEvent.findOne({}).sort({ runAt: -1 }).lean();
  const syncWarnings = await ChannelSyncEvent.countDocuments({ outcome: { $in: ['warning', 'failed'] } });

  const mismatches = [];
  function addMismatch(key, expected, got, critical = true) {
    if (expected !== got) mismatches.push({ key, expected, got, critical });
  }

  addMismatch('arrivalsToday', arrivalsToday, actual.aggregates?.arrivalsToday, true);
  addMismatch('departuresToday', departuresToday, actual.aggregates?.departuresToday, true);
  addMismatch('inHouse', inHouse, actual.aggregates?.inHouse, true);
  addMismatch('pendingActions', openManualReviews, actual.aggregates?.pendingActions, true);
  addMismatch('failedPayments', failedPayments, actual.aggregates?.failedPayments, true);
  addMismatch('failedEmails', failedEmails, actual.aggregates?.failedEmails, true);
  addMismatch('upcomingPayouts', upcomingPayouts, actual.aggregates?.upcomingPayouts, true);
  addMismatch('syncWarnings', syncWarnings, actual.aggregates?.syncWarnings, true);
  const expLastSyncAt = latestSync?.runAt ? new Date(latestSync.runAt).toISOString() : null;
  const gotLastSyncAt = actual.sync?.lastSyncAt ? new Date(actual.sync.lastSyncAt).toISOString() : null;
  addMismatch('sync.lastSyncAt', expLastSyncAt, gotLastSyncAt, false);
  addMismatch('sync.lastSyncOutcome', latestSync?.outcome || null, actual.sync?.lastSyncOutcome || null, false);

  const hasEvidence = arrivalsToday + departuresToday + inHouse + failedPayments + failedEmails + upcomingPayouts + openManualReviews > 0;

  return {
    module: 'dashboard',
    actual,
    expected: { aggregates: { arrivalsToday, departuresToday, inHouse, pendingActions: openManualReviews, failedPayments, failedEmails, upcomingPayouts: upcomingPayouts, syncWarnings }, sync: { lastSyncAt: latestSync?.runAt || null, lastSyncOutcome: latestSync?.outcome || null } },
    mismatches,
    evidence: { hasEvidence }
  };
}

async function runCalendarParity({ from, to, cabinId = null } = {}) {
  const normalized = normalizeExclusiveDateRange(from, to);
  const filters = {
    startDate: { $lt: normalized.endDate },
    endDate: { $gt: normalized.startDate },
    status: 'active'
  };
  if (cabinId) filters.cabinId = cabinId;

  const bookingFilters = {
    checkIn: { $lt: normalized.endDate },
    checkOut: { $gt: normalized.startDate }
  };
  if (cabinId) bookingFilters.cabinId = cabinId;

  const [availabilityBlocks, bookings] = await Promise.all([
    AvailabilityBlock.find(filters).lean(),
    Booking.find(bookingFilters).lean()
  ]);

  const reservationBacked = bookings
    .filter((b) => b.cabinId)
    .map((b) => {
      const range = normalizeExclusiveDateRange(b.checkIn, b.checkOut);
      return {
        id: `booking:${b._id}`,
        blockType: 'reservation',
        sourceType: 'reservation',
        sourceReference: String(b._id),
        cabinId: String(b.cabinId),
        unitId: b.unitId ? String(b.unitId) : null,
        startDate: range.startDate.toISOString(),
        endDate: range.endDate.toISOString(),
        status: 'active',
        tombstonedAt: null,
        provenance: {
          source: 'internal',
          sourceReference: String(b._id)
        }
      };
    });

  const canonicalBlocks = availabilityBlocks.map((blk) => ({
    id: `block:${blk._id}`,
    blockType: blk.blockType,
    sourceType: 'availability_block',
    sourceReference: String(blk._id),
    cabinId: String(blk.cabinId),
    unitId: blk.unitId ? String(blk.unitId) : null,
    startDate: normalizeDateToSofiaDayStart(blk.startDate).toISOString(),
    endDate: normalizeDateToSofiaDayStart(blk.endDate).toISOString(),
    status: blk.status,
    tombstonedAt: blk.tombstonedAt || null,
    provenance: {
      source: blk.source,
      sourceReference: blk.sourceReference || null
    }
  }));

  const allBlocks = [...canonicalBlocks, ...reservationBacked];
  const hardConflicts = [];
  const warnings = [];

  for (let i = 0; i < allBlocks.length; i += 1) {
    for (let j = i + 1; j < allBlocks.length; j += 1) {
      const a = allBlocks[i];
      const b = allBlocks[j];
      if (a.cabinId !== b.cabinId) continue;
      if (a.status === 'tombstoned' || b.status === 'tombstoned') continue;
      const isOverlap = overlaps(new Date(a.startDate), new Date(a.endDate), new Date(b.startDate), new Date(b.endDate));
      if (!isOverlap) continue;
      const isExternalWarning = a.blockType === 'external_hold' || b.blockType === 'external_hold';
      const marker = { cabinId: a.cabinId, blockA: a.id, blockB: b.id, type: isExternalWarning ? 'warning' : 'hard_conflict' };
      if (isExternalWarning) warnings.push(marker);
      else hardConflicts.push(marker);
    }
  }

  const latestSync = await ChannelSyncEvent.findOne(cabinId ? { cabinId } : {}).sort({ runAt: -1 }).lean();
  const expectedSyncIndicators = cabinId
    ? await syncIndicatorsForCabin(cabinId)
    : {
        lastSyncAt: latestSync?.runAt || null,
        lastSyncOutcome: latestSync?.outcome || null,
        syncStatus: latestSync
          ? latestSync.outcome === 'failed'
            ? 'failed'
            : latestSync.outcome === 'warning'
              ? 'warning'
              : 'healthy'
          : 'stale'
      };

  const expected = {
    blocks: allBlocks,
    conflictMarkers: { hard: hardConflicts, warnings },
    syncIndicators: expectedSyncIndicators
  };

  const actual = await getCalendarReadModel({ from, to, cabinId });

  const mismatches = [];
  function addMismatch(key, expectedValue, gotValue, critical = true) {
    if (expectedValue !== gotValue) mismatches.push({ key, expected: expectedValue, got: gotValue, critical });
  }

  addMismatch('blocks.total', expected.blocks.length, actual.blocks?.length, true);

  const expectedByType = expected.blocks.reduce((acc, b) => {
    acc[b.blockType] = (acc[b.blockType] || 0) + 1;
    return acc;
  }, {});
  const actualByType = (actual.blocks || []).reduce((acc, b) => {
    acc[b.blockType] = (acc[b.blockType] || 0) + 1;
    return acc;
  }, {});

  const allTypes = Array.from(new Set([...Object.keys(expectedByType), ...Object.keys(actualByType)]));
  for (const t of allTypes) {
    addMismatch(`blocks.${t}`, expectedByType[t] || 0, actualByType[t] || 0, false);
  }

  addMismatch('conflictMarkers.hard.count', expected.conflictMarkers.hard.length, actual.conflictMarkers?.hard?.length || 0, true);
  addMismatch('conflictMarkers.warnings.count', expected.conflictMarkers.warnings.length, actual.conflictMarkers?.warnings?.length || 0, false);

  addMismatch('sync.lastSyncAt', expected.syncIndicators.lastSyncAt, actual.syncIndicators?.lastSyncAt, false);
  addMismatch('sync.lastSyncOutcome', expected.syncIndicators.lastSyncOutcome, actual.syncIndicators?.lastSyncOutcome, false);

  addMismatch('sync.syncStatus', expected.syncIndicators.syncStatus, actual.syncIndicators?.syncStatus, false);

  const hasEvidence = expected.blocks.length > 0;

  return {
    module: 'calendar',
    actual,
    expected: { blocksCount: expected.blocks.length, conflictHard: expected.conflictMarkers.hard.length, conflictWarnings: expected.conflictMarkers.warnings.length },
    mismatches,
    evidence: { hasEvidence, cabinIdSample: cabinId || null, from: expected.syncIndicators.lastSyncAt ? from?.toISOString?.() || String(from) : from, to: to?.toISOString?.() || String(to) }
  };
}

async function runReservationsWorkspaceParity({ query = { page: 1, limit: 20 } } = {}) {
  const actual = await getReservationsWorkspaceReadModel(query);

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  // This parity check currently targets the "no filters other than pagination" default used by the readiness UI smoke checks.
  // If query contains filters later, we will extend the parity recomputation.
  const filters = {};

  const [bookings, total] = await Promise.all([
    Booking.find(filters).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Booking.countDocuments(filters)
  ]);

  const reservationIds = bookings.map((b) => String(b._id));

  const [payments, conflicts] = await Promise.all([
    Payment.find({ reservationId: { $in: reservationIds } }).lean(),
    AvailabilityBlock.find({ reservationId: { $in: reservationIds }, status: 'active' }).lean()
  ]);

  const paymentsByReservation = new Map();
  for (const payment of payments) {
    const key = payment.reservationId ? String(payment.reservationId) : null;
    if (!key) continue;
    if (!paymentsByReservation.has(key)) paymentsByReservation.set(key, []);
    paymentsByReservation.get(key).push(payment);
  }

  const conflictByReservation = new Set(conflicts.map((c) => (c.reservationId ? String(c.reservationId) : null)).filter(Boolean));

  const expectedItems = bookings.map((booking) => {
    const mapped = mapBookingToReservationCompatible(booking);
    const paymentTrail = paymentsByReservation.get(String(booking._id)) || [];
    const paymentStatus = derivePaymentStatus(paymentTrail);

    return {
      reservationId: mapped.reservationId,
      guestSummary: mapped.guest,
      dateRange: { startDate: mapped.checkInDate, endDate: mapped.checkOutDate },
      cabinSummary: { cabinId: mapped.cabinId, name: null, location: null },
      source: mapped.source,
      sourceReference: mapped.sourceReference,
      amount: mapped.amount,
      currency: mapped.currency,
      paymentStatus,
      arrivalStatus: deriveArrivalStatus(booking),
      conflict: {
        hasConflict: conflictByReservation.has(String(booking._id)),
        severity: conflictByReservation.has(String(booking._id)) ? 'hard' : null
      },
      degraded: { paymentLinkageIncomplete: paymentStatus === null }
    };
  });

  const mismatches = [];
  function addMismatch(key, expectedValue, gotValue, critical = true) {
    if (expectedValue !== gotValue) mismatches.push({ key, expected: expectedValue, got: gotValue, critical });
  }

  addMismatch('pagination.total', total, actual.pagination?.total, true);
  addMismatch('items.length', expectedItems.length, actual.items?.length || 0, true);

  // Sample-by-index to keep runtime bounded.
  const sampleSize = Math.min(5, expectedItems.length);
  for (let i = 0; i < sampleSize; i += 1) {
    const exp = expectedItems[i];
    const act = actual.items[i];
    if (!act) {
      mismatches.push({ key: `items[${i}]`, expected: exp, got: null, critical: true });
      continue;
    }
    addMismatch(`items[${i}].reservationId`, exp.reservationId, act.reservationId, true);
    addMismatch(`items[${i}].paymentStatus`, exp.paymentStatus, act.paymentStatus, true);
    addMismatch(`items[${i}].arrivalStatus`, exp.arrivalStatus, act.arrivalStatus, false);
    addMismatch(`items[${i}].conflict.hasConflict`, exp.conflict.hasConflict, act.conflict?.hasConflict, true);
    addMismatch(`items[${i}].conflict.severity`, exp.conflict.severity, act.conflict?.severity, false);
  }

  const hasEvidence = total > 0;
  return {
    module: 'reservations',
    actual,
    expected: { total, sampled: sampleSize },
    mismatches,
    evidence: { hasEvidence }
  };
}

async function runReservationDetailParity({ reservationId } = {}) {
  if (!reservationId) {
    const first = await Booking.findOne({}).select('_id').lean();
    reservationId = first?._id ? String(first._id) : null;
  }
  if (!reservationId) {
    return { module: 'reservation_detail', actual: null, expected: null, mismatches: [], evidence: { hasEvidence: false } };
  }

  const actual = await getReservationDetailReadModel(reservationId);

  const booking = await Booking.findById(reservationId).lean();
  if (!booking) return { module: 'reservation_detail', actual, expected: null, mismatches: [{ key: 'reservation', expected: 'exists', got: 'missing', critical: true }], evidence: { hasEvidence: false } };

  const mapped = mapBookingToReservationCompatible(booking);

  const [guest, availability, payments, payouts, emailEvents, auditSummary, notes] = await Promise.all([
    Guest.findOne({ email: booking.guestInfo?.email || null }).lean(),
    AvailabilityBlock.find({ reservationId: booking._id }).lean(),
    Payment.find({ reservationId: booking._id }).sort({ createdAt: -1 }).lean(),
    Payout.find({ 'metadata.reservationId': String(booking._id) }).sort({ createdAt: -1 }).lean(),
    EmailEvent.find({ bookingId: booking._id }).sort({ createdAt: -1 }).lean(),
    AuditEvent.find({ entityType: 'Reservation', entityId: String(booking._id) }).sort({ happenedAt: -1 }).limit(20).lean(),
    ReservationNote.find({ reservationId: booking._id, 'tombstone.isTombstoned': false }).sort({ createdAt: -1 }).lean()
  ]);

  const expectedNotes = notes.map((note) => ({ noteId: String(note._id), content: note.content, createdAt: note.createdAt }));

  const expectedConflict = {
    hasHardConflict: availability.some((b) => b.status === 'active' && b.blockType !== 'external_hold'),
    hasWarning: availability.some((b) => b.status === 'active' && b.blockType === 'external_hold')
  };

  const expectedPaymentTrail = payments.map((p) => ({
    paymentId: String(p._id),
    status: p.status,
    amount: p.amount,
    currency: p.currency,
    providerReference: p.providerReference
  }));

  const mismatches = [];
  function addMismatch(key, expectedValue, gotValue, critical = true) {
    if (expectedValue !== gotValue) mismatches.push({ key, expected: expectedValue, got: gotValue, critical });
  }

  addMismatch('reservation.reservationId', mapped.reservationId, actual.reservation?.reservationId, true);
  addMismatch('guestEntityMissing', Boolean(!guest), actual.degraded?.guestEntityMissing, false);
  addMismatch('notes.count', expectedNotes.length, actual.notes?.items?.length || 0, true);
  addMismatch('conflict.hasHardConflict', expectedConflict.hasHardConflict, actual.conflictContext?.hasHardConflict, false);
  addMismatch('conflict.hasWarning', expectedConflict.hasWarning, actual.conflictContext?.hasWarning, false);

  const sampleN = Math.min(3, expectedNotes.length);
  for (let i = 0; i < sampleN; i += 1) {
    addMismatch(`notes[${i}].content`, expectedNotes[i].content, actual.notes.items[i]?.content, false);
  }

  const hasEvidence = true; // if we reached here, booking exists

  return {
    module: 'reservation_detail',
    actual,
    expected: { reservationId, notesCount: expectedNotes.length, paymentTrailCount: expectedPaymentTrail.length },
    mismatches,
    evidence: { hasEvidence }
  };
}

async function runPaymentsPayoutsParity({ ledgerPage = 1, ledgerLimit = 5, payoutsPage = 1, payoutsLimit = 5 } = {}) {
  const [actualSummary, actualLedger, actualPayoutsList, actualPayoutReconciliation] = await Promise.all([
    getPaymentsSummaryReadModel(),
    getPaymentsLedgerReadModel({ page: ledgerPage, limit: ledgerLimit }),
    getPayoutsListReadModel({ page: payoutsPage, limit: payoutsLimit }),
    getPayoutReconciliationSummaryReadModel()
  ]);

  const [expectedTotals, lastWebhook, openReconciliationItems] = await Promise.all([
    Promise.all([
      Payment.countDocuments({}),
      Payment.countDocuments({ status: 'failed' }),
      Payment.countDocuments({ status: 'disputed' }),
      Payment.countDocuments({ reservationId: null })
    ]),
    StripeEventEvidence.findOne({}).sort({ createdAtProvider: -1 }).lean(),
    ManualReviewItem.countDocuments({ category: { $in: ['payment_unlinked', 'payout_unlinked'] }, status: 'open' })
  ]);

  const [total, failed, disputed, unlinked] = expectedTotals;
  const mismatches = [];
  function addMismatch(key, expectedValue, gotValue, critical = true) {
    if (expectedValue !== gotValue) mismatches.push({ key, expected: expectedValue, got: gotValue, critical });
  }

  addMismatch('payments.totals.total', total, actualSummary?.totals?.total, true);
  addMismatch('payments.totals.failed', failed, actualSummary?.totals?.failed, true);
  addMismatch('payments.totals.disputed', disputed, actualSummary?.totals?.disputed, true);
  addMismatch('payments.totals.unlinked', unlinked, actualSummary?.totals?.unlinked, true);

  const expWebhookLastSeenAt = lastWebhook?.createdAtProvider ? new Date(lastWebhook.createdAtProvider).toISOString() : null;
  const gotWebhookLastSeenAt = actualSummary?.observability?.webhookLastSeenAt ? new Date(actualSummary.observability.webhookLastSeenAt).toISOString() : null;
  addMismatch('payments.observability.webhookLastSeenAt', expWebhookLastSeenAt, gotWebhookLastSeenAt, false);
  addMismatch('payments.observability.webhookLastEventType', lastWebhook?.eventType || null, actualSummary?.observability?.webhookLastEventType, false);
  addMismatch('payments.observability.openReconciliationItems', openReconciliationItems, actualSummary?.observability?.openReconciliationItems, true);

  const safePage = Math.max(1, parseInt(ledgerPage, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(ledgerLimit, 10) || 5));
  const ledgerSkip = (safePage - 1) * safeLimit;
  const ledgerItems = await Payment.find({}).sort({ createdAt: -1 }).skip(ledgerSkip).limit(safeLimit).lean();

  addMismatch('payments.ledger.items.length', ledgerItems.length, actualLedger?.items?.length || 0, true);
  const sampleN = Math.min(3, ledgerItems.length);
  for (let i = 0; i < sampleN; i += 1) {
    const exp = ledgerItems[i];
    const act = actualLedger.items[i];
    addMismatch(`ledger[${i}].paymentId`, String(exp._id), act?.paymentId, true);
    addMismatch(`ledger[${i}].status`, exp.status, act?.status, true);
    addMismatch(`ledger[${i}].linkageState`, exp.reservationId ? 'linked' : 'unlinked', act?.linkageState, false);
  }

  // Payout list parity
  const payoutSafeLimit = Math.min(100, Math.max(1, parseInt(payoutsLimit, 10) || 5));
  const payoutSafePage = Math.max(1, parseInt(payoutsPage, 10) || 1);
  const payoutSkip = (payoutSafePage - 1) * payoutSafeLimit;
  const payoutItems = await Payout.find({}).sort({ createdAt: -1 }).skip(payoutSkip).limit(payoutSafeLimit).lean();

  addMismatch('payouts.items.length', payoutItems.length, actualPayoutsList?.items?.length || 0, true);
  const sampleP = Math.min(3, payoutItems.length);
  for (let i = 0; i < sampleP; i += 1) {
    const exp = payoutItems[i];
    const act = actualPayoutsList.items[i];
    addMismatch(`payouts[${i}].payoutId`, String(exp._id), act?.payoutId, true);
    addMismatch(`payouts[${i}].status`, exp.status, act?.status, true);
  }

  // Payout reconciliation parity totals
  const [totalPayouts, withReservationReference] = await Promise.all([
    Payout.countDocuments({}),
    Payout.countDocuments({ 'metadata.reservationId': { $exists: true, $ne: null } })
  ]);
  const expectedIncomplete = totalPayouts - withReservationReference;
  addMismatch('reconciliation.totals.totalPayouts', totalPayouts, actualPayoutReconciliation?.totals?.totalPayouts, true);
  addMismatch('reconciliation.totals.withReservationReference', withReservationReference, actualPayoutReconciliation?.totals?.withReservationReference, true);
  addMismatch('reconciliation.totals.incompleteLinkage', expectedIncomplete, actualPayoutReconciliation?.totals?.incompleteLinkage, true);

  const openUnlinkedPayoutReviews = await ManualReviewItem.countDocuments({ category: 'payout_unlinked', status: 'open' });
  addMismatch('reconciliation.manualReview.openUnlinkedPayouts', openUnlinkedPayoutReviews, actualPayoutReconciliation?.manualReview?.openUnlinkedPayouts, true);

  const firstPayout = await Payout.findOne({}).select('_id').lean();
  let payoutDetailMismatch = [];
  if (firstPayout?._id) {
    const payoutId = String(firstPayout._id);
    const actualDetail = await getPayoutDetailReadModel(payoutId);
    const payout = await Payout.findById(payoutId).lean();
    const reservationRef = payout.metadata?.reservationId || null;
    const reservation = reservationRef ? await Booking.findById(reservationRef).select('_id checkIn checkOut').lean() : null;

    const expectedState = reservation ? 'linked' : 'unknown_or_unlinked';
    const actualState = actualDetail?.reconciliation?.linkageState;
    payoutDetailMismatch = [];
    if (expectedState !== actualState) {
      payoutDetailMismatch.push({ key: 'payoutDetail.reconciliation.linkageState', expected: expectedState, got: actualState, critical: false });
    }
  }

  const mismatchesAll = mismatches.concat(payoutDetailMismatch);

  const evidence = {
    hasEvidence:
      total + failed + disputed + unlinked > 0 ||
      payoutItems.length > 0 ||
      totalPayouts > 0
  };

  return {
    module: 'payments_payouts',
    actual: { actualSummary, actualLedger, actualPayoutsList, actualPayoutReconciliation },
    expected: { totalPayments: total, totalPayouts: await Payout.countDocuments({}) },
    mismatches: mismatchesAll,
    evidence
  };
}

async function runSyncCenterParity({ cabinId = null } = {}) {
  const actual = await getSyncCenterReadModel({ cabinId });

  const syncFilter = {};
  const holdFilter = { blockType: 'external_hold', status: 'active' };
  if (cabinId) {
    syncFilter.cabinId = cabinId;
    holdFilter.cabinId = cabinId;
  }

  const [events, externalHoldCount, unresolvedManualReviews, syncStates] = await Promise.all([
    ChannelSyncEvent.find(syncFilter).sort({ runAt: -1 }).limit(100).lean(),
    AvailabilityBlock.countDocuments(holdFilter),
    ManualReviewItem.countDocuments({
      category: { $in: ['sync_anomaly', 'sync_feed_unreachable', 'sync_parse_failure', 'sync_duplicate_import', 'sync_deterministic_key_risk'] },
      status: 'open'
    }),
    CabinChannelSyncState.find(cabinId ? { cabinId } : {}).lean()
  ]);

  const grouped = new Map();
  for (const event of events) {
    const key = `${String(event.cabinId)}:${event.channel}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        cabinId: String(event.cabinId),
        channel: event.channel,
        lastSyncedAt: event.runAt,
        lastSyncOutcome: event.outcome,
        syncStatus: deriveSyncStatus(event),
        unresolvedAnomalies: 0
      });
    }
    if (event.outcome !== 'success') grouped.get(key).unresolvedAnomalies += 1;
  }

  const stateMap = new Map(syncStates.map((s) => [`${String(s.cabinId)}:${s.channel}`, s]));
  const merged = Array.from(grouped.values());
  for (const state of syncStates) {
    const key = `${String(state.cabinId)}:${state.channel}`;
    if (!grouped.has(key)) {
      merged.push({
        cabinId: String(state.cabinId),
        channel: state.channel,
        lastSyncedAt: state.lastSyncedAt || null,
        lastSyncOutcome: state.lastSyncOutcome || null,
        syncStatus: state.lastSyncOutcome || 'stale',
        unresolvedAnomalies: 0
      });
    }
  }

  const healthByCabinChannel = merged.map((entry) => {
    const state = stateMap.get(`${entry.cabinId}:${entry.channel}`);
    return {
      ...entry,
      lastSyncedAt: state?.lastSyncedAt || entry.lastSyncedAt || null,
      lastSyncOutcome: state?.lastSyncOutcome || entry.lastSyncOutcome || null,
      configuredFeed: Boolean(state?.feedUrl),
      stale: state?.lastSyncedAt ? Date.now() - new Date(state.lastSyncedAt).getTime() > 24 * 60 * 60 * 1000 : true
    };
  });

  const mismatches = [];
  function addMismatch(key, expectedValue, gotValue, critical = true) {
    if (expectedValue !== gotValue) mismatches.push({ key, expected: expectedValue, got: gotValue, critical });
  }

  addMismatch('healthByCabinChannel.length', healthByCabinChannel.length, actual.healthByCabinChannel?.length || 0, true);
  addMismatch('aggregates.externalHoldCount', externalHoldCount, actual.aggregates?.externalHoldCount, true);
  addMismatch('aggregates.unresolvedSyncManualReviews', unresolvedManualReviews, actual.aggregates?.unresolvedSyncManualReviews, true);

  // Sample first 3 entries after sorting by cabinId/channel so it is deterministic.
  const sortedExpected = [...healthByCabinChannel].sort((a, b) => {
    const ka = `${a.cabinId}:${a.channel}`;
    const kb = `${b.cabinId}:${b.channel}`;
    return ka.localeCompare(kb);
  });
  const sortedActual = [...(actual.healthByCabinChannel || [])].sort((a, b) => {
    const ka = `${a.cabinId}:${a.channel}`;
    const kb = `${b.cabinId}:${b.channel}`;
    return ka.localeCompare(kb);
  });
  const sampleN = Math.min(3, sortedExpected.length);
  for (let i = 0; i < sampleN; i += 1) {
    addMismatch(`health[${i}].cabinId`, sortedExpected[i].cabinId, sortedActual[i].cabinId, true);
    addMismatch(`health[${i}].channel`, sortedExpected[i].channel, sortedActual[i].channel, true);
    addMismatch(`health[${i}].syncStatus`, sortedExpected[i].syncStatus, sortedActual[i].syncStatus, false);
  }

  const evidence = { hasEvidence: events.length > 0 || syncStates.length > 0 || externalHoldCount > 0 };

  return {
    module: 'sync_center',
    actual,
    expected: { externalHoldCount, eventsCount: events.length, syncStatesCount: syncStates.length },
    mismatches,
    evidence
  };
}

async function runCabinsDetailParity({ cabinId = null } = {}) {
  const cabin = cabinId ? await Cabin.findById(cabinId).lean() : await Cabin.findOne({}).lean();
  if (!cabin) {
    return { module: 'cabins', actual: null, expected: null, mismatches: [], evidence: { hasEvidence: false } };
  }
  const actual = await getCabinDetailReadModel(String(cabin._id));

  const expected = {
    cabinId: String(cabin._id),
    operationalSettings: {
      capacity: cabin.capacity,
      minNights: cabin.minNights,
      pricePerNight: cabin.pricePerNight,
      blockedDates: cabin.blockedDates || [],
      transportOptions: cabin.transportOptions || [],
      meetingPoint: cabin.meetingPoint || null
    },
    contentMedia: {
      name: cabin.name,
      description: cabin.description,
      location: cabin.location,
      imageUrl: cabin.imageUrl || null,
      images: cabin.images || [],
      badges: cabin.badges || null,
      highlights: cabin.highlights || []
    },
    preArrival: {
      packingList: cabin.packingList || [],
      arrivalGuideUrl: cabin.arrivalGuideUrl || null,
      safetyNotes: cabin.safetyNotes || null,
      emergencyContact: cabin.emergencyContact || null,
      arrivalWindowDefault: cabin.arrivalWindowDefault || null
    },
    degraded: {
      missingGeo: !cabin.geoLocation?.latitude || !cabin.geoLocation?.longitude
    }
  };

  const mismatches = [];
  function addMismatch(key, expectedValue, gotValue, critical = true) {
    if (expectedValue !== gotValue) mismatches.push({ key, expected: expectedValue, got: gotValue, critical });
  }

  addMismatch('cabinId', expected.cabinId, actual?.cabinId, true);
  addMismatch('degraded.missingGeo', expected.degraded.missingGeo, actual?.degraded?.missingGeo, false);
  addMismatch('operationalSettings.capacity', expected.operationalSettings.capacity, actual?.operationalSettings?.capacity, true);
  addMismatch('preArrival.arrivalGuideUrl', expected.preArrival.arrivalGuideUrl, actual?.preArrival?.arrivalGuideUrl, false);
  // Avoid deep array equality for large fields; use length checks.
  addMismatch('contentMedia.images.length', expected.contentMedia.images.length, actual?.contentMedia?.images?.length || 0, false);

  return {
    module: 'cabins',
    actual,
    expected,
    mismatches,
    evidence: { hasEvidence: true }
  };
}

async function runReviewsCommsParity({ page = 1, limit = 20 } = {}) {
  const actualReviews = await getReviewsReadModel({ page, limit });
  const actualComms = await getCommunicationOversightReadModel();

  const expectedList = await listReviewsForModeration({ page, limit, sort: 'newest' });

  const expectedReviews = {
    items: expectedList.reviews.map((review) => ({
      reviewId: String(review._id),
      cabinId: review.cabinId
        ? typeof review.cabinId === 'object' && review.cabinId._id
          ? String(review.cabinId._id)
          : String(review.cabinId)
        : null,
      source: review.source,
      rating: review.rating,
      status: review.status,
      pinned: Boolean(review.pinned),
      locked: Boolean(review.locked),
      createdAtSource: review.createdAtSource || null
    })),
    moderationSummary: expectedList.moderationSummary,
    pagination: {
      page: expectedList.page,
      limit: expectedList.limit,
      total: expectedList.total,
      totalPages: expectedList.totalPages
    }
  };

  const [recentFailures, recentEvents] = await Promise.all([
    EmailEvent.countDocuments({ type: { $in: ['Bounce', 'SpamComplaint'] } }),
    EmailEvent.find({}).sort({ createdAt: -1 }).limit(50).lean()
  ]);

  const expectedComms = {
    summary: { failedEvents: recentFailures, totalRecentEvents: recentEvents.length },
    recent: recentEvents.map((evt) => ({ eventId: String(evt._id), type: evt.type || null, bookingId: evt.bookingId ? String(evt.bookingId) : null, recipient: evt.to || null, happenedAt: evt.createdAt })),
    degraded: { eventTrackingGapsPossible: true }
  };

  const mismatches = [];
  function addMismatch(key, expectedValue, gotValue, critical = true) {
    if (expectedValue !== gotValue) mismatches.push({ key, expected: expectedValue, got: gotValue, critical });
  }

  addMismatch('reviews.moderationSummary.approved', expectedReviews.moderationSummary.approved, actualReviews?.moderationSummary?.approved, true);
  addMismatch('reviews.moderationSummary.pending', expectedReviews.moderationSummary.pending, actualReviews?.moderationSummary?.pending, true);
  addMismatch('reviews.moderationSummary.hidden', expectedReviews.moderationSummary.hidden, actualReviews?.moderationSummary?.hidden, true);

  const sampleN = Math.min(3, expectedReviews.items.length);
  for (let i = 0; i < sampleN; i += 1) {
    addMismatch(`reviews.items[${i}].reviewId`, expectedReviews.items[i].reviewId, actualReviews?.items?.[i]?.reviewId, true);
    addMismatch(`reviews.items[${i}].status`, expectedReviews.items[i].status, actualReviews?.items?.[i]?.status, false);
  }

  addMismatch('comms.summary.failedEvents', expectedComms.summary.failedEvents, actualComms?.summary?.failedEvents, true);
  addMismatch('comms.summary.totalRecentEvents', expectedComms.summary.totalRecentEvents, actualComms?.summary?.totalRecentEvents, true);

  const sampleC = Math.min(3, expectedComms.recent.length);
  for (let i = 0; i < sampleC; i += 1) {
    addMismatch(`comms.recent[${i}].eventId`, expectedComms.recent[i].eventId, actualComms?.recent?.[i]?.eventId, false);
  }

  const evidence = { hasEvidence: expectedList.total > 0 || expectedComms.summary.totalRecentEvents > 0 };

  return {
    module: 'reviews_communications',
    actual: { reviews: actualReviews, comms: actualComms },
    expected: { reviewsTotal: expectedList.total, commsRecent: expectedComms.summary.totalRecentEvents },
    mismatches,
    evidence
  };
}

module.exports = {
  runDashboardParity,
  runCalendarParity,
  runReservationsWorkspaceParity,
  runReservationDetailParity,
  runPaymentsPayoutsParity,
  runSyncCenterParity,
  runCabinsDetailParity,
  runReviewsCommsParity
};

