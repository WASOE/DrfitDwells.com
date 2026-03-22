/**
 * Outbound public ICS: production-safety gate for Booking rows (independent of strict payment rules).
 * Only explicit isProductionSafe or provenance.source guest_portal (plus pending payment rule) exports.
 * No legacy paid/confirmed fallback — missing or unknown provenance never exports.
 */

const EXPORT_UNSAFE_SOURCES = new Set([
  'seed',
  'demo',
  'validation',
  'test',
  'internal',
  'migration',
  'fixture',
  'script',
  'backfill',
  'dry_run'
]);

const EXPORT_TRUSTED_SOURCES = new Set(['guest_portal']);

function normalizeProvenanceSource(bookingLean) {
  return String(bookingLean?.provenance?.source || '')
    .trim()
    .toLowerCase() || null;
}

/**
 * @param {object} bookingLean
 * @param {Set<string>} paidReservationIdSet reservationId strings with paid/partial Payment evidence
 * @returns {{ effectiveSafe: boolean, reasonCode: string, uncertainty: boolean }}
 */
function resolveBookingExportSafety(bookingLean, paidReservationIdSet = new Set()) {
  const id = bookingLean?._id ? String(bookingLean._id) : '';
  const hasPaid = id ? paidReservationIdSet.has(id) : false;
  const src = normalizeProvenanceSource(bookingLean);

  if (bookingLean?.isTest === true) {
    return { effectiveSafe: false, reasonCode: 'is_test', uncertainty: false };
  }

  if (bookingLean?.isProductionSafe === true) {
    return { effectiveSafe: true, reasonCode: 'explicit_production_safe', uncertainty: false };
  }
  if (bookingLean?.isProductionSafe === false) {
    return { effectiveSafe: false, reasonCode: 'explicit_not_production_safe', uncertainty: false };
  }

  if (src && EXPORT_UNSAFE_SOURCES.has(src)) {
    return { effectiveSafe: false, reasonCode: 'provenance_unsafe_source', uncertainty: false };
  }

  if (src && EXPORT_TRUSTED_SOURCES.has(src)) {
    if (bookingLean?.status === 'pending' && !hasPaid) {
      return { effectiveSafe: false, reasonCode: 'trusted_pending_unpaid', uncertainty: false };
    }
    return { effectiveSafe: true, reasonCode: 'provenance_trusted_source', uncertainty: false };
  }

  if (!src) {
    return { effectiveSafe: false, reasonCode: 'missing_provenance_conservative', uncertainty: true };
  }

  return {
    effectiveSafe: false,
    reasonCode: 'unknown_provenance_source_conservative',
    uncertainty: true
  };
}

module.exports = {
  resolveBookingExportSafety,
  EXPORT_UNSAFE_SOURCES,
  EXPORT_TRUSTED_SOURCES,
  normalizeProvenanceSource
};
