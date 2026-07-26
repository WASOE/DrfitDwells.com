'use strict';

const crypto = require('crypto');
const GuestPreferenceAccessToken = require('../../models/GuestPreferenceAccessToken');
const GuestContactPreference = require('../../models/GuestContactPreference');
const SavedBookingQuote = require('../../models/SavedBookingQuote');
const QuoteContactConsentEvent = require('../../models/QuoteContactConsentEvent');
const { CONSENT_TEXTS } = require('./quoteContactConsentTexts');
const { normalizeEmail } = require('./contactPreferenceResolutionService');
const { resolveGuestContactStatus } = require('./contactPreferenceResolutionService');

const TOKEN_BYTE_LENGTH = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DEFAULT_TTL_DAYS = 90;

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken), 'utf8').digest('hex');
}

function isValidTokenFormat(rawToken) {
  return typeof rawToken === 'string' && TOKEN_PATTERN.test(rawToken);
}

function getPublicAppBaseUrl() {
  const u = process.env.APP_URL || process.env.VITE_APP_URL || 'https://driftdwells.com';
  return String(u).replace(/\/$/, '');
}

function buildPreferenceUrl(rawToken) {
  return `${getPublicAppBaseUrl()}/communication-preferences/${encodeURIComponent(rawToken)}`;
}

async function issuePreferenceAccessToken({
  email,
  savedQuoteId = null,
  ttlDays = DEFAULT_TTL_DAYS
} = {}) {
  const emailNormalized = normalizeEmail(email);
  if (!emailNormalized) {
    return { skipped: true, reason: 'missing_email' };
  }
  const rawToken = crypto.randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + Math.max(1, Number(ttlDays) || DEFAULT_TTL_DAYS) * 86400000);
  await GuestPreferenceAccessToken.create({
    tokenHash,
    emailNormalized,
    expiresAt,
    savedQuoteId: savedQuoteId || null
  });
  return {
    skipped: false,
    rawToken,
    expiresAt,
    preferenceUrl: buildPreferenceUrl(rawToken),
    emailNormalized
  };
}

async function resolvePreferenceToken(rawToken, { now = new Date() } = {}) {
  if (!isValidTokenFormat(rawToken)) {
    return { ok: false, reason: 'invalid_token' };
  }
  const tokenHash = hashToken(rawToken);
  const doc = await GuestPreferenceAccessToken.findOne({ tokenHash }).lean();
  if (!doc) return { ok: false, reason: 'invalid_token' };
  if (doc.revokedAt) return { ok: false, reason: 'revoked_token' };
  if (new Date(doc.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, reason: 'expired_token' };
  }
  return {
    ok: true,
    emailNormalized: doc.emailNormalized,
    expiresAt: doc.expiresAt,
    savedQuoteId: doc.savedQuoteId ? String(doc.savedQuoteId) : null,
    tokenId: String(doc._id)
  };
}

async function touchPreferenceToken(rawToken) {
  if (!isValidTokenFormat(rawToken)) return;
  await GuestPreferenceAccessToken.updateOne(
    { tokenHash: hashToken(rawToken) },
    { $set: { lastUsedAt: new Date() } }
  );
}

/**
 * Public preference page payload — never returns raw email.
 */
async function getPublicPreferenceState(rawToken) {
  const resolved = await resolvePreferenceToken(rawToken);
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }
  await touchPreferenceToken(rawToken);
  const status = await resolveGuestContactStatus(resolved.emailNormalized);
  const local = resolved.emailNormalized.split('@')[0] || '';
  const domain = resolved.emailNormalized.split('@')[1] || '';
  const maskedEmail = `${local.slice(0, Math.min(2, local.length))}***@${domain}`;

  return {
    ok: true,
    maskedEmail,
    expiresAt: resolved.expiresAt,
    preferences: {
      quoteDeliveryAllowed: status.quoteDeliveryAllowed,
      bookingReminderAllowed: status.bookingReminderAllowed,
      marketingAllowed: status.marketingAllowed,
      globallySuppressed: status.globallySuppressed
    },
    canGrantConsent: false,
    notice: 'This page can only withdraw optional contact preferences. It cannot grant new consent.'
  };
}

async function appendWithdrawalEvents({
  emailNormalized,
  withdrawQuoteDelivery,
  withdrawBookingReminder,
  withdrawMarketing,
  suppressAll,
  sourceSurface = 'withdrawal'
}) {
  const capturedAt = new Date();
  const events = [];
  const push = (consentType, meta) => {
    events.push({
      consentType,
      granted: false,
      textVersion: meta.version,
      textSnapshot: meta.text,
      capturedAt,
      sourceSurface,
      emailNormalized
    });
  };

  if (suppressAll || withdrawQuoteDelivery) push('quote_delivery', CONSENT_TEXTS.quote_delivery);
  if (suppressAll || withdrawBookingReminder) push('booking_reminder', CONSENT_TEXTS.booking_reminder);
  if (suppressAll || withdrawMarketing) push('marketing', CONSENT_TEXTS.marketing);

  if (events.length) {
    await QuoteContactConsentEvent.insertMany(events);
  }
  return { eventCount: events.length, capturedAt };
}

/**
 * Apply withdrawals only. Never grants consent from the public token.
 * Idempotent: repeating the same withdrawal is safe.
 */
