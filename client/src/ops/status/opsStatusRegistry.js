/**
 * Ops status registry — presentation data only.
 * Source: DND_OPS_DESIGN_LANGUAGE_GUIDE_V1_2_LOCKED.md §12.
 *
 * Does not change backend enums, API semantics, or production page rendering.
 */

export const OPS_STATUS_FAMILIES = Object.freeze(['neutral', 'info', 'success', 'warning', 'danger']);
export const OPS_STATUS_LOUDNESS = Object.freeze(['quiet', 'normal', 'attention']);

function defineStatus({ key, en, bg = null, family, loudness, icon = null, contexts }) {
  const dot = key.indexOf('.');
  const domain = dot === -1 ? key : key.slice(0, dot);
  return Object.freeze({
    key,
    domain,
    label: Object.freeze({ en, bg }),
    family,
    loudness,
    icon,
    contexts: Object.freeze(contexts || [domain])
  });
}

const OPS_STATUS_ENTRIES = Object.freeze([
  // Reservation lifecycle
  defineStatus({ key: 'reservation.pending', en: 'Pending', family: 'neutral', loudness: 'normal' }),
  defineStatus({ key: 'reservation.confirmed', en: 'Confirmed', family: 'success', loudness: 'quiet' }),
  defineStatus({ key: 'reservation.in_house', en: 'In house', family: 'info', loudness: 'normal' }),
  defineStatus({ key: 'reservation.completed', en: 'Completed', family: 'neutral', loudness: 'quiet' }),
  defineStatus({ key: 'reservation.cancelled', en: 'Cancelled', family: 'neutral', loudness: 'normal' }),

  // Reservation operational
  defineStatus({
    key: 'reservation.currently_staying',
    en: 'Currently staying',
    family: 'info',
    loudness: 'quiet'
  }),
  defineStatus({
    key: 'reservation.arriving_today',
    en: 'Arriving today',
    family: 'info',
    loudness: 'normal'
  }),
  defineStatus({
    key: 'reservation.arriving_tomorrow',
    en: 'Arriving tomorrow',
    family: 'info',
    loudness: 'quiet'
  }),
  defineStatus({
    key: 'reservation.arriving_later',
    en: 'Arriving in N days',
    family: 'info',
    loudness: 'quiet'
  }),
  defineStatus({
    key: 'reservation.checked_out',
    en: 'Checked out',
    family: 'neutral',
    loudness: 'quiet'
  }),
  defineStatus({
    key: 'reservation.checking_out_today',
    en: 'Checking out today',
    family: 'info',
    loudness: 'normal'
  }),
  defineStatus({
    key: 'reservation.cancelled_paid',
    en: 'Cancelled + paid',
    family: 'info',
    loudness: 'normal'
  }),
  defineStatus({
    key: 'reservation.refund_pending',
    en: 'Refund pending',
    family: 'warning',
    loudness: 'attention'
  }),
  defineStatus({
    key: 'reservation.payment_attention',
    en: 'Payment attention',
    family: 'danger',
    loudness: 'attention'
  }),
  defineStatus({ key: 'reservation.conflict', en: 'Conflict', family: 'danger', loudness: 'attention' }),

  // Reservation payment
  defineStatus({ key: 'payment.paid', en: 'Paid', family: 'success', loudness: 'quiet' }),
  defineStatus({ key: 'payment.partial', en: 'Partial', family: 'warning', loudness: 'normal' }),
  defineStatus({ key: 'payment.failed', en: 'Failed', family: 'danger', loudness: 'attention' }),
  defineStatus({ key: 'payment.disputed', en: 'Disputed', family: 'danger', loudness: 'attention' }),
  defineStatus({ key: 'payment.refunded', en: 'Refunded', family: 'info', loudness: 'quiet' }),
  defineStatus({ key: 'payment.unpaid', en: 'Unpaid', family: 'warning', loudness: 'normal' }),
  defineStatus({
    key: 'payment.pending_verification',
    en: 'Pending verification',
    family: 'warning',
    loudness: 'normal'
  }),
  defineStatus({
    key: 'payment.manual_not_required',
    en: 'Manual / not required',
    family: 'neutral',
    loudness: 'quiet'
  }),
  defineStatus({
    key: 'payment.unlinked',
    en: 'Unlinked payment',
    family: 'danger',
    loudness: 'attention'
  }),
  defineStatus({ key: 'payment.unknown', en: 'Unknown', family: 'warning', loudness: 'normal' }),

  // Cleaning (cleaner-facing BG labels from §12.1)
  defineStatus({
    key: 'cleaning.pending',
    en: 'Pending',
    bg: 'За почистване',
    family: 'warning',
    loudness: 'normal'
  }),
  defineStatus({
    key: 'cleaning.done',
    en: 'Done',
    bg: 'Почистено',
    family: 'success',
    loudness: 'quiet'
  }),
  defineStatus({
    key: 'cleaning.same_day_turn',
    en: 'Same-day turn',
    bg: 'Смяна в същия ден',
    family: 'warning',
    loudness: 'attention'
  }),
  defineStatus({
    key: 'cleaning_payment.pending',
    en: 'Pending',
    bg: 'За плащане',
    family: 'warning',
    loudness: 'normal'
  }),
  defineStatus({
    key: 'cleaning_payment.partial',
    en: 'Partial',
    bg: 'Частично платено',
    family: 'warning',
    loudness: 'normal'
  }),
  defineStatus({
    key: 'cleaning_payment.paid',
    en: 'Paid',
    bg: 'Платено',
    family: 'success',
    loudness: 'quiet'
  }),

  // Sync
  defineStatus({ key: 'sync.healthy', en: 'Sync healthy', family: 'success', loudness: 'quiet' }),
  defineStatus({ key: 'sync.warning', en: 'Sync warning', family: 'warning', loudness: 'normal' }),
  defineStatus({ key: 'sync.stale', en: 'Sync stale', family: 'warning', loudness: 'normal' }),
  defineStatus({ key: 'sync.failed', en: 'Sync failed', family: 'danger', loudness: 'attention' }),

  // Reviews
  defineStatus({ key: 'review.approved', en: 'Approved', family: 'success', loudness: 'quiet' }),
  defineStatus({ key: 'review.pending', en: 'Pending', family: 'warning', loudness: 'normal' }),
  defineStatus({ key: 'review.hidden', en: 'Hidden', family: 'neutral', loudness: 'quiet' }),

  // Gift vouchers
  defineStatus({ key: 'voucher.draft', en: 'Draft', family: 'neutral', loudness: 'quiet' }),
  defineStatus({
    key: 'voucher.pending_payment',
    en: 'Pending payment',
    family: 'warning',
    loudness: 'normal'
  }),
  defineStatus({ key: 'voucher.active', en: 'Active', family: 'success', loudness: 'quiet' }),
  defineStatus({
    key: 'voucher.partially_redeemed',
    en: 'Partially redeemed',
    family: 'info',
    loudness: 'normal'
  }),
  defineStatus({ key: 'voucher.redeemed', en: 'Redeemed', family: 'success', loudness: 'quiet' }),
  defineStatus({ key: 'voucher.expired', en: 'Expired', family: 'neutral', loudness: 'quiet' }),
  defineStatus({ key: 'voucher.voided', en: 'Voided', family: 'neutral', loudness: 'normal' }),
  defineStatus({ key: 'voucher.refunded', en: 'Refunded', family: 'info', loudness: 'quiet' }),

  // Promo / cabin
  defineStatus({ key: 'promo.active', en: 'Active', family: 'success', loudness: 'quiet' }),
  defineStatus({ key: 'promo.inactive', en: 'Inactive', family: 'neutral', loudness: 'quiet' }),
  defineStatus({ key: 'cabin.active', en: 'Active', family: 'neutral', loudness: 'quiet' }),
  defineStatus({ key: 'cabin.inactive', en: 'Inactive', family: 'neutral', loudness: 'quiet' }),
  defineStatus({ key: 'cabin.blocked', en: 'Blocked units', family: 'warning', loudness: 'normal' }),

  // Manual review / readiness
  defineStatus({ key: 'manual_review.open', en: 'Open', family: 'warning', loudness: 'normal' }),
  defineStatus({ key: 'manual_review.high', en: 'High', family: 'warning', loudness: 'attention' }),
  defineStatus({
    key: 'manual_review.critical',
    en: 'Critical',
    family: 'danger',
    loudness: 'attention'
  }),
  defineStatus({
    key: 'readiness.ready',
    en: 'Ready for primary use',
    family: 'success',
    loudness: 'quiet'
  }),
  defineStatus({
    key: 'readiness.restricted',
    en: 'Ready for restricted cutover',
    family: 'warning',
    loudness: 'normal'
  }),
  defineStatus({
    key: 'readiness.conditional',
    en: 'Conditionally ready',
    family: 'warning',
    loudness: 'normal'
  }),
  defineStatus({
    key: 'readiness.not_ready',
    en: 'Not ready',
    family: 'danger',
    loudness: 'attention'
  }),

  // Messaging
  defineStatus({ key: 'template.approved', en: 'Approved', family: 'success', loudness: 'quiet' }),
  defineStatus({ key: 'template.draft', en: 'Draft', family: 'warning', loudness: 'normal' }),
  defineStatus({ key: 'template.disabled', en: 'Disabled', family: 'neutral', loudness: 'quiet' }),
  defineStatus({ key: 'job.scheduled', en: 'Scheduled', family: 'info', loudness: 'quiet' }),
  defineStatus({ key: 'job.claimed', en: 'Processing', family: 'info', loudness: 'quiet' }),
  defineStatus({ key: 'job.sent', en: 'Sent', family: 'success', loudness: 'quiet' }),
  defineStatus({ key: 'job.failed', en: 'Failed', family: 'danger', loudness: 'attention' }),
  defineStatus({ key: 'job.cancelled', en: 'Cancelled', family: 'neutral', loudness: 'quiet' }),
  defineStatus({ key: 'job.suppressed', en: 'Suppressed', family: 'neutral', loudness: 'normal' }),
  defineStatus({
    key: 'job.skipped_status_guard',
    en: 'Skipped',
    family: 'neutral',
    loudness: 'quiet'
  }),
  defineStatus({
    key: 'job.skipped_no_consent',
    en: 'Skipped: no consent',
    family: 'neutral',
    loudness: 'quiet'
  }),

  // Creator partners / commissions
  defineStatus({ key: 'partner.draft', en: 'Draft', family: 'neutral', loudness: 'quiet' }),
  defineStatus({ key: 'partner.active', en: 'Active', family: 'success', loudness: 'quiet' }),
  defineStatus({ key: 'partner.paused', en: 'Paused', family: 'neutral', loudness: 'normal' }),
  defineStatus({ key: 'partner.archived', en: 'Archived', family: 'neutral', loudness: 'quiet' }),
  defineStatus({ key: 'commission.pending', en: 'Pending', family: 'warning', loudness: 'normal' }),
  defineStatus({ key: 'commission.approved', en: 'Approved', family: 'info', loudness: 'quiet' }),
  defineStatus({ key: 'commission.paid', en: 'Paid', family: 'success', loudness: 'quiet' }),
  defineStatus({ key: 'commission.voided', en: 'Voided', family: 'neutral', loudness: 'quiet' }),
  defineStatus({
    key: 'commission.needs_review',
    en: 'Needs review',
    family: 'warning',
    loudness: 'attention'
  }),
  defineStatus({ key: 'commission.eligible', en: 'Eligible', family: 'success', loudness: 'quiet' }),
  defineStatus({
    key: 'commission.not_eligible',
    en: 'Not eligible',
    family: 'neutral',
    loudness: 'quiet'
  }),

  // Quote recovery
  defineStatus({ key: 'quote.quoted', en: 'Quoted', family: 'info', loudness: 'quiet' }),
  defineStatus({
    key: 'quote.checkout_started',
    en: 'Checkout started',
    family: 'info',
    loudness: 'normal'
  }),
  defineStatus({ key: 'quote.converted', en: 'Converted', family: 'success', loudness: 'quiet' }),
  defineStatus({ key: 'quote.expired', en: 'Expired', family: 'neutral', loudness: 'quiet' }),
  defineStatus({ key: 'quote.superseded', en: 'Superseded', family: 'neutral', loudness: 'quiet' }),
  defineStatus({ key: 'quote.ineligible', en: 'Ineligible', family: 'neutral', loudness: 'quiet' }),
  defineStatus({ key: 'quote.suppressed', en: 'Suppressed', family: 'warning', loudness: 'normal' })
]);

