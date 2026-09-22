/**
 * Split-payment choice + future-charge consent (SP5).
 *
 * Choice is explicit (default full). Consent protocol is server-owned
 * version/hash — display text is evidence only.
 */
'use strict';

const crypto = require('crypto');
const { stableStringify } = require('./checkout/checkoutSessionSnapshot');
const { CheckoutSessionError, CHECKOUT_SESSION_ERROR_CODES } = require('./checkout/checkoutSessionErrors');

const PAYMENT_CHOICES = Object.freeze(['full', 'split']);
const FUTURE_CHARGE_CONSENT_VERSION = 1;
const FUTURE_CHARGE_CONSENT_COPY_VERSION = 1;

class SplitPaymentChoiceError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'SplitPaymentChoiceError';
    this.code = code;
    this.details = details;
  }
}

function toCheckoutSessionError(err) {
  if (err instanceof CheckoutSessionError) return err;
  if (err instanceof SplitPaymentChoiceError) {
    const map = {
      INVALID_PAYMENT_CHOICE: CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_INVALID,
      SPLIT_OFFER_REQUIRED: CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_INVALID,
      SPLIT_OFFER_HASH_MISMATCH: CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_HASH_MISMATCH,
      FUTURE_CHARGE_CONSENT_REQUIRED: CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_INVALID,
      FUTURE_CHARGE_CONSENT_INVALID: CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_INVALID,
      SESSION_VERSION_CONFLICT: CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_SESSION_VERSION_CONFLICT
    };
    return new CheckoutSessionError(
      map[err.code] || CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE,
      err.message,
      { ...(err.details || {}), splitPaymentChoiceCode: err.code }
    );
  }
  return err;
}

function buildFutureChargeConsentCanonicalPayload({
  consentVersion = FUTURE_CHARGE_CONSENT_VERSION,
  offerSnapshot,
  offerSnapshotHash
}) {
  if (!offerSnapshot || !offerSnapshotHash) {
    throw new SplitPaymentChoiceError(
      'SPLIT_OFFER_REQUIRED',
      'Split offer is required to build future-charge consent'
    );
  }
  return {
    consentVersion: Number(consentVersion),
    copyVersion: FUTURE_CHARGE_CONSENT_COPY_VERSION,
    purpose: 'future_off_session_installment_charges',
    offerSnapshotHash: String(offerSnapshotHash),
    templateCode: offerSnapshot.templateCode,
    templateVersion: offerSnapshot.templateVersion,
    totalCents: offerSnapshot.totalCents,
    currency: offerSnapshot.currency,
    installments: (offerSnapshot.installments || []).map((row) => ({
      sequence: row.sequence,
      amountCents: row.amountCents,
      dueAtDateOnly: row.dueAtDateOnly,
      cancellationTreatment: row.cancellationTreatment
    }))
  };
}

function hashFutureChargeConsent(canonicalPayload) {
  return crypto.createHash('sha256').update(stableStringify(canonicalPayload), 'utf8').digest('hex');
}

function buildFutureChargeConsentContract(offerSnapshot, offerSnapshotHash) {
  const canonical = buildFutureChargeConsentCanonicalPayload({
    offerSnapshot,
    offerSnapshotHash
  });
  return {
    consentVersion: FUTURE_CHARGE_CONSENT_VERSION,
    consentHash: hashFutureChargeConsent(canonical),
    canonical
  };
}

function buildStayCreditProtectionText(offerSnapshot, locale = 'en') {
  void locale;
  if (!offerSnapshot || !Array.isArray(offerSnapshot.installments) || !offerSnapshot.installments.length) {
    return 'Reserve today. Your reservation payment is protected as future stay credit if your plans change within the cancellation window.';
  }
  const first = offerSnapshot.installments[0];
  const total = Number(offerSnapshot.totalCents) || 0;
  let shareLabel;
  if (total > 0 && Number.isInteger(first.amountCents)) {
    const bps = Math.round((first.amountCents * 10000) / total);
    if (bps % 100 === 0) {
      shareLabel = `${bps / 100}%`;
    } else {
      shareLabel = `€${(first.amountCents / 100).toFixed(2)}`;
    }
  } else {
    shareLabel = 'a portion';
  }
  return `Reserve with ${shareLabel} today. Your reservation payment is protected as future stay credit if your plans change within the cancellation window.`;
}

function buildFutureChargeConsentDisplayedText(offerSnapshot, locale = 'en') {
  const protection = buildStayCreditProtectionText(offerSnapshot, locale);
  const lines = [
    protection,
    'By continuing, you authorize Drift & Dwells to automatically charge your saved payment method for the remaining scheduled installment(s) on the date(s) shown.'
  ];
  const future = (offerSnapshot.installments || []).filter((i) => i.sequence > 1);
  for (const inst of future) {
    const euros = (Number(inst.amountCents) / 100).toFixed(2);
    lines.push(`Scheduled charge: €${euros} on ${inst.dueAtDateOnly}.`);
  }
  return lines.join(' ');
}

function getPaymentChoice(session) {
  const raw = session && session.paymentChoice;
  if (!raw || !raw.choice) return 'full';
  return raw.choice === 'split' ? 'split' : 'full';
}

