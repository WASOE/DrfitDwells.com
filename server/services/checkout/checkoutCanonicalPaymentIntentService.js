const CheckoutSession = require('../../models/CheckoutSession');
const bookingQuoteService = require('../bookingQuoteService');
const { CheckoutSessionError, CHECKOUT_SESSION_ERROR_CODES } = require('./checkoutSessionErrors');
const {
  createCheckoutSession,
  refreshCheckoutSessionQuote,
  loadSessionOrThrow,
  assertSessionUsable,
  normalizeCheckoutSessionInput
} = require('./checkoutSessionService');

const CANCELLABLE_PAYMENT_INTENT_STATUSES = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'requires_capture'
]);

const REUSABLE_PAYMENT_INTENT_STATUSES = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action'
]);

const TERMINAL_NON_CANCEL_PI_STATUSES = new Set(['processing', 'succeeded']);

function defaultCurrency() {
  return (process.env.STRIPE_CURRENCY || 'eur').toLowerCase();
}

function buildQuoteFromSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    subtotalPrice: (snapshot.subtotalCents || 0) / 100,
    discountAmount: (snapshot.discountAmountCents || 0) / 100,
    totalPrice: (snapshot.totalValueCents || 0) / 100,
    appliedPromoCode: snapshot.appliedPromoCode || snapshot.promoCode || ''
  };
}

function buildPaymentIntentMetadata({
  session,
  snapshot,
  redemptionId = null,
  giftVoucherId = null,
  reservationKey = null
}) {
  const checkInDate = snapshot.checkInISO ? new Date(snapshot.checkInISO) : null;
  const checkOutDate = snapshot.checkOutISO ? new Date(snapshot.checkOutISO) : null;
  return {
    flowVersion: session.flowVersion || 'v2',
    checkoutId: session.checkoutId,
    quoteSnapshotHash: session.quoteSnapshotHash || '',
    entityType: snapshot.entityType || 'cabin',
    cabinId: snapshot.cabinId || '',
    cabinTypeId: snapshot.cabinTypeId || '',
    checkIn: checkInDate ? checkInDate.toISOString() : '',
    checkOut: checkOutDate ? checkOutDate.toISOString() : '',
    amountCents: String(snapshot.stripeAmountCents || 0),
    stripeAmountCents: String(snapshot.stripeAmountCents || 0),
    experienceKeys: JSON.stringify(snapshot.experienceKeys || []),
    transportMethod: String(snapshot.transportMethod || ''),
    romanticSetup: String(!!snapshot.romanticSetup),
    promoCode: snapshot.appliedPromoCode || snapshot.promoCode || '',
    subtotalCents: String(snapshot.subtotalCents || 0),
    discountAmountCents: String(snapshot.discountAmountCents || 0),
    finalTotalCents: String(snapshot.totalValueCents || 0),
    voucherAppliedCents: String(snapshot.voucherAppliedCents || 0),
    redemptionId: redemptionId ? String(redemptionId) : '',
    giftVoucherId: giftVoucherId ? String(giftVoucherId) : '',
    reservationKey: reservationKey ? String(reservationKey) : '',
    finalizeIntentHash: session.finalizeIntentHash || ''
  };
}

async function tryCancelPaymentIntent(stripe, paymentIntentId, existingPi = null) {
  if (!stripe?.paymentIntents?.cancel || !paymentIntentId) {
    return { attempted: false, cancelled: false, status: existingPi?.status || null };
  }
  let pi = existingPi;
  if (!pi && stripe.paymentIntents.retrieve) {
    try {
      pi = await stripe.paymentIntents.retrieve(String(paymentIntentId));
    } catch {
      return { attempted: false, cancelled: false, status: null };
    }
  }
  const status = pi?.status || null;
  if (!CANCELLABLE_PAYMENT_INTENT_STATUSES.has(status)) {
    return { attempted: false, cancelled: false, status };
  }
  try {
    await stripe.paymentIntents.cancel(String(paymentIntentId));
    return { attempted: true, cancelled: true, status: 'canceled' };
  } catch {
    return { attempted: true, cancelled: false, status };
  }
}