const OPS_STATUS_BY_KEY = new Map(OPS_STATUS_ENTRIES.map((entry) => [entry.key, entry]));

/**
 * Domain-scoped backend aliases only. Never a global `pending` map.
 * `void` / `voided` → commission.voided (guide §12.1).
 * `processing` → job.claimed (canonical key is claimed; label is Processing).
 */
export const OPS_STATUS_ALIASES = Object.freeze({
  commission: Object.freeze({
    void: 'commission.voided',
    voided: 'commission.voided'
  }),
  job: Object.freeze({
    processing: 'job.claimed'
  })
});

export function listOpsStatusEntries() {
  return OPS_STATUS_ENTRIES;
}

export function getOpsStatusByKey(key) {
  return OPS_STATUS_BY_KEY.get(key) || null;
}

export function normalizeOpsStatusBackendValue(value) {
  if (value == null) return '';
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function humanizeOpsStatusValue(value) {
  const normalized = normalizeOpsStatusBackendValue(value);
  if (!normalized) return 'Unknown';
  const spaced = normalized.replace(/_+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function cloneStatusEntry(entry, extras = {}) {
  return {
    key: entry.key,
    domain: entry.domain,
    label: { en: entry.label.en, bg: entry.label.bg },
    family: entry.family,
    loudness: entry.loudness,
    icon: entry.icon,
    contexts: entry.contexts ? [...entry.contexts] : [],
    unknown: false,
    ...extras
  };
}

function isNonProduction() {
  return import.meta.env.DEV === true;
}

function warnUnknownStatus(domain, backendValue) {
  if (!isNonProduction()) return;
  console.warn(`[ops-status] unknown status: domain=${domain} value=${backendValue}`);
}

function unknownStatusFallback(domain, backendValue) {
  const normalized = normalizeOpsStatusBackendValue(backendValue);
  const key = domain && normalized ? `${domain}.${normalized}` : `unknown.${normalized || 'empty'}`;
  warnUnknownStatus(domain, backendValue);
  return {
    key,
    domain: domain || 'unknown',
    label: { en: humanizeOpsStatusValue(backendValue), bg: null },
    family: 'neutral',
    loudness: 'normal',
    icon: null,
    contexts: domain ? [domain] : [],
    unknown: true,
    backendValue
  };
}

/**
 * Resolve a namespaced UI status from a domain + backend value.
 * Unknown values return a neutral fallback and do not mutate the registry.
 */
export function resolveOpsStatus(domain, backendValue) {
  const normalizedDomain = domain == null ? '' : String(domain).trim().toLowerCase();
  const normalizedValue = normalizeOpsStatusBackendValue(backendValue);

  if (!normalizedDomain) {
    return unknownStatusFallback('', backendValue);
  }

  const directKey = normalizedValue ? `${normalizedDomain}.${normalizedValue}` : '';
  if (directKey && OPS_STATUS_BY_KEY.has(directKey)) {
    return cloneStatusEntry(OPS_STATUS_BY_KEY.get(directKey));
  }

  const domainAliases = OPS_STATUS_ALIASES[normalizedDomain];
  const aliasedKey = domainAliases && normalizedValue ? domainAliases[normalizedValue] : null;
  if (aliasedKey && OPS_STATUS_BY_KEY.has(aliasedKey)) {
    return cloneStatusEntry(OPS_STATUS_BY_KEY.get(aliasedKey));
  }

  return unknownStatusFallback(normalizedDomain, backendValue);
}
