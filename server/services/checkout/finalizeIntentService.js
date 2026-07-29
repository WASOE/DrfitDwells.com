'use strict';

/**
 * Batch 2 — FinalizeIntent persistence, canonical hash, PI metadata sync.
 * Binding: docs/checkout-payment-architecture/02_PAID_BOOKING_FINALIZATION_IMPLEMENTATION_SPEC.md §B
 *
 * Non-goals: no worker, no webhook booking creation, no paymentStatus=paid writer.
 */

const crypto = require('crypto');
const validator = require('validator');
const CheckoutSession = require('../../models/CheckoutSession');
const featureFlags = require('../../utils/featureFlags');
const { normalizeReferralCode } = require('../../models/CreatorPartner');
const { sanitizeMetaClientContext } = require('../../utils/sanitizeMetaClientContext');
const {
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
} = require('../../config/legalAcceptance');
const { stableStringify } = require('./checkoutSessionSnapshot');
const {
  CheckoutSessionError,
  CHECKOUT_SESSION_ERROR_CODES
} = require('./checkoutSessionErrors');
const {
  loadSessionOrThrow,
  assertSessionUsable
} = require('./checkoutSessionService');

const FINALIZE_INTENT_SCHEMA_VERSION = 1;

const IMMUTABLE_PI_STATUSES = new Set(['processing', 'succeeded']);

const MUTABLE_PI_STATUSES = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'requires_capture'
]);

function isFinalizeIntentPersistEnabled() {
  return featureFlags.isFinalizeIntentPersistEnabled();
}

function isFinalizeIntentRequiredForPiEnabled() {
  return featureFlags.isFinalizeIntentRequiredForPiEnabled();
}

function clipString(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function normalizeWhitespace(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const normalized = validator.normalizeEmail(trimmed, {
    gmail_remove_dots: false,
    gmail_remove_subaddress: false,
    outlookdotcom_remove_subaddress: false,
    yahoo_remove_subaddress: false,
    icloud_remove_subaddress: false
  });
  return normalized || trimmed;
}

function parseAttributionCapturedAt(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function deriveAttributionSource(attribution) {
  if (!attribution) return 'direct';
  if (attribution.referralCode) return 'creator_referral';
  const hasUtm = Boolean(
    attribution.utmSource ||
      attribution.utmMedium ||
      attribution.utmCampaign ||
      attribution.utmTerm ||
      attribution.utmContent
  );
  if (hasUtm) return 'utm';
  const hasPaidClickId = Boolean(
    attribution.gclid ||
      attribution.gbraid ||
      attribution.wbraid ||
      attribution.fbclid ||
      attribution.msclkid
  );
  if (hasPaidClickId) return 'paid_click';
  const hasAnySignal = Boolean(attribution.referrer || attribution.landingPath);
  if (!hasAnySignal) return 'direct';
  return 'unknown';
}

/** Mirrors bookingRoutes.sanitizeAttribution field-size conventions. */
function sanitizeAttribution(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const clip = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null);
  const referralCode = normalizeReferralCode(raw.referralCode);
  const attributionCapturedAt = parseAttributionCapturedAt(raw.attributionCapturedAt);
  const o = {
    referralCode,
    utmSource: clip(raw.utmSource),
    utmMedium: clip(raw.utmMedium),
    utmCampaign: clip(raw.utmCampaign),
    utmTerm: clip(raw.utmTerm),
    utmContent: clip(raw.utmContent),
    gclid: clip(raw.gclid),
    gbraid: clip(raw.gbraid),
    wbraid: clip(raw.wbraid),
    fbclid: clip(raw.fbclid),
    msclkid: clip(raw.msclkid),
    referrer: clip(raw.referrer),
    landingPath: clip(raw.landingPath),
    attributionCapturedAt
  };
  if (!Object.values(o).some(Boolean)) return null;
  o.attributionSource = deriveAttributionSource(o);
  return o;
}

function normalizeTransportMethod(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 50);
  if (!trimmed || trimmed === 'Not selected') return null;
  return trimmed;
}

function normalizeExperienceKeys(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const unique = [
    ...new Set(
      list
        .map((k) => (typeof k === 'string' ? k.trim() : ''))
        .filter(Boolean)
    )
  ].sort();
  return unique;
}

function experienceKeysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function validationError(message, details = null) {
  return new CheckoutSessionError(
    CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_INVALID,
    message,
    details
  );
}

/**
 * Build server-owned requestMeta from the live HTTP request.
 * Never trust client-supplied IP / UA / accept-language / capturedAt / hash / legal snapshots for ownership.
 */
function buildRequestMetaFromReq(req) {
  return {
    ip: clipString(String(req?.ip || ''), 100),
    userAgent: clipString(String(req?.get?.('user-agent') || req?.headers?.['user-agent'] || ''), 500),
    acceptLanguage: clipString(
      typeof req?.get === 'function'
        ? req.get('accept-language')
        : req?.headers?.['accept-language'],
      200
    )
  };
}

/**
 * Validate client-supplied finalize fields and assemble the stored finalizeIntent.
 * Server owns: schemaVersion, capturedAt, requestMeta, legal text/version equality checks.
 */
function buildValidatedFinalizeIntent({ body, requestMeta, capturedAt, quoteSnapshot }) {
  if (!body || typeof body !== 'object') {
    throw validationError('finalizeIntent body is required');
  }

  const guestRaw = body.guestInfo;
  if (!guestRaw || typeof guestRaw !== 'object') {
    throw validationError('guestInfo is required');
  }

  const firstName = normalizeWhitespace(guestRaw.firstName || '').slice(0, 50);
  const lastName = normalizeWhitespace(guestRaw.lastName || '').slice(0, 50);
  const email = normalizeEmail(guestRaw.email);
  const phone = normalizeWhitespace(guestRaw.phone || '').slice(0, 40);

  if (!firstName || firstName.length < 1) {
    throw validationError('guestInfo.firstName is required', { field: 'guestInfo.firstName' });
  }
  if (!lastName || lastName.length < 1) {
    throw validationError('guestInfo.lastName is required', { field: 'guestInfo.lastName' });
  }
  if (!email || !validator.isEmail(email)) {
    throw validationError('guestInfo.email is invalid', { field: 'guestInfo.email' });
  }
  if (!phone || phone.length < 1) {
    throw validationError('guestInfo.phone is required', { field: 'guestInfo.phone' });
  }

  let specialRequests = null;
  if (body.specialRequests != null && body.specialRequests !== '') {
    if (typeof body.specialRequests !== 'string') {
      throw validationError('specialRequests must be a string');
    }
    specialRequests = body.specialRequests.trim().slice(0, 500) || null;
  }

  const legal = body.legalAcceptance;
  if (!legal || typeof legal !== 'object') {
    throw validationError('legalAcceptance is required');
  }
  if (legal.acceptedTermsAndCancellation !== true) {
    throw validationError('legalAcceptance.acceptedTermsAndCancellation must be true');
  }
  if (legal.acceptedActivityRisk !== true) {
    throw validationError('legalAcceptance.acceptedActivityRisk must be true');
  }
  if (legal.termsVersion !== LEGAL_ACCEPTANCE_TERMS_VERSION) {
    throw validationError('legalAcceptance.termsVersion mismatch', {
      field: 'legalAcceptance.termsVersion'
    });
  }
  if (legal.activityRiskVersion !== LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION) {
    throw validationError('legalAcceptance.activityRiskVersion mismatch', {
      field: 'legalAcceptance.activityRiskVersion'
    });
  }
  if (legal.checkbox1TextSnapshot !== LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT) {
    throw validationError('legalAcceptance.checkbox1TextSnapshot mismatch', {
      field: 'legalAcceptance.checkbox1TextSnapshot'
    });
  }
  if (legal.checkbox2TextSnapshot !== LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT) {
    throw validationError('legalAcceptance.checkbox2TextSnapshot mismatch', {
      field: 'legalAcceptance.checkbox2TextSnapshot'
    });
  }

  const locale =
    typeof legal.locale === 'string' && legal.locale.trim()
      ? legal.locale.trim().slice(0, 50)
      : null;

  const experienceKeys = normalizeExperienceKeys(body.experienceKeys);
  const snapshotKeys = normalizeExperienceKeys(quoteSnapshot?.experienceKeys || []);
  if (!experienceKeysEqual(experienceKeys, snapshotKeys)) {
    throw validationError('experienceKeys must match quoteSnapshot.experienceKeys', {
      field: 'experienceKeys'
    });
  }

  const tripType =
    typeof body.tripType === 'string' && body.tripType.trim()
      ? body.tripType.trim().slice(0, 50)
      : null;
  const customTripType =
    typeof body.customTripType === 'string' && body.customTripType.trim()
      ? body.customTripType.trim().slice(0, 100)
      : null;

  const transportMethod = normalizeTransportMethod(body.transportMethod);
  const romanticSetup = Boolean(body.romanticSetup);

  const consents = normalizeOptionalAccommodationConsents({
    consents: body.consents,
    quoteDeliveryRequested: body.quoteDeliveryRequested,
    bookingReminderConsent: body.bookingReminderConsent,
    marketingConsent: body.marketingConsent
  });

  const attribution = sanitizeAttribution(body.attribution);
  const metaClientContext = sanitizeMetaClientContext(body.metaClientContext) || null;

  const captured =
    capturedAt instanceof Date && !Number.isNaN(capturedAt.getTime())
      ? capturedAt
      : new Date();

  const intent = {
    schemaVersion: FINALIZE_INTENT_SCHEMA_VERSION,
    capturedAt: captured,
    guestInfo: {
      firstName,
      lastName,
      email,
      phone
    },
    specialRequests,
    legalAcceptance: {
      acceptedTermsAndCancellation: true,
      acceptedActivityRisk: true,
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
      locale
    },
    requestMeta: {
      ip: requestMeta?.ip ?? null,
      userAgent: requestMeta?.userAgent ?? null,
      acceptLanguage: requestMeta?.acceptLanguage ?? null
    },
    tripType,
    customTripType,
    transportMethod,
    romanticSetup,
    consents,
    attribution,
    metaClientContext,
    experienceKeys
  };

  return intent;
}