function appendSupersededId(session, paymentIntentId) {
  if (!paymentIntentId) return;
  const id = String(paymentIntentId);
  const list = Array.isArray(session.supersededPaymentIntentIds)
    ? [...session.supersededPaymentIntentIds]
    : [];
  if (!list.includes(id)) {
    list.push(id);
    session.supersededPaymentIntentIds = list;
  }
}

async function supersedeCanonicalPaymentIntent({ session, reason = null, stripe }) {
  const paymentIntentId = session.canonicalPaymentIntentId;
  if (!paymentIntentId) {
    return {
      supersededPaymentIntentId: null,
      cancelAttempted: false,
      cancelSucceeded: false,
      status: null,
      reason
    };
  }

  let existingPi = null;
  if (stripe?.paymentIntents?.retrieve) {
    try {
      existingPi = await stripe.paymentIntents.retrieve(String(paymentIntentId));
    } catch {
      existingPi = null;
    }
  }

  const cancelResult = await tryCancelPaymentIntent(stripe, paymentIntentId, existingPi);
  appendSupersededId(session, paymentIntentId);
  session.canonicalPaymentIntentId = null;
  if (session.status === 'pi_active') {
    session.status = session.quoteSnapshot?.fullVoucherCoverage
      ? 'voucher_only_reserved'
      : session.stripeAmountCents > 0
        ? 'payment_required'
        : 'payment_not_required';
  }
  await saveSession(session);

  return {
    supersededPaymentIntentId: String(paymentIntentId),
    cancelAttempted: cancelResult.attempted,
    cancelSucceeded: cancelResult.cancelled,
    status: cancelResult.status || existingPi?.status || null,
    reason
  };
}

function paymentIntentMatchesSession(pi, session, redemptionId = null) {
  const snapshot = session.quoteSnapshot;
  if (!pi || !snapshot) {
    return { ok: false, message: 'missing_payment_intent_or_snapshot' };
  }
  const quote = buildQuoteFromSnapshot(snapshot);
  return bookingQuoteService.paymentIntentMatchesVoucherCheckout(pi, {
    quote,
    stripeAmountCents: session.stripeAmountCents,
    voucherAppliedCents: snapshot.voucherAppliedCents,
    redemptionId: redemptionId || session.voucherRedemptionId
  });
}

function buildEnsureDto(session, extras = {}) {
  const snapshot = session.quoteSnapshot || {};
  return {
    checkoutId: session.checkoutId,
    flowVersion: session.flowVersion,
    sessionStatus: session.status,
    paymentStatus: session.paymentStatus,
    quoteSnapshotHash: session.quoteSnapshotHash,
    sessionVersion: session.sessionVersion,
    finalizeIntentHash: session.finalizeIntentHash || null,
    canonicalPaymentIntentId: session.canonicalPaymentIntentId || null,
    clientSecret: extras.clientSecret ?? null,
    stripeAmountCents: session.stripeAmountCents,
    giftVoucherAppliedCents: session.giftVoucherAppliedCents,
    fullVoucherCoverage: Boolean(snapshot.fullVoucherCoverage),
    voucherRedemptionId: session.voucherRedemptionId ? String(session.voucherRedemptionId) : null,
    idempotentReplay: Boolean(extras.idempotentReplay),
    supersededPaymentIntentIds: [...(session.supersededPaymentIntentIds || [])],
    requiresPaymentIntentRefresh: Boolean(extras.requiresPaymentIntentRefresh),
    noPaymentRequired: Boolean(extras.noPaymentRequired),
    canonicalPaymentIntentSucceeded: Boolean(extras.canonicalPaymentIntentSucceeded)
  };
}

async function saveSession(session) {
  await session.save();
  return session;
}