function resolveExpectedChargeCents(session) {
  const full = Math.max(0, Number(session?.stripeAmountCents) || 0);
  if (getPaymentChoice(session) !== 'split') {
    return full;
  }
  const offer = session.splitPaymentOfferSnapshot;
  const first = offer && Array.isArray(offer.installments) ? offer.installments[0] : null;
  const amount = first && Number.isInteger(first.amountCents) ? first.amountCents : null;
  if (amount == null || amount < 1) {
    throw new SplitPaymentChoiceError(
      'SPLIT_OFFER_REQUIRED',
      'Split payment choice requires a valid frozen first installment amount'
    );
  }
  return amount;
}

function buildPaymentIdentityKey(session) {
  if (getPaymentChoice(session) !== 'split') {
    return 'full';
  }
  const hash = String(session.splitPaymentOfferSnapshotHash || '').trim();
  if (!hash) {
    throw new SplitPaymentChoiceError(
      'SPLIT_OFFER_REQUIRED',
      'Split payment requires splitPaymentOfferSnapshotHash'
    );
  }
  return `split:${hash}`;
}

function assertSplitConsentOnSession(session) {
  const offer = session.splitPaymentOfferSnapshot;
  const offerHash = session.splitPaymentOfferSnapshotHash;
  if (!offer || !offerHash) {
    throw new SplitPaymentChoiceError(
      'SPLIT_OFFER_REQUIRED',
      'Split payment requires a valid splitPaymentOfferSnapshot'
    );
  }
  const choice = session.paymentChoice;
  if (!choice || choice.choice !== 'split') {
    throw new SplitPaymentChoiceError(
      'INVALID_PAYMENT_CHOICE',
      'Session payment choice is not split'
    );
  }
  if (String(choice.splitOfferSnapshotHash || '') !== String(offerHash)) {
    throw new SplitPaymentChoiceError(
      'SPLIT_OFFER_HASH_MISMATCH',
      'Payment choice offer hash does not match session offer hash'
    );
  }
  const consent = session.futureChargeConsent;
  if (!consent || !consent.consentHash || !consent.consentVersion) {
    throw new SplitPaymentChoiceError(
      'FUTURE_CHARGE_CONSENT_REQUIRED',
      'Future-charge consent is required for split payment'
    );
  }
  const expected = buildFutureChargeConsentContract(offer, offerHash);
  if (Number(consent.consentVersion) !== expected.consentVersion) {
    throw new SplitPaymentChoiceError(
      'FUTURE_CHARGE_CONSENT_INVALID',
      'Future-charge consent version mismatch'
    );
  }
  if (String(consent.consentHash) !== expected.consentHash) {
    throw new SplitPaymentChoiceError(
      'FUTURE_CHARGE_CONSENT_INVALID',
      'Future-charge consent hash mismatch'
    );
  }
  if (typeof consent.displayedText !== 'string' || !consent.displayedText.trim()) {
    throw new SplitPaymentChoiceError(
      'FUTURE_CHARGE_CONSENT_INVALID',
      'Future-charge consent displayedText evidence is required'
    );
  }
  // Evidence must match server-issued copy for the accepted locale (never client-forged).
  const locale =
    typeof consent.acceptedLocale === 'string' && consent.acceptedLocale.trim()
      ? consent.acceptedLocale.trim().slice(0, 32)
      : 'en';
  const serverText = buildFutureChargeConsentDisplayedText(offer, locale);
  if (String(consent.displayedText).trim() !== serverText) {
    throw new SplitPaymentChoiceError(
      'FUTURE_CHARGE_CONSENT_INVALID',
      'Future-charge consent displayedText does not match server-issued contract'
    );
  }
  return expected;
}