/**
 * Hash payload (binding §B.3):
 * includes capturedAt ISO; excludes metaClientContext.
 */
function buildFinalizeIntentHashPayload(intent) {
  const capturedAt =
    intent.capturedAt instanceof Date
      ? intent.capturedAt.toISOString()
      : new Date(intent.capturedAt).toISOString();

  let attribution = intent.attribution || null;
  if (attribution && attribution.attributionCapturedAt instanceof Date) {
    attribution = {
      ...attribution,
      attributionCapturedAt: attribution.attributionCapturedAt.toISOString()
    };
  } else if (attribution?.attributionCapturedAt) {
    attribution = {
      ...attribution,
      attributionCapturedAt: new Date(attribution.attributionCapturedAt).toISOString()
    };
  }

  return {
    schemaVersion: intent.schemaVersion,
    capturedAt,
    guestInfo: intent.guestInfo,
    specialRequests: intent.specialRequests ?? null,
    legalAcceptance: intent.legalAcceptance,
    requestMeta: {
      ip: intent.requestMeta?.ip ?? null,
      userAgent: intent.requestMeta?.userAgent ?? null,
      acceptLanguage: intent.requestMeta?.acceptLanguage ?? null
    },
    tripType: intent.tripType ?? null,
    customTripType: intent.customTripType ?? null,
    transportMethod: intent.transportMethod ?? null,
    romanticSetup: Boolean(intent.romanticSetup),
    consents: {
      quoteDeliveryRequested: Boolean(intent.consents?.quoteDeliveryRequested),
      bookingReminderConsent: Boolean(intent.consents?.bookingReminderConsent),
      marketingConsent: Boolean(intent.consents?.marketingConsent)
    },
    attribution,
    experienceKeys: Array.isArray(intent.experienceKeys) ? [...intent.experienceKeys] : []
  };
}

function hashFinalizeIntent(intent) {
  const payload = buildFinalizeIntentHashPayload(intent);
  return crypto.createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex');
}

/** Material equality for idempotent retries (excludes capturedAt + metaClientContext). */
function buildMaterialComparePayload(intent) {
  const full = buildFinalizeIntentHashPayload(intent);
  const { capturedAt: _ignored, ...rest } = full;
  return rest;
}