async function claimCanonicalPaymentIntent({
  checkoutId,
  expectedSessionVersion,
  paymentIntentId,
  paymentStatus = 'unpaid'
}) {
  const updated = await CheckoutSession.findOneAndUpdate(
    {
      checkoutId: String(checkoutId),
      sessionVersion: expectedSessionVersion,
      $or: [{ canonicalPaymentIntentId: null }, { canonicalPaymentIntentId: { $exists: false } }]
    },
    {
      $set: {
        canonicalPaymentIntentId: String(paymentIntentId),
        status: 'pi_active',
        paymentStatus
      },
      $inc: { sessionVersion: 1 }
    },
    { new: true }
  );
  return updated;
}

async function attachCanonicalPaymentIntentToVoucher({
  redemptionId,
  canonicalPaymentIntentId,
  attachPaymentIntent
}) {
  if (!redemptionId || !attachPaymentIntent) {
    return;
  }
  const piId = String(canonicalPaymentIntentId || '').trim();
  if (!piId) {
    return;
  }
  try {
    await attachPaymentIntent({ redemptionId, paymentIntentId: piId });
  } catch (err) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.VOUCHER_PAYMENT_INTENT_ATTACH_FAILED,
      'Failed to attach payment intent to voucher redemption',
      {
        redemptionId: String(redemptionId),
        canonicalPaymentIntentId: piId,
        cause: err?.message || String(err)
      }
    );
  }
}

async function completeCanonicalClaimReturn({
  session,
  pi,
  idempotentReplay,
  redemptionId,
  attachPaymentIntent,
  canonicalPaymentIntentId = null
}) {
  const canonicalId = String(
    canonicalPaymentIntentId ?? session.canonicalPaymentIntentId ?? pi.id
  );
  await attachCanonicalPaymentIntentToVoucher({
    redemptionId,
    canonicalPaymentIntentId: canonicalId,
    attachPaymentIntent
  });
  return { session, pi, idempotentReplay };
}

function buildPaymentIntentIdempotencyKey(checkoutId, quoteSnapshotHash) {
  return `checkout-session:${checkoutId}:pi:${quoteSnapshotHash}`;
}

async function createStripePaymentIntent(stripe, { amountCents, currency, metadata, checkoutId, quoteSnapshotHash }) {
  if (!stripe?.paymentIntents?.create) {
    throw new Error('Stripe paymentIntents.create is not available');
  }
  const idempotencyKey = buildPaymentIntentIdempotencyKey(checkoutId, quoteSnapshotHash);
  // DB claim prevents two canonicals on the session document.
  // Stripe idempotency key prevents two real Stripe PIs when concurrent callers race before DB claim completes.
  return stripe.paymentIntents.create(
    {
      amount: amountCents,
      currency,
      automatic_payment_methods: { enabled: true },
      metadata
    },
    { idempotencyKey }
  );
}

async function reconcileOrphanCreatedPaymentIntent({ session, stripe, createdPi, winnerCanonicalId }) {
  const createdId = String(createdPi.id);
  if (!winnerCanonicalId || winnerCanonicalId === createdId) {
    return;
  }
  const cancelResult = await tryCancelPaymentIntent(stripe, createdId, createdPi);
  if (!cancelResult.cancelled) {
    appendSupersededId(session, createdId);
    await saveSession(session);
  }
}

