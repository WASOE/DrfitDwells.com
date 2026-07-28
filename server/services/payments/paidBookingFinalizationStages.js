'use strict';

/**
 * Controlled finalization stages for paid-booking failure observability (Batch 1).
 * Do not invent free-form stage strings at call sites — use these constants.
 */
const PAID_BOOKING_FINALIZATION_STAGES = Object.freeze({
  PAYMENT_INGESTED: 'payment_ingested',
  PAYMENT_VERIFIED: 'payment_verified',
  FINALIZE_PRECHECK: 'finalize_precheck',
  FINALIZE_LOCK: 'finalize_lock',
  COMMERCIAL_STAY_GUARD: 'commercial_stay_guard',
  UNIT_ASSIGNMENT: 'unit_assignment',
  BOOKING_BUILD: 'booking_build',
  BOOKING_SAVE: 'booking_save',
  OVERLAP_CHECK: 'overlap_check',
  PAYMENT_LINK: 'payment_link',
  STRIPE_METADATA_PATCH: 'stripe_metadata_patch',
  SESSION_FINALIZE: 'session_finalize',
  SAVED_QUOTE_CONVERSION: 'saved_quote_conversion',
  CONFIRMATION_SIDE_EFFECT: 'confirmation_side_effect',
  VOUCHER_CONFIRM: 'voucher_confirm',
  UNKNOWN: 'unknown'
});

const PAID_BOOKING_FINALIZATION_STAGE_SET = new Set(
  Object.values(PAID_BOOKING_FINALIZATION_STAGES)
);

function normalizeFinalizationStage(stage) {
  const value = stage != null ? String(stage).trim() : '';
  if (PAID_BOOKING_FINALIZATION_STAGE_SET.has(value)) {
    return value;
  }
  return PAID_BOOKING_FINALIZATION_STAGES.UNKNOWN;
}

module.exports = {
  PAID_BOOKING_FINALIZATION_STAGES,
  PAID_BOOKING_FINALIZATION_STAGE_SET,
  normalizeFinalizationStage
};