function materialFinalizeIntentEqual(a, b) {
  if (!a || !b) return false;
  return stableStringify(buildMaterialComparePayload(a)) === stableStringify(buildMaterialComparePayload(b));
}

function sessionHasCompleteFinalizeIntent(session) {
  if (!session?.finalizeIntent || !session?.finalizeIntentHash) return false;
  try {
    const recomputed = hashFinalizeIntent(session.finalizeIntent);
    return recomputed === session.finalizeIntentHash;
  } catch {
    return false;
  }
}

/**
 * True when the payment-preparation request carries enough fields to build finalizeIntent.
 */
function paymentRequestHasFinalizeIntentPayload(body) {
  if (!body || typeof body !== 'object') return false;
  const guest = body.guestInfo;
  const legal = body.legalAcceptance;
  return Boolean(guest && typeof guest === 'object' && legal && typeof legal === 'object');
}

/**
 * Normalize optional accommodation consents for new finalize intents.
 * Absent/invalid values become false; never coerced to true from non-boolean truthy junk.
 */
function normalizeOptionalAccommodationConsents(body = {}) {
  const consentsRaw = body.consents && typeof body.consents === 'object' ? body.consents : body;
  const asExplicitTrue = (value) => value === true;
  return {
    quoteDeliveryRequested: asExplicitTrue(
      consentsRaw.quoteDeliveryRequested ?? body.quoteDeliveryRequested
    ),
    bookingReminderConsent: asExplicitTrue(
      consentsRaw.bookingReminderConsent ?? body.bookingReminderConsent
    ),
    marketingConsent: asExplicitTrue(consentsRaw.marketingConsent ?? body.marketingConsent)
  };
}

function assertFinalizeIntentAvailableForPi(session) {
  if (!isFinalizeIntentRequiredForPiEnabled()) {
    return { ok: true, required: false };
  }
  if (!sessionHasCompleteFinalizeIntent(session)) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_REQUIRED,
      'finalizeIntent is required before creating a payable PaymentIntent',
      { checkoutId: session?.checkoutId || null }
    );
  }
  return { ok: true, required: true };
}

/**
 * Server-owned orchestration: ensure CheckoutSession has a complete finalizeIntent
 * before a payable PaymentIntent is created/reused. Uses existing persistFinalizeIntent.
 *
 * - Reuses an existing matching intent.
 * - Persists from payment-request payload when missing.
 * - Rejects material conflicts with an immutable existing intent.
 */