async function claimCreatedPaymentIntentOrReuseWinner({
  session,
  stripe,
  pi,
  versionForClaim,
  redemptionId,
  attachPaymentIntent
}) {
  let claimed = await claimCanonicalPaymentIntent({
    checkoutId: session.checkoutId,
    expectedSessionVersion: versionForClaim,
    paymentIntentId: pi.id
  });

  if (claimed) {
    return completeCanonicalClaimReturn({
      session: claimed,
      pi,
      idempotentReplay: false,
      redemptionId,
      attachPaymentIntent,
      canonicalPaymentIntentId: claimed.canonicalPaymentIntentId
    });
  }

  let current = await loadSessionOrThrow(session.checkoutId);
  const winnerId = current.canonicalPaymentIntentId ? String(current.canonicalPaymentIntentId) : null;

  if (winnerId === String(pi.id)) {
    const reuse = await tryReuseCanonicalPaymentIntent({ session: current, stripe, redemptionId });
    return completeCanonicalClaimReturn({
      session: current,
      pi: reuse?.pi || pi,
      idempotentReplay: true,
      redemptionId,
      attachPaymentIntent,
      canonicalPaymentIntentId: winnerId
    });
  }

  if (winnerId) {
    await reconcileOrphanCreatedPaymentIntent({
      session: current,
      stripe,
      createdPi: pi,
      winnerCanonicalId: winnerId
    });
    current = await loadSessionOrThrow(session.checkoutId);
    const winnerReuse = await tryReuseCanonicalPaymentIntent({ session: current, stripe, redemptionId });
    if (winnerReuse?.reuse) {
      return completeCanonicalClaimReturn({
        session: current,
        pi: winnerReuse.pi,
        idempotentReplay: true,
        redemptionId,
        attachPaymentIntent,
        canonicalPaymentIntentId: winnerId
      });
    }
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_CONCURRENCY_CONFLICT,
      'Checkout session payment intent claim conflict',
      { createdPaymentIntentId: String(pi.id), winnerCanonicalPaymentIntentId: winnerId }
    );
  }

  claimed = await claimCanonicalPaymentIntent({
    checkoutId: current.checkoutId,
    expectedSessionVersion: current.sessionVersion,
    paymentIntentId: pi.id
  });

  if (claimed) {
    return completeCanonicalClaimReturn({
      session: claimed,
      pi,
      idempotentReplay: false,
      redemptionId,
      attachPaymentIntent,
      canonicalPaymentIntentId: claimed.canonicalPaymentIntentId
    });
  }

  current = await loadSessionOrThrow(session.checkoutId);
  const finalWinner = current.canonicalPaymentIntentId ? String(current.canonicalPaymentIntentId) : null;

  if (finalWinner === String(pi.id)) {
    return completeCanonicalClaimReturn({
      session: current,
      pi,
      idempotentReplay: true,
      redemptionId,
      attachPaymentIntent,
      canonicalPaymentIntentId: finalWinner
    });
  }

  if (finalWinner) {
    await reconcileOrphanCreatedPaymentIntent({
      session: current,
      stripe,
      createdPi: pi,
      winnerCanonicalId: finalWinner
    });
    current = await loadSessionOrThrow(session.checkoutId);
    const winnerReuse = await tryReuseCanonicalPaymentIntent({ session: current, stripe, redemptionId });
    if (winnerReuse?.reuse) {
      return completeCanonicalClaimReturn({
        session: current,
        pi: winnerReuse.pi,
        idempotentReplay: true,
        redemptionId,
        attachPaymentIntent,
        canonicalPaymentIntentId: finalWinner
      });
    }
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_CONCURRENCY_CONFLICT,
      'Checkout session payment intent claim conflict',
      { createdPaymentIntentId: String(pi.id), winnerCanonicalPaymentIntentId: finalWinner }
    );
  }

  await tryCancelPaymentIntent(stripe, pi.id, pi);
  throw new CheckoutSessionError(
    CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_CONCURRENCY_CONFLICT,
    'Checkout session payment intent claim conflict',
    { createdPaymentIntentId: String(pi.id), winnerCanonicalPaymentIntentId: null }
  );
}

async function defaultVoucherAdapter({ voucherCode, checkoutId, totalValueCents }) {
  const normalized = typeof voucherCode === 'string' ? voucherCode.trim() : '';
  if (!normalized) return null;

  const {
    reserveVoucherForCheckout,
    releaseExpiredVoucherReservations
  } = require('../bookings/bookingVoucherRedemptionService');

  await releaseExpiredVoucherReservations({ now: new Date(), limit: 25 });
  const holdExpiry = new Date(Date.now() + 30 * 60 * 1000);
  return reserveVoucherForCheckout({
    voucherCode: normalized,
    checkoutId,
    totalValueCents,
    redemptionExpiresAt: holdExpiry,
    actor: 'guest'
  });
}

