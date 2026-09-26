'use strict';

const LEGACY_PAID_RECOVERY_CUTOFF = new Date('2026-09-26T12:59:26.570Z');
const LEGACY_PAID_RECOVERY_FIX_COMMIT =
  'b5cd5dd258aaa5de1c075dfe6e017dfdeff8a0a4';
const LEGAL_CONSENT_EVIDENCE_MISSING =
  'missing_due_to_checkout_incident';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isCompleteGuestIdentity(guestInfo) {
  return Boolean(
    guestInfo &&
    String(guestInfo.firstName || '').trim() &&
    String(guestInfo.lastName || '').trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(guestInfo.email || '').trim()) &&
    String(guestInfo.phone || '').trim()
  );
}

function getAuthorizedLegacyPaidRecovery(session, paymentIntentId) {
  const recovery = session?.legacyPaidRecovery;
  if (
    !session ||
    !recovery ||
    session.flowVersion !== 'v2' ||
    session.paymentStatus !== 'paid' ||
    session.finalizeIntent ||
    session.finalizeIntentHash ||
    session.resourceLease ||
    !session.createdAt ||
    new Date(session.createdAt) >= LEGACY_PAID_RECOVERY_CUTOFF
  ) {
    return null;
  }

  const piCreatedAt = Number(recovery.paymentIntentCreatedAt) * 1000;
  const approvedAt = new Date(recovery.approvedAt);
  const guestInfo = recovery.guestIdentitySnapshot;
  if (
    recovery.status !== 'approved' ||
    recovery.legalConsentEvidenceStatus !== LEGAL_CONSENT_EVIDENCE_MISSING ||
    recovery.provenance !== 'paid_checkout_incident_recovery' ||
    recovery.guestIdentityEvidenceSource !== 'stripe_charge_billing_details' ||
    recovery.checkoutId !== String(session.checkoutId) ||
    recovery.paymentIntentId !== String(paymentIntentId || session.canonicalPaymentIntentId) ||
    recovery.paymentIntentId !== String(session.canonicalPaymentIntentId || '') ||
    recovery.quoteSnapshotHash !== String(session.quoteSnapshotHash || '') ||
    !recovery.quoteSnapshotHash ||
    recovery.defectFixCommit !== LEGACY_PAID_RECOVERY_FIX_COMMIT ||
    !recovery.recoveryExecutionId ||
    !/^ops:[A-Za-z0-9._-]{1,64}$/.test(String(recovery.operatorActorId || '')) ||
    Number.isNaN(approvedAt.getTime()) ||
    !Number.isFinite(piCreatedAt) ||
    piCreatedAt >= LEGACY_PAID_RECOVERY_CUTOFF.getTime() ||
    !recovery.stripeChargeId ||
    !isCompleteGuestIdentity(guestInfo) ||
    normalizeEmail(guestInfo.email) !== normalizeEmail(session.guestEmail)
  ) {
    return null;
  }

  return recovery;
}

module.exports = {
  LEGACY_PAID_RECOVERY_CUTOFF,
  LEGACY_PAID_RECOVERY_FIX_COMMIT,
  LEGAL_CONSENT_EVIDENCE_MISSING,
  getAuthorizedLegacyPaidRecovery,
  isCompleteGuestIdentity,
  normalizeEmail
};