async function ensureFinalizeIntentForPaymentPreparation({
  session,
  body,
  requestMeta,
  expectedSessionVersion = null,
  stripe = null
} = {}) {
  const required = isFinalizeIntentRequiredForPiEnabled();
  const persistEnabled = isFinalizeIntentPersistEnabled();
  const hasPayload = paymentRequestHasFinalizeIntentPayload(body);

  if (sessionHasCompleteFinalizeIntent(session)) {
    if (hasPayload) {
      const candidate = buildValidatedFinalizeIntent({
        body,
        requestMeta: session.finalizeIntent.requestMeta || {
          ip: null,
          userAgent: null,
          acceptLanguage: null
        },
        capturedAt: session.finalizeIntentCapturedAt || session.finalizeIntent.capturedAt || new Date(),
        quoteSnapshot: session.quoteSnapshot
      });
      // Preserve server-owned meta on the stored intent for material comparison.
      candidate.requestMeta = session.finalizeIntent.requestMeta;
      if (!materialFinalizeIntentEqual(session.finalizeIntent, candidate)) {
        throw new CheckoutSessionError(
          CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_IMMUTABLE,
          'Submitted finalizeIntent conflicts with the persisted intent for this checkout',
          { checkoutId: session.checkoutId }
        );
      }
    }
    return {
      session,
      reused: true,
      persisted: false,
      finalizeIntentHash: session.finalizeIntentHash
    };
  }

  if (!required && !persistEnabled) {
    return { session, reused: false, persisted: false, skipped: true };
  }

  if (!hasPayload) {
    if (required) {
      throw new CheckoutSessionError(
        CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_REQUIRED,
        'finalizeIntent is required before creating a payable PaymentIntent',
        { checkoutId: session?.checkoutId || null }
      );
    }
    return { session, reused: false, persisted: false, skipped: true };
  }

  if (!persistEnabled && required) {
    // Strict PI requirement still needs persistence capability.
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_PERSIST_DISABLED,
      'Finalize intent persistence is disabled'
    );
  }

  const persistBody = {
    ...body,
    consents: normalizeOptionalAccommodationConsents(body)
  };

  try {
    const result = await persistFinalizeIntent({
      checkoutId: session.checkoutId,
      body: persistBody,
      requestMeta,
      expectedSessionVersion:
        expectedSessionVersion != null
          ? expectedSessionVersion
          : body?.expectedSessionVersion ?? body?.sessionVersion ?? null,
      stripe
    });

    const refreshed = await loadSessionOrThrow(session.checkoutId);
    return {
      session: refreshed,
      reused: Boolean(result.idempotentReplay),
      persisted: true,
      finalizeIntentHash: result.finalizeIntentHash,
      sessionVersion: result.sessionVersion,
      metadataSync: result.metadataSync || null
    };
  } catch (err) {
    // Concurrent identical preparation: peer won the persist race.
    if (err?.code === CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_SESSION_VERSION_CONFLICT) {
      const refreshed = await loadSessionOrThrow(session.checkoutId);
      if (sessionHasCompleteFinalizeIntent(refreshed)) {
        if (hasPayload) {
          const candidate = buildValidatedFinalizeIntent({
            body,
            requestMeta: refreshed.finalizeIntent.requestMeta || {
              ip: null,
              userAgent: null,
              acceptLanguage: null
            },
            capturedAt:
              refreshed.finalizeIntentCapturedAt ||
              refreshed.finalizeIntent.capturedAt ||
              new Date(),
            quoteSnapshot: refreshed.quoteSnapshot
          });
          candidate.requestMeta = refreshed.finalizeIntent.requestMeta;
          if (!materialFinalizeIntentEqual(refreshed.finalizeIntent, candidate)) {
            throw err;
          }
        }
        return {
          session: refreshed,
          reused: true,
          persisted: false,
          finalizeIntentHash: refreshed.finalizeIntentHash,
          concurrentPersistResolved: true
        };
      }
    }
    throw err;
  }
}

async function retrieveCanonicalPiStatus(stripe, paymentIntentId) {
  if (!paymentIntentId || !stripe?.paymentIntents?.retrieve) {
    return { status: null, pi: null };
  }
  try {
    const pi = await stripe.paymentIntents.retrieve(String(paymentIntentId));
    return { status: pi?.status || null, pi };
  } catch {
    return { status: null, pi: null };
  }
}

/**
 * Update Stripe PI metadata finalizeIntentHash when PI is still mutable (requires_*).
 * Does not create a new PaymentIntent.
 */
async function syncFinalizeIntentHashToPaymentIntent({ stripe, session, finalizeIntentHash }) {
  const paymentIntentId = session?.canonicalPaymentIntentId;
  if (!paymentIntentId) {
    return { synced: false, reason: 'no_canonical_pi' };
  }
  if (!stripe?.paymentIntents?.retrieve) {
    return { synced: false, reason: 'no_stripe' };
  }

  const { status, pi } = await retrieveCanonicalPiStatus(stripe, paymentIntentId);
  if (!pi) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_METADATA_SYNC_FAILED,
      'Could not retrieve canonical PaymentIntent for finalizeIntentHash sync',
      { paymentIntentId: String(paymentIntentId) }
    );
  }

  if (IMMUTABLE_PI_STATUSES.has(status)) {
    return { synced: false, reason: 'pi_immutable', status };
  }

  if (!MUTABLE_PI_STATUSES.has(status)) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_METADATA_SYNC_FAILED,
      'Canonical PaymentIntent is not in a mutable status for finalizeIntentHash sync',
      { paymentIntentId: String(paymentIntentId), status }
    );
  }

  const currentHash = pi.metadata?.finalizeIntentHash || '';
  const nextHash = finalizeIntentHash || '';
  if (currentHash === nextHash) {
    return { synced: true, reason: 'already_current', status, paymentIntentId: String(paymentIntentId) };
  }

  if (!stripe.paymentIntents.update) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_METADATA_SYNC_FAILED,
      'Stripe paymentIntents.update is unavailable',
      { paymentIntentId: String(paymentIntentId) }
    );
  }

  try {
    await stripe.paymentIntents.update(String(paymentIntentId), {
      metadata: {
        ...(pi.metadata || {}),
        checkoutId: session.checkoutId,
        quoteSnapshotHash: session.quoteSnapshotHash || '',
        flowVersion: session.flowVersion || 'v2',
        finalizeIntentHash: nextHash
      }
    });
    return { synced: true, reason: 'updated', status, paymentIntentId: String(paymentIntentId) };
  } catch (err) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_METADATA_SYNC_FAILED,
      'Failed to update PaymentIntent finalizeIntentHash metadata',
      {
        paymentIntentId: String(paymentIntentId),
        message: err?.message ? String(err.message).slice(0, 200) : null
      }
    );
  }
}