async function defaultAttachPaymentIntent({ redemptionId, paymentIntentId }) {
  const { attachPaymentIntentToReservation } = require('../bookings/bookingVoucherRedemptionService');
  await attachPaymentIntentToReservation({ redemptionId, paymentIntentId });
}

async function syncVoucherReservation({
  session,
  input,
  quote,
  voucherAdapter = defaultVoucherAdapter
}) {
  const normalized = normalizeCheckoutSessionInput(input);
  if (!normalized.voucherCode) {
    return null;
  }

  const snapshot = session.quoteSnapshot || {};
  const totalValueCents = snapshot.totalValueCents || Math.round((quote?.totalPrice || 0) * 100);
  const reservation = await voucherAdapter({
    voucherCode: normalized.voucherCode,
    checkoutId: session.checkoutId,
    totalValueCents
  });

  if (reservation?.redemptionId) {
    session.voucherRedemptionId = reservation.redemptionId;
    session.metadata = {
      ...(session.metadata || {}),
      giftVoucherId: reservation.giftVoucherId ? String(reservation.giftVoucherId) : null,
      reservationKey: reservation.reservationKey ? String(reservation.reservationKey) : null
    };
    await saveSession(session);
  }
  return reservation;
}

async function ensureSessionFromQuote({ checkoutId, input, quote, metadata }) {
  if (!checkoutId) {
    return createCheckoutSession({ input, quote, metadata });
  }

  try {
    await loadSessionOrThrow(checkoutId);
  } catch (err) {
    if (err?.code !== CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_FOUND) {
      throw err;
    }
    // Client-minted cold-start identity: adopt the supplied checkoutId.
    return createCheckoutSession({ input, quote, metadata, checkoutId });
  }

  return refreshCheckoutSessionQuote({ checkoutId, input, quote });
}

async function clearCanonicalForNoPayment({ session, stripe }) {
  if (session.canonicalPaymentIntentId) {
    await supersedeCanonicalPaymentIntent({ session, reason: 'no_payment_required', stripe });
    await saveSession(session);
  }
}

async function tryReuseCanonicalPaymentIntent({ session, stripe, redemptionId }) {
  const paymentIntentId = session.canonicalPaymentIntentId;
  if (!paymentIntentId || !stripe?.paymentIntents?.retrieve) {
    return null;
  }

  const pi = await stripe.paymentIntents.retrieve(String(paymentIntentId));
  if (TERMINAL_NON_CANCEL_PI_STATUSES.has(pi.status)) {
    return {
      pi,
      reuse: false,
      succeeded: pi.status === 'succeeded',
      processing: pi.status === 'processing'
    };
  }

  if (!REUSABLE_PAYMENT_INTENT_STATUSES.has(pi.status)) {
    return { pi, reuse: false, succeeded: false, processing: false };
  }

  const match = paymentIntentMatchesSession(pi, session, redemptionId);
  if (!match.ok) {
    return { pi, reuse: false, succeeded: false, processing: false };
  }

  session.status = 'pi_active';
  session.paymentStatus = 'unpaid';
  await saveSession(session);

  return {
    pi,
    reuse: true,
    succeeded: false,
    processing: false
  };
}

/**
 * Canonical PaymentIntent ownership for CheckoutSession V2.
 */