async function setCheckoutPaymentChoice({
  session,
  choice,
  splitOfferSnapshotHash = null,
  consent = null,
  expectedSessionVersion = null,
  save = true
}) {
  const wanted = choice == null || choice === '' ? 'full' : String(choice).trim().toLowerCase();
  if (!PAYMENT_CHOICES.includes(wanted)) {
    throw new SplitPaymentChoiceError(
      'INVALID_PAYMENT_CHOICE',
      'paymentChoice must be full or split'
    );
  }

  if (expectedSessionVersion != null && expectedSessionVersion !== '') {
    const expected = Number(expectedSessionVersion);
    const current = Number(session.sessionVersion || 1);
    if (!Number.isInteger(expected) || expected !== current) {
      throw new SplitPaymentChoiceError(
        'SESSION_VERSION_CONFLICT',
        'expectedSessionVersion does not match checkout session',
        { expectedSessionVersion: expected, sessionVersion: current }
      );
    }
  }

  if (wanted === 'full') {
    session.paymentChoice = {
      choice: 'full',
      splitOfferSnapshotHash: null,
      selectedAt: new Date(),
      sessionVersionAtSelection: Number(session.sessionVersion || 1)
    };
    session.futureChargeConsent = null;
    if (save) await session.save();
    return {
      choice: 'full',
      chargeAmountCents: resolveExpectedChargeCents(session),
      consent: null
    };
  }

  const offer = session.splitPaymentOfferSnapshot;
  const offerHash = session.splitPaymentOfferSnapshotHash;
  if (!offer || !offerHash) {
    throw new SplitPaymentChoiceError(
      'SPLIT_OFFER_REQUIRED',
      'Split payment is not available for this checkout'
    );
  }
  const clientHash =
    splitOfferSnapshotHash != null && String(splitOfferSnapshotHash).trim() !== ''
      ? String(splitOfferSnapshotHash).trim()
      : null;
  if (clientHash && clientHash !== String(offerHash)) {
    throw new SplitPaymentChoiceError(
      'SPLIT_OFFER_HASH_MISMATCH',
      'splitOfferSnapshotHash does not match the current offer'
    );
  }

  if (!consent || typeof consent !== 'object') {
    throw new SplitPaymentChoiceError(
      'FUTURE_CHARGE_CONSENT_REQUIRED',
      'Future-charge consent is required to select split payment'
    );
  }

  const expected = buildFutureChargeConsentContract(offer, offerHash);
  const clientVersion = Number(consent.consentVersion);
  const clientHashConsent = consent.consentHash != null ? String(consent.consentHash).trim() : '';
  if (clientVersion !== expected.consentVersion || clientHashConsent !== expected.consentHash) {
    throw new SplitPaymentChoiceError(
      'FUTURE_CHARGE_CONSENT_INVALID',
      'Future-charge consent version/hash is invalid',
      {
        expectedConsentVersion: expected.consentVersion,
        expectedConsentHash: expected.consentHash
      }
    );
  }

  // Server owns displayedText evidence — never persist arbitrary client text.
  const acceptedLocale =
    typeof consent.acceptedLocale === 'string' && consent.acceptedLocale.trim()
      ? consent.acceptedLocale.trim().slice(0, 32)
      : 'en';
  const displayedText = buildFutureChargeConsentDisplayedText(offer, acceptedLocale);
  const clientAcceptedAt =
    consent.acceptedAt != null ? new Date(consent.acceptedAt) : null;
  const acceptedAt =
    clientAcceptedAt && !Number.isNaN(clientAcceptedAt.getTime())
      ? clientAcceptedAt
      : new Date();

  session.paymentChoice = {
    choice: 'split',
    splitOfferSnapshotHash: String(offerHash),
    selectedAt: new Date(),
    sessionVersionAtSelection: Number(session.sessionVersion || 1)
  };
  session.futureChargeConsent = {
    consentVersion: expected.consentVersion,
    consentHash: expected.consentHash,
    acceptedAt,
    acceptedLocale,
    displayedText
  };

  assertSplitConsentOnSession(session);

  if (save) await session.save();
  return {
    choice: 'split',
    chargeAmountCents: resolveExpectedChargeCents(session),
    consent: {
      consentVersion: expected.consentVersion,
      consentHash: expected.consentHash
    }
  };
}

function formatPublicSplitOffer(session) {
  const offer = session && session.splitPaymentOfferSnapshot;
  const hash = session && session.splitPaymentOfferSnapshotHash;
  if (!offer || !hash) return null;
  const contract = buildFutureChargeConsentContract(offer, hash);
  return {
    offerSnapshotHash: hash,
    schemaVersion: offer.schemaVersion,
    templateCode: offer.templateCode,
    templateVersion: offer.templateVersion,
    scheduleKind: offer.scheduleKind,
    currency: offer.currency,
    totalCents: offer.totalCents,
    bookingDateOnly: offer.bookingDateOnly,
    arrivalDateOnly: offer.arrivalDateOnly,
    installments: (offer.installments || []).map((row) => ({
      sequence: row.sequence,
      amountCents: row.amountCents,
      amountType: row.amountType,
      dueRule: row.dueRule,
      dueOffsetDays: row.dueOffsetDays,
      dueAtDateOnly: row.dueAtDateOnly,
      cancellationTreatment: row.cancellationTreatment
    })),
    stayCreditProtectionText: buildStayCreditProtectionText(offer),
    futureChargeConsent: {
      consentVersion: contract.consentVersion,
      consentHash: contract.consentHash,
      copyVersion: FUTURE_CHARGE_CONSENT_COPY_VERSION,
      acceptedLocale: 'en',
      displayedText: buildFutureChargeConsentDisplayedText(offer, 'en')
    }
  };
}

module.exports = {
  PAYMENT_CHOICES,
  FUTURE_CHARGE_CONSENT_VERSION,
  FUTURE_CHARGE_CONSENT_COPY_VERSION,
  SplitPaymentChoiceError,
  toCheckoutSessionError,
  buildFutureChargeConsentCanonicalPayload,
  hashFutureChargeConsent,
  buildFutureChargeConsentContract,
  buildStayCreditProtectionText,
  buildFutureChargeConsentDisplayedText,
  getPaymentChoice,
  resolveExpectedChargeCents,
  buildPaymentIdentityKey,
  assertSplitConsentOnSession,
  setCheckoutPaymentChoice,
  formatPublicSplitOffer
};