function logFinalizeIntentEvent(event, fields) {
  // Structured only — never log guest/legal/IP/body/client secret
  console.info(
    JSON.stringify({
      event,
      checkoutId: fields.checkoutId || null,
      sessionVersion: fields.sessionVersion ?? null,
      finalizeIntentHash: fields.finalizeIntentHash || null,
      schemaVersion: fields.schemaVersion ?? null,
      resultCode: fields.resultCode || null,
      idempotent: fields.idempotent === true
    })
  );
}

/**
 * Persist finalizeIntent on CheckoutSession before payment confirmation.
 */
async function persistFinalizeIntent({
  checkoutId,
  body,
  requestMeta,
  expectedSessionVersion = null,
  stripe = null
}) {
  if (!isFinalizeIntentPersistEnabled()) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_PERSIST_DISABLED,
      'Finalize intent persistence is disabled'
    );
  }

  const session = await loadSessionOrThrow(checkoutId);
  assertSessionUsable(session);

  if (session.paymentStatus === 'paid' || session.finalizeIntentImmutableAt) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_IMMUTABLE,
      'finalizeIntent is immutable after payment',
      { paymentStatus: session.paymentStatus }
    );
  }

  if (expectedSessionVersion != null && expectedSessionVersion !== '') {
    const expected = Number(expectedSessionVersion);
    if (!Number.isInteger(expected) || expected < 1) {
      throw validationError('expectedSessionVersion is invalid');
    }
    if (Number(session.sessionVersion) !== expected) {
      throw new CheckoutSessionError(
        CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_SESSION_VERSION_CONFLICT,
        'Checkout session version conflict',
        {
          expectedSessionVersion: expected,
          sessionVersion: session.sessionVersion
        }
      );
    }
  }

  if (session.canonicalPaymentIntentId) {
    const { status, pi } = await retrieveCanonicalPiStatus(stripe, session.canonicalPaymentIntentId);
    if (IMMUTABLE_PI_STATUSES.has(status)) {
      if (!session.finalizeIntentImmutableAt) {
        session.finalizeIntentImmutableAt = new Date();
        await session.save();
      }
      throw new CheckoutSessionError(
        CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_IMMUTABLE,
        'finalizeIntent cannot change after PaymentIntent is processing or succeeded',
        { paymentIntentStatus: status, paymentIntentId: pi?.id || session.canonicalPaymentIntentId }
      );
    }
  }

  const capturedAt = new Date();
  const intent = buildValidatedFinalizeIntent({
    body,
    requestMeta,
    capturedAt,
    quoteSnapshot: session.quoteSnapshot
  });

  if (session.finalizeIntent && materialFinalizeIntentEqual(session.finalizeIntent, intent)) {
    const existingHash = session.finalizeIntentHash || hashFinalizeIntent(session.finalizeIntent);
    let metadataSync = { synced: false, reason: 'idempotent_no_change' };
    try {
      metadataSync = await syncFinalizeIntentHashToPaymentIntent({
        stripe,
        session,
        finalizeIntentHash: existingHash
      });
    } catch (err) {
      if (err?.code === CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_METADATA_SYNC_FAILED) {
        logFinalizeIntentEvent('finalize_intent_persist', {
          checkoutId: session.checkoutId,
          sessionVersion: session.sessionVersion,
          finalizeIntentHash: existingHash,
          schemaVersion: session.finalizeIntent.schemaVersion,
          resultCode: 'metadata_sync_failed'
        });
        throw err;
      }
      throw err;
    }

    logFinalizeIntentEvent('finalize_intent_persist', {
      checkoutId: session.checkoutId,
      sessionVersion: session.sessionVersion,
      finalizeIntentHash: existingHash,
      schemaVersion: session.finalizeIntent.schemaVersion,
      resultCode: 'idempotent_replay',
      idempotent: true
    });
    return {
      checkoutId: session.checkoutId,
      finalizeIntentHash: existingHash,
      sessionVersion: session.sessionVersion,
      schemaVersion: session.finalizeIntent.schemaVersion,
      capturedAt: session.finalizeIntentCapturedAt || session.finalizeIntent.capturedAt,
      idempotentReplay: true,
      metadataSync
    };
  }

  const finalizeIntentHash = hashFinalizeIntent(intent);
  const nextVersion = Number(session.sessionVersion || 1) + 1;

  const filter = {
    checkoutId: session.checkoutId,
    paymentStatus: { $ne: 'paid' },
    $or: [
      { finalizeIntentImmutableAt: null },
      { finalizeIntentImmutableAt: { $exists: false } }
    ]
  };
  if (expectedSessionVersion != null && expectedSessionVersion !== '') {
    filter.sessionVersion = Number(expectedSessionVersion);
  } else {
    filter.sessionVersion = session.sessionVersion;
  }

  const updated = await CheckoutSession.findOneAndUpdate(
    filter,
    {
      $set: {
        finalizeIntent: intent,
        finalizeIntentHash,
        finalizeIntentCapturedAt: capturedAt,
        guestEmail: intent.guestInfo.email,
        sessionVersion: nextVersion
      }
    },
    { new: true }
  );

  if (!updated) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_SESSION_VERSION_CONFLICT,
      'Checkout session version conflict while persisting finalizeIntent',
      { checkoutId: session.checkoutId }
    );
  }

  let metadataSync = { synced: false, reason: 'no_canonical_pi' };
  try {
    metadataSync = await syncFinalizeIntentHashToPaymentIntent({
      stripe,
      session: updated,
      finalizeIntentHash
    });
  } catch (err) {
    if (err?.code === CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_METADATA_SYNC_FAILED) {
      logFinalizeIntentEvent('finalize_intent_persist', {
        checkoutId: updated.checkoutId,
        sessionVersion: updated.sessionVersion,
        finalizeIntentHash,
        schemaVersion: intent.schemaVersion,
        resultCode: 'metadata_sync_failed'
      });
      throw err;
    }
    throw err;
  }

  logFinalizeIntentEvent('finalize_intent_persist', {
    checkoutId: updated.checkoutId,
    sessionVersion: updated.sessionVersion,
    finalizeIntentHash,
    schemaVersion: intent.schemaVersion,
    resultCode: 'persisted'
  });

  return {
    checkoutId: updated.checkoutId,
    finalizeIntentHash,
    sessionVersion: updated.sessionVersion,
    schemaVersion: intent.schemaVersion,
    capturedAt: updated.finalizeIntentCapturedAt,
    idempotentReplay: false,
    metadataSync
  };
}

module.exports = {
  FINALIZE_INTENT_SCHEMA_VERSION,
  isFinalizeIntentPersistEnabled,
  isFinalizeIntentRequiredForPiEnabled,
  buildRequestMetaFromReq,
  buildValidatedFinalizeIntent,
  buildFinalizeIntentHashPayload,
  hashFinalizeIntent,
  materialFinalizeIntentEqual,
  sessionHasCompleteFinalizeIntent,
  paymentRequestHasFinalizeIntentPayload,
  normalizeOptionalAccommodationConsents,
  assertFinalizeIntentAvailableForPi,
  ensureFinalizeIntentForPaymentPreparation,
  syncFinalizeIntentHashToPaymentIntent,
  persistFinalizeIntent,
  normalizeExperienceKeys,
  sanitizeAttribution
};