async function ensureCanonicalPaymentIntent({
  checkoutId = null,
  input,
  quote,
  stripe,
  metadata = null,
  voucherAdapter = defaultVoucherAdapter,
  attachPaymentIntent = defaultAttachPaymentIntent
}) {
  const clientExpectedRaw =
    input?.expectedSessionVersion ?? input?.sessionVersion ?? null;

  // Capture pre-existing session version before any same-request quote refresh.
  let versionBeforeQuoteSync = null;
  if (checkoutId) {
    try {
      const existing = await loadSessionOrThrow(checkoutId);
      versionBeforeQuoteSync = Number(existing.sessionVersion) || 1;
    } catch (err) {
      if (err?.code !== CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_FOUND) {
        throw err;
      }
      // Cold-start with client-minted id: no prior server session.
      versionBeforeQuoteSync = null;
    }
  }

  if (
    versionBeforeQuoteSync != null &&
    clientExpectedRaw != null &&
    clientExpectedRaw !== ''
  ) {
    const clientExpected = Number(clientExpectedRaw);
    if (!Number.isInteger(clientExpected) || clientExpected < 1) {
      throw new CheckoutSessionError(
        CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_INVALID,
        'expectedSessionVersion is invalid',
        { field: 'expectedSessionVersion', checkoutId }
      );
    }
    if (clientExpected !== versionBeforeQuoteSync) {
      throw new CheckoutSessionError(
        CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_SESSION_VERSION_CONFLICT,
        'Checkout session version conflict',
        {
          expectedSessionVersion: clientExpected,
          sessionVersion: versionBeforeQuoteSync,
          checkoutId
        }
      );
    }
  }

  let sessionResult = await ensureSessionFromQuote({ checkoutId, input, quote, metadata });
  let session = sessionResult.session;
  assertSessionUsable(session);

  // Refuse voucher attach / quote drift after a payment already succeeded on this session.
  // Otherwise we reserve a voucher against a full-amount paid PI and booking finalization opens MRI.
  if (session.canonicalPaymentIntentId && stripe?.paymentIntents?.retrieve) {
    let paidPi = null;
    try {
      paidPi = await stripe.paymentIntents.retrieve(String(session.canonicalPaymentIntentId));
    } catch {
      paidPi = null;
    }
    if (paidPi && TERMINAL_NON_CANCEL_PI_STATUSES.has(paidPi.status)) {
      const normalizedIncoming = normalizeCheckoutSessionInput(input);
      const incomingVoucher = Boolean(normalizedIncoming.voucherCode);
      const sessionAlreadyVouchered =
        Boolean(session.voucherRedemptionId) || Number(session.giftVoucherAppliedCents || 0) > 0;
      if (incomingVoucher && !sessionAlreadyVouchered) {
        throw new CheckoutSessionError(
          CHECKOUT_SESSION_ERROR_CODES.CANONICAL_PAYMENT_INTENT_MISMATCH,
          'Payment already completed; voucher cannot be applied to this paid checkout',
          {
            checkoutId: session.checkoutId,
            paymentIntentId: String(paidPi.id),
            reason: 'voucher_after_paid_pi',
            mismatchedInvariant: 'voucherAppliedCents'
          }
        );
      }
      const paidMatch = paymentIntentMatchesSession(
        paidPi,
        session,
        session.voucherRedemptionId ? String(session.voucherRedemptionId) : null
      );
      if (!paidMatch.ok && (incomingVoucher || sessionAlreadyVouchered)) {
        throw new CheckoutSessionError(
          CHECKOUT_SESSION_ERROR_CODES.CANONICAL_PAYMENT_INTENT_MISMATCH,
          'Paid payment intent does not match the current voucher reservation or quote',
          {
            checkoutId: session.checkoutId,
            paymentIntentId: String(paidPi.id),
            reason: paidMatch.message || 'paid_pi_quote_voucher_mismatch',
            mismatchedInvariant: paidMatch.message || null
          }
        );
      }
    }
  }

  const voucherReservation = await syncVoucherReservation({ session, input, quote, voucherAdapter });
  if (voucherReservation) {
    sessionResult = await refreshCheckoutSessionQuote({
      checkoutId: session.checkoutId,
      input,
      quote
    });
    session = sessionResult.session;
    assertSessionUsable(session);
  } else {
    session = await loadSessionOrThrow(session.checkoutId);
  }

  const {
    ensureFinalizeIntentForPaymentPreparation
  } = require('./finalizeIntentService');
  // Persist against the authoritative session version after create/load/refresh.
  // Cold-start browser defaults must not invalidate a session created in this request.
  const finalizePrep = await ensureFinalizeIntentForPaymentPreparation({
    session,
    body: input || {},
    requestMeta: (input && input.__requestMeta) || {
      ip: null,
      userAgent: null,
      acceptLanguage: null
    },
    expectedSessionVersion: Number(session.sessionVersion) || 1,
    stripe
  });
  session = finalizePrep.session || session;

  const snapshot = session.quoteSnapshot || {};
  const needsCard = session.stripeAmountCents > 0;
  const noPaymentRequired =
    session.status === 'voucher_only_reserved' || session.status === 'payment_not_required';

  if (noPaymentRequired || !needsCard) {
    await clearCanonicalForNoPayment({ session, stripe });
    session = await loadSessionOrThrow(session.checkoutId);
    return buildEnsureDto(session, {
      noPaymentRequired: true,
      idempotentReplay: false,
      requiresPaymentIntentRefresh: false
    });
  }

  const redemptionId = session.voucherRedemptionId ? String(session.voucherRedemptionId) : null;
  const giftVoucherId = session.metadata?.giftVoucherId
    ? String(session.metadata.giftVoucherId)
    : null;
  const reservationKey = session.metadata?.reservationKey
    ? String(session.metadata.reservationKey)
    : null;
  const hashChanged = Boolean(sessionResult.quoteSnapshotHashChanged);
  const mustSupersede = hashChanged && Boolean(session.canonicalPaymentIntentId);

  if (mustSupersede) {
    // Never supersede a succeeded/processing PI into a second charge after quote/voucher drift.
    let terminalPi = null;
    try {
      terminalPi = await stripe.paymentIntents.retrieve(String(session.canonicalPaymentIntentId));
    } catch {
      terminalPi = null;
    }
    if (terminalPi && TERMINAL_NON_CANCEL_PI_STATUSES.has(terminalPi.status)) {
      const match = paymentIntentMatchesSession(terminalPi, session, redemptionId);
      if (!match.ok) {
        throw new CheckoutSessionError(
          CHECKOUT_SESSION_ERROR_CODES.CANONICAL_PAYMENT_INTENT_MISMATCH,
          'Paid payment intent does not match the current voucher reservation or quote',
          {
            checkoutId: session.checkoutId,
            paymentIntentId: String(terminalPi.id),
            reason: match.message || 'paid_pi_quote_voucher_mismatch',
            mismatchedInvariant: match.message || null
          }
        );
      }
      return buildEnsureDto(session, {
        clientSecret: terminalPi.client_secret || null,
        idempotentReplay: true,
        requiresPaymentIntentRefresh: false,
        canonicalPaymentIntentSucceeded: terminalPi.status === 'succeeded'
      });
    }
    await supersedeCanonicalPaymentIntent({ session, reason: 'quote_snapshot_hash_changed', stripe });
    session = await loadSessionOrThrow(session.checkoutId);
  }

  const reuseResult = await tryReuseCanonicalPaymentIntent({ session, stripe, redemptionId });
  if (reuseResult?.reuse) {
    const {
      assertFinalizeIntentAvailableForPi,
      syncFinalizeIntentHashToPaymentIntent
    } = require('./finalizeIntentService');
    assertFinalizeIntentAvailableForPi(session);
    await syncFinalizeIntentHashToPaymentIntent({
      stripe,
      session,
      finalizeIntentHash: session.finalizeIntentHash || ''
    });
    if (redemptionId) {
      await attachCanonicalPaymentIntentToVoucher({
        redemptionId,
        canonicalPaymentIntentId: session.canonicalPaymentIntentId,
        attachPaymentIntent
      });
    }
    return buildEnsureDto(session, {
      clientSecret: reuseResult.pi.client_secret,
      idempotentReplay: true,
      requiresPaymentIntentRefresh: false
    });
  }

  if (reuseResult?.succeeded || reuseResult?.processing) {
    const match = paymentIntentMatchesSession(reuseResult.pi, session, redemptionId);
    if (!match.ok) {
      throw new CheckoutSessionError(
        CHECKOUT_SESSION_ERROR_CODES.CANONICAL_PAYMENT_INTENT_MISMATCH,
        'Paid payment intent does not match the current voucher reservation or quote',
        {
          checkoutId: session.checkoutId,
          paymentIntentId: String(reuseResult.pi?.id || ''),
          reason: match.message || 'paid_pi_quote_voucher_mismatch',
          mismatchedInvariant: match.message || null
        }
      );
    }
    return buildEnsureDto(session, {
      clientSecret: reuseResult.pi?.client_secret || null,
      idempotentReplay: false,
      requiresPaymentIntentRefresh: false,
      canonicalPaymentIntentSucceeded: reuseResult.succeeded
    });
  }

  if (reuseResult?.pi && !reuseResult.reuse) {
    await supersedeCanonicalPaymentIntent({
      session,
      reason: 'canonical_payment_intent_not_reusable',
      stripe
    });
    session = await loadSessionOrThrow(session.checkoutId);
  }

  const { assertFinalizeIntentAvailableForPi } = require('./finalizeIntentService');
  assertFinalizeIntentAvailableForPi(session);

  const versionForClaim = session.sessionVersion;
  const pi = await createStripePaymentIntent(stripe, {
    amountCents: session.stripeAmountCents,
    currency: defaultCurrency(),
    metadata: buildPaymentIntentMetadata({
      session,
      snapshot,
      redemptionId,
      giftVoucherId,
      reservationKey
    }),
    checkoutId: session.checkoutId,
    quoteSnapshotHash: session.quoteSnapshotHash
  });

  const claimResult = await claimCreatedPaymentIntentOrReuseWinner({
    session,
    stripe,
    pi,
    versionForClaim,
    redemptionId,
    attachPaymentIntent
  });

  return buildEnsureDto(claimResult.session, {
    clientSecret: claimResult.pi.client_secret,
    idempotentReplay: claimResult.idempotentReplay,
    requiresPaymentIntentRefresh: false
  });
}