async function applyPublicPreferenceWithdrawal(rawToken, body = {}) {
  const resolved = await resolvePreferenceToken(rawToken);
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }

  // Hard rule: public token cannot grant consent.
  if (
    body.quoteDeliveryRequested === true ||
    body.bookingReminderConsent === true ||
    body.marketingConsent === true ||
    body.grantConsent === true
  ) {
    return { ok: false, reason: 'grant_not_allowed' };
  }

  const suppressAll = body.suppressAll === true;
  const withdrawQuoteDelivery = suppressAll || body.withdrawQuoteDelivery === true;
  const withdrawBookingReminder = suppressAll || body.withdrawBookingReminder === true;
  const withdrawMarketing = suppressAll || body.withdrawMarketing === true;

  if (!withdrawQuoteDelivery && !withdrawBookingReminder && !withdrawMarketing && !suppressAll) {
    return { ok: false, reason: 'no_action' };
  }

  const emailNormalized = resolved.emailNormalized;
  const before = await resolveGuestContactStatus(emailNormalized);

  const already =
    (!withdrawQuoteDelivery || !before.quoteDeliveryAllowed) &&
    (!withdrawBookingReminder || !before.bookingReminderAllowed) &&
    (!withdrawMarketing || !before.marketingAllowed) &&
    (!suppressAll || before.globallySuppressed);

  const { capturedAt } = await appendWithdrawalEvents({
    emailNormalized,
    withdrawQuoteDelivery,
    withdrawBookingReminder,
    withdrawMarketing,
    suppressAll
  });

  const set = {
    lastEventAt: capturedAt
  };
  if (withdrawQuoteDelivery) {
    set.quoteDelivery = 'denied';
    set.quoteDeliveryWordingVersion = CONSENT_TEXTS.quote_delivery.version;
    set.quoteDeliveryCapturedAt = capturedAt;
  }
  if (withdrawBookingReminder) {
    set.bookingReminder = 'denied';
    set.bookingReminderWordingVersion = CONSENT_TEXTS.booking_reminder.version;
    set.bookingReminderCapturedAt = capturedAt;
  }
  if (withdrawMarketing) {
    set.marketing = 'denied';
    set.marketingWordingVersion = CONSENT_TEXTS.marketing.version;
    set.marketingCapturedAt = capturedAt;
  }
  if (suppressAll) {
    set.suppressed = true;
    set.suppressedReason = 'user_optout_stop';
    set.suppressedAt = capturedAt;
    set.quoteDelivery = 'denied';
    set.bookingReminder = 'denied';
    set.marketing = 'denied';
  }

  // Defaults for fields not being withdrawn on this request (upsert only).
  // Never put the same path in both $set and $setOnInsert.
  const setOnInsert = {
    phoneStatus: 'unknown',
    transactional: 'unknown'
  };
  if (set.quoteDelivery === undefined) setOnInsert.quoteDelivery = 'unknown';
  if (set.bookingReminder === undefined) setOnInsert.bookingReminder = 'unknown';
  if (set.marketing === undefined) setOnInsert.marketing = 'denied';
  if (set.suppressed === undefined) setOnInsert.suppressed = false;

  await GuestContactPreference.findOneAndUpdate(
    { recipientType: 'email', recipientValue: emailNormalized },
    {
      $set: set,
      $setOnInsert: setOnInsert
    },
    { upsert: true, new: true }
  );

  // Propagate withdrawal to every saved quote for this email.
  const quoteSet = {};
  if (withdrawQuoteDelivery || suppressAll) quoteSet.quoteDeliveryRequested = false;
  if (withdrawBookingReminder || suppressAll) {
    quoteSet.bookingReminderConsent = false;
    quoteSet.transactionalContinuationEligible = false;
  }
  if (withdrawMarketing || suppressAll) quoteSet.marketingConsent = false;
  if (suppressAll) {
    quoteSet['recoveryState.suppressedAt'] = capturedAt;
    quoteSet['recoveryState.suppressionReason'] = 'user_optout_stop';
  }
  quoteSet['consentSnapshot.quoteDeliveryRequested'] =
    withdrawQuoteDelivery || suppressAll
      ? false
      : undefined;
  // Only set defined keys
  const cleanQuoteSet = Object.fromEntries(
    Object.entries({
      ...quoteSet,
      'consentSnapshot.quoteDeliveryRequested':
        withdrawQuoteDelivery || suppressAll ? false : undefined,
      'consentSnapshot.bookingReminderConsent':
        withdrawBookingReminder || suppressAll ? false : undefined,
      'consentSnapshot.marketingConsent': withdrawMarketing || suppressAll ? false : undefined,
      'recoveryEligibility.eligible': false,
      'recoveryEligibility.reason': suppressAll ? 'globally_suppressed' : 'consent_withdrawn',
      'recoveryEligibility.evaluatedAt': capturedAt
    }).filter(([, v]) => v !== undefined)
  );

  await SavedBookingQuote.updateMany({ emailNormalized }, { $set: cleanQuoteSet });

  try {
    const { cancelUnsentDeliveriesForEmail } = require('./recoveryPreparationService');
    await cancelUnsentDeliveriesForEmail(
      emailNormalized,
      suppressAll ? 'globally_suppressed' : 'consent_withdrawn'
    );
  } catch (err) {
    console.error('[preference] cancel unsent deliveries failed', {
      message: err?.message || String(err)
    });
  }

  await touchPreferenceToken(rawToken);
  const after = await resolveGuestContactStatus(emailNormalized);

  return {
    ok: true,
    idempotent: already,
    preferences: {
      quoteDeliveryAllowed: after.quoteDeliveryAllowed,
      bookingReminderAllowed: after.bookingReminderAllowed,
      marketingAllowed: after.marketingAllowed,
      globallySuppressed: after.globallySuppressed
    }
  };
}

module.exports = {
  issuePreferenceAccessToken,
  resolvePreferenceToken,
  getPublicPreferenceState,
  applyPublicPreferenceWithdrawal,
  buildPreferenceUrl,
  hashToken,
  isValidTokenFormat,
  TOKEN_PATTERN
};