async function assertCanonicalPaymentIntentForSession({
  checkoutId,
  paymentIntentId,
  skipSessionUsableGuard = false
} = {}) {
  const session = await loadSessionOrThrow(checkoutId);
  if (!skipSessionUsableGuard) {
    assertSessionUsable(session);
  } else if (session.status === 'superseded') {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_SUPERSEDED,
      'Checkout session was superseded'
    );
  }

  const piId = String(paymentIntentId || '').trim();
  if (!piId) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CANONICAL_PAYMENT_INTENT_MISMATCH,
      'paymentIntentId is required'
    );
  }

  const superseded = (session.supersededPaymentIntentIds || []).map(String);
  if (superseded.includes(piId)) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.SUPERSEDED_PAYMENT_INTENT,
      'Payment intent was superseded for this checkout session'
    );
  }

  const canonical = String(session.canonicalPaymentIntentId || '');
  if (!canonical || canonical !== piId) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CANONICAL_PAYMENT_INTENT_MISMATCH,
      'Payment intent does not match canonical checkout session payment'
    );
  }

  return { ok: true, checkoutId: session.checkoutId, canonicalPaymentIntentId: canonical };
}

module.exports = {
  CANCELLABLE_PAYMENT_INTENT_STATUSES,
  REUSABLE_PAYMENT_INTENT_STATUSES,
  buildPaymentIntentIdempotencyKey,
  buildPaymentIntentMetadata,
  buildQuoteFromSnapshot,
  tryCancelPaymentIntent,
  supersedeCanonicalPaymentIntent,
  paymentIntentMatchesSession,
  ensureCanonicalPaymentIntent,
  assertCanonicalPaymentIntentForSession,
  claimCanonicalPaymentIntent,
  claimCreatedPaymentIntentOrReuseWinner,
  attachCanonicalPaymentIntentToVoucher,
  defaultVoucherAdapter,
  defaultAttachPaymentIntent
};
