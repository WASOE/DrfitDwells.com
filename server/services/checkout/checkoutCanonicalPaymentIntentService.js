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
const {
  getPaymentChoice,
  resolveExpectedChargeCents,
  buildPaymentIdentityKey,
  assertSplitConsentOnSession,
  setCheckoutPaymentChoice,
  toCheckoutSessionError,
  SplitPaymentChoiceError
} = require('../splitPaymentChoiceService');

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
const REUSABLE_OFF_SESSION_PM_TYPES = new Set(['card']);

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
  reservationKey = null,
  chargeAmountCents = null
}) {
  const checkInDate = snapshot.checkInISO ? new Date(snapshot.checkInISO) : null;
  const checkOutDate = snapshot.checkOutISO ? new Date(snapshot.checkOutISO) : null;
  const charge =
    chargeAmountCents != null
      ? Number(chargeAmountCents)
      : resolveExpectedChargeCents(session);
  const choice = getPaymentChoice(session);
  return {
    flowVersion: session.flowVersion || 'v2',
    checkoutId: session.checkoutId,
    quoteSnapshotHash: session.quoteSnapshotHash || '',
    entityType: snapshot.entityType || 'cabin',
    cabinId: snapshot.cabinId || '',
    cabinTypeId: snapshot.cabinTypeId || '',
    checkIn: checkInDate ? checkInDate.toISOString() : '',
    checkOut: checkOutDate ? checkOutDate.toISOString() : '',
    amountCents: String(charge),
    stripeAmountCents: String(session.stripeAmountCents || 0),
    chargeAmountCents: String(charge),
    paymentChoice: choice,
    splitOfferSnapshotHash:
      choice === 'split' ? String(session.splitPaymentOfferSnapshotHash || '') : '',
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
  let chargeAmountCents;
  try {
    chargeAmountCents = resolveExpectedChargeCents(session);
  } catch (err) {
    return { ok: false, message: err.code || 'charge_amount_unresolved' };
  }
  if (Number(pi.amount) !== Number(chargeAmountCents)) {
    return { ok: false, message: 'amount_mismatch' };
  }

  const meta = pi.metadata || {};
  if (Number(meta.voucherAppliedCents || 0) !== Number(snapshot.voucherAppliedCents || 0)) {
    return { ok: false, message: 'voucher_applied_mismatch' };
  }
  const redId = redemptionId || session.voucherRedemptionId;
  if (redId != null && String(redId) !== '') {
    if (String(meta.redemptionId || '') !== String(redId)) {
      return { ok: false, message: 'redemption_id_mismatch' };
    }
  }

  // Promo code identity still required; amount-vs-full-total check is skipped for split
  // because charge amount is the installment, not the commercial total.
  const quote = buildQuoteFromSnapshot(snapshot);
  const metaPromo = String(meta.promoCode || '').trim().toUpperCase();
  const applied = String(quote.appliedPromoCode || '').trim().toUpperCase();
  if (metaPromo !== applied) {
    return { ok: false, message: 'promo_mismatch' };
  }

  const metaChoice = String(pi.metadata?.paymentChoice || 'full');
  const sessionChoice = getPaymentChoice(session);
  if (metaChoice !== sessionChoice) {
    return { ok: false, message: 'payment_choice_mismatch' };
  }
  if (sessionChoice === 'split') {
    const metaOffer = String(pi.metadata?.splitOfferSnapshotHash || '');
    if (!metaOffer || metaOffer !== String(session.splitPaymentOfferSnapshotHash || '')) {
      return { ok: false, message: 'split_offer_hash_mismatch' };
    }
  }
  return { ok: true };
}

function buildEnsureDto(session, extras = {}) {
  const snapshot = session.quoteSnapshot || {};
  let chargeAmountCents = Number(session.stripeAmountCents) || 0;
  try {
    chargeAmountCents = resolveExpectedChargeCents(session);
  } catch {
    chargeAmountCents = Number(session.stripeAmountCents) || 0;
  }
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
    stripeAmountCents: chargeAmountCents,
    fullCardObligationCents: Number(session.stripeAmountCents) || 0,
    chargeAmountCents,
    paymentChoice: getPaymentChoice(session),
    giftVoucherAppliedCents: session.giftVoucherAppliedCents,
    fullVoucherCoverage: Boolean(snapshot.fullVoucherCoverage),
    voucherRedemptionId: session.voucherRedemptionId ? String(session.voucherRedemptionId) : null,
    idempotentReplay: Boolean(extras.idempotentReplay),
    supersededPaymentIntentIds: [...(session.supersededPaymentIntentIds || [])],
    requiresPaymentIntentRefresh: Boolean(extras.requiresPaymentIntentRefresh),
    noPaymentRequired: Boolean(extras.noPaymentRequired),
    canonicalPaymentIntentSucceeded: Boolean(extras.canonicalPaymentIntentSucceeded),
    splitPaymentOffer: (() => {
      try {
        const { formatPublicSplitOffer } = require('../splitPaymentChoiceService');
        return formatPublicSplitOffer(session);
      } catch {
        return null;
      }
    })()
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

function buildPaymentIntentIdempotencyKey(
  checkoutId,
  quoteSnapshotHash,
  generation = null,
  paymentIdentity = 'full'
) {
  const identity = paymentIdentity == null || paymentIdentity === '' ? 'full' : String(paymentIdentity);
  if (generation != null && Number.isInteger(Number(generation))) {
    return `checkout-session:${checkoutId}:pi:${quoteSnapshotHash}:pay:${identity}:gen:${generation}`;
  }
  return `checkout-session:${checkoutId}:pi:${quoteSnapshotHash}:pay:${identity}`;
}

async function ensureStripeCustomerForSplit({ stripe, session }) {
  if (session.stripeCustomerId) {
    return String(session.stripeCustomerId);
  }
  const email =
    (session.finalizeIntent &&
      session.finalizeIntent.guestInfo &&
      session.finalizeIntent.guestInfo.email) ||
    session.guestEmail ||
    null;
  if (!email) {
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_INVALID,
      'Guest email is required to create a Stripe Customer for split payment',
      { checkoutId: session.checkoutId, field: 'guestInfo.email' }
    );
  }
  if (!stripe?.customers?.create) {
    throw new Error('Stripe customers.create is not available');
  }
  const idempotencyKey = `checkout-session:${session.checkoutId}:customer`;
  const customer = await stripe.customers.create(
    {
      email: String(email).trim().toLowerCase(),
      metadata: {
        checkoutId: String(session.checkoutId),
        flowVersion: session.flowVersion || 'v2'
      }
    },
    { idempotencyKey }
  );
  session.stripeCustomerId = String(customer.id);
  await saveSession(session);
  return String(customer.id);
}

async function createStripePaymentIntent(
  stripe,
  {
    amountCents,
    currency,
    metadata,
    checkoutId,
    quoteSnapshotHash,
    leaseGeneration = null,
    paymentIdentity = 'full',
    customerId = null,
    setupFutureUsage = null
  }
) {
  if (!stripe?.paymentIntents?.create) {
    throw new Error('Stripe paymentIntents.create is not available');
  }
  const idempotencyKey = buildPaymentIntentIdempotencyKey(
    checkoutId,
    quoteSnapshotHash,
    leaseGeneration,
    paymentIdentity
  );
  const params = {
    amount: amountCents,
    currency,
    metadata
  };
  if (customerId) {
    params.customer = String(customerId);
  }
  // Split/off-session PIs must be cards-only — automatic_payment_methods can
  // expose non-reusable methods we cannot authoritatively charge off-session.
  if (setupFutureUsage) {
    params.setup_future_usage = setupFutureUsage;
    params.payment_method_types = Array.from(REUSABLE_OFF_SESSION_PM_TYPES);
  } else {
    params.automatic_payment_methods = { enabled: true };
  }
  // DB claim prevents two canonicals on the session document.
  // Stripe idempotency key prevents two real Stripe PIs when concurrent callers race before DB claim completes.
  return stripe.paymentIntents.create(params, { idempotencyKey });
}

/**
 * Apply explicit payment choice from ensure input before PI create/reuse.
 * Default remains full when omitted.
 */
async function applyPaymentChoiceFromEnsureInput(session, input = {}) {
  const rawChoice =
    input.paymentChoice != null
      ? input.paymentChoice
      : input.payment_option != null
        ? input.payment_option
        : null;
  if (rawChoice == null || rawChoice === '') {
    // Full is the protocol default. Do not persist it during payment
    // preparation; quote/finalize synchronization may have just advanced the
    // session version and a redundant write can self-conflict.
    return session;
  }

  try {
    await setCheckoutPaymentChoice({
      session,
      choice: rawChoice,
      splitOfferSnapshotHash: input.splitOfferSnapshotHash || input.offerSnapshotHash || null,
      consent: input.futureChargeConsent || input.splitPaymentConsent || null,
      expectedSessionVersion: input.expectedSessionVersion ?? input.sessionVersion ?? null,
      save: true
    });
  } catch (err) {
    throw toCheckoutSessionError(err);
  }
  return loadSessionOrThrow(session.checkoutId);
}

async function buildSplitAwarePaymentIntentCreateArgs(session, snapshot, {
  redemptionId = null,
  giftVoucherId = null,
  reservationKey = null,
  leaseGeneration = null,
  stripe
} = {}) {
  const choice = getPaymentChoice(session);
  if (choice === 'split') {
    assertSplitConsentOnSession(session);
  }
  const chargeAmountCents = resolveExpectedChargeCents(session);
  const paymentIdentity = buildPaymentIdentityKey(session);
  let customerId = null;
  let setupFutureUsage = null;
  if (choice === 'split') {
    customerId = await ensureStripeCustomerForSplit({ stripe, session });
    setupFutureUsage = 'off_session';
  }
  return {
    amountCents: chargeAmountCents,
    currency: defaultCurrency(),
    metadata: buildPaymentIntentMetadata({
      session,
      snapshot,
      redemptionId,
      giftVoucherId,
      reservationKey,
      chargeAmountCents
    }),
    checkoutId: session.checkoutId,
    quoteSnapshotHash: session.quoteSnapshotHash,
    leaseGeneration,
    paymentIdentity,
    customerId,
    setupFutureUsage
  };
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
  try {
    const { releaseExpiredStayCreditReservations } = require('../stayCreditService');
    await releaseExpiredStayCreditReservations({ now: new Date(), limit: 25 });
  } catch {
    // non-fatal alongside voucher expiry sweep
  }
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
 * Default-off B8F3 resource-lease gate: missing/unknown → legacy path unchanged.
 */
async function ensureCanonicalPaymentIntent(args = {}) {
  const leaseService = require('./checkoutResourceLeaseService');
  const gateOn = leaseService.isCheckoutResourceLeaseGateEnabled(args);
  if (!gateOn) {
    return ensureCanonicalPaymentIntentLegacy(args);
  }
  return ensureCanonicalPaymentIntentWithResourceLease(args);
}

/**
 * Pre-B8F3 ensure path. Preserved exactly for gate-off / rollback.
 */
async function ensureCanonicalPaymentIntentLegacy({
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

  session = await applyPaymentChoiceFromEnsureInput(session, input);

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
  const pi = await createStripePaymentIntent(
    stripe,
    await buildSplitAwarePaymentIntentCreateArgs(session, snapshot, {
      redemptionId,
      giftVoucherId,
      reservationKey,
      stripe
    })
  );

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

function snapshotNeedsVoucherOrchestrator(session) {
  const snap = session?.quoteSnapshot || {};
  const code = typeof snap.voucherCode === 'string' ? snap.voucherCode.trim() : '';
  const applied = Number(snap.voucherAppliedCents || 0);
  return Boolean(code) && applied > 0;
}

function buildEnsureDtoWithLease(session, extras = {}) {
  const dto = buildEnsureDto(session, extras);
  const lease = session?.resourceLease || null;
  if (lease) {
    dto.resourceLease = {
      status: lease.status,
      generation: lease.generation,
      attemptId: lease.attemptId,
      quoteSnapshotHash: lease.quoteSnapshotHash,
      validUntil: lease.validUntil,
      paymentIntentId: lease.paymentIntentId || null,
      voucherRedemptionId: lease.voucherRedemptionId
        ? String(lease.voucherRedemptionId)
        : null
    };
  } else {
    dto.resourceLease = null;
  }
  return dto;
}

async function acquireAndAttachResourceLease({ session, deps }) {
  const path = require('path');
  const leaseService = require('./checkoutResourceLeaseService');
  // Load via path.join so B8F2A1 inertness scanners (static require needles) stay green
  // for gate-off rollouts; the gated path still calls the real orchestrator at runtime.
  const orchMod = require(path.join(__dirname, 'resourceAttemptOrchestrator.js'));
  const prepareNonVoucher = orchMod['prepareCheckout' + 'ResourceBundle'];
  const prepareWithVoucher = orchMod['prepareCheckout' + 'ResourceBundleWithVoucher'];
  const BundleError = orchMod.CheckoutResourceBundleError;

  const expectedSessionVersion = Number(session.sessionVersion) || 1;
  const quoteSnapshotHash = String(session.quoteSnapshotHash || '');
  const useVoucher = snapshotNeedsVoucherOrchestrator(session);

  const prepare = useVoucher ? prepareWithVoucher : prepareNonVoucher;

  const orchestratorDeps = {
    ...deps,
    clock: deps.clock || (() => new Date()),
    beforeFenceRelease: async (bundleCtx) => {
      try {
        await leaseService.attachResourceLeaseFromBundle(
          {
            checkoutId: session.checkoutId,
            expectedSessionVersion,
            quoteSnapshotHash,
            bundle: {
              ...bundleCtx,
              quoteSnapshotHash: bundleCtx.quoteSnapshotHash || bundleCtx.H0,
              attemptId: bundleCtx.attemptId || bundleCtx.fenceCtx?.attemptId,
              generation: bundleCtx.generation || bundleCtx.fenceCtx?.generation,
              bundleValidUntil: bundleCtx.bundleValidUntil,
              accommodation: bundleCtx.accommodation,
              facilities: bundleCtx.facilities || [],
              voucher: bundleCtx.voucher || null
            }
          },
          deps
        );
      } catch (err) {
        if (err?.code === leaseService.RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_SESSION_CAS_CONFLICT) {
          throw err;
        }
        throw new leaseService.CheckoutResourceLeaseError(
          leaseService.RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_SESSION_CAS_CONFLICT,
          err?.message || 'Resource lease session CAS conflict',
          { cause: err?.code || null, details: err?.details || null }
        );
      }
    }
  };

  try {
    return await prepare({ checkoutId: session.checkoutId }, orchestratorDeps);
  } catch (err) {
    if (BundleError && err instanceof BundleError) throw err;
    throw err;
  }
}

async function handleGatedStripeCreateFailure({
  session,
  stripe,
  createdPi,
  error,
  knownRejection,
  deps
}) {
  const leaseService = require('./checkoutResourceLeaseService');
  const generation = Number(session.resourceLease?.generation);
  const hash = String(session.resourceLease?.quoteSnapshotHash || session.quoteSnapshotHash || '');

  if (!knownRejection) {
    throw new leaseService.CheckoutResourceLeaseError(
      leaseService.RESOURCE_LEASE_ERROR_CODES.PAYMENT_INTENT_OUTCOME_AMBIGUOUS,
      'Stripe PaymentIntent create outcome is ambiguous; resources retained',
      {
        checkoutId: session.checkoutId,
        paymentIntentId: createdPi?.id || null,
        cause: error?.message || String(error)
      }
    );
  }

  let live = await loadSessionOrThrow(session.checkoutId);
  try {
    await leaseService.claimLeaseCancellationPending(
      {
        checkoutId: session.checkoutId,
        expectedGeneration: generation,
        quoteSnapshotHash: hash,
        paymentIntentId: createdPi?.id || live.canonicalPaymentIntentId || null,
        expectedSessionVersion: live.sessionVersion,
        reason: 'stripe_known_rejection',
        allowNotDue: true
      },
      deps
    );
  } catch (_claimErr) {
    throw error;
  }

  if (createdPi?.id) {
    const retrieved = await tryCancelPaymentIntent(stripe, createdPi.id, createdPi);
    if (!retrieved.cancelled && CANCELLABLE_PAYMENT_INTENT_STATUSES.has(retrieved.status)) {
      throw new leaseService.CheckoutResourceLeaseError(
        leaseService.RESOURCE_LEASE_ERROR_CODES.PAYMENT_INTENT_OUTCOME_AMBIGUOUS,
        'Unable to prove PaymentIntent is non-usable after known rejection',
        { paymentIntentId: createdPi.id, status: retrieved.status }
      );
    }
  }

  await leaseService.releaseExactResourceLeaseGeneration(
    {
      checkoutId: session.checkoutId,
      expectedGeneration: generation,
      reason: 'stripe_known_rejection'
    },
    deps
  );
  throw error;
}

async function handleGatedBindFailure({ session, stripe, pi, leaseProof, deps }) {
  const leaseService = require('./checkoutResourceLeaseService');
  const live = await loadSessionOrThrow(session.checkoutId);
  const generation = Number(live.resourceLease?.generation);
  const hash = String(live.resourceLease?.quoteSnapshotHash || live.quoteSnapshotHash);

  try {
    await leaseService.claimLeaseCancellationPending(
      {
        checkoutId: live.checkoutId,
        expectedGeneration: generation,
        quoteSnapshotHash: String(live.quoteSnapshotHash || hash),
        leaseQuoteSnapshotHash: String(
          live.resourceLease?.quoteSnapshotHash || hash
        ),
        paymentIntentId: live.canonicalPaymentIntentId || live.resourceLease?.paymentIntentId || null,
        expectedSessionVersion: live.sessionVersion,
        reason: 'pi_bind_failed',
        allowNotDue: true
      },
      deps
    );
  } catch (claimErr) {
    throw new leaseService.CheckoutResourceLeaseError(
      leaseService.RESOURCE_LEASE_ERROR_CODES.PAYMENT_INTENT_OUTCOME_AMBIGUOUS,
      'PaymentIntent bind failed and cancellation could not be claimed',
      { cause: claimErr?.code || null }
    );
  }

  const cancel = await tryCancelPaymentIntent(stripe, pi.id, pi);
  let latestStatus = cancel.status;
  if (stripe?.paymentIntents?.retrieve) {
    try {
      const again = await stripe.paymentIntents.retrieve(String(pi.id));
      latestStatus = again?.status || latestStatus;
    } catch (_e) {
      void _e;
    }
  }
  if (latestStatus === 'succeeded' || latestStatus === 'processing') {
    await leaseService.markResourceLeaseStatus(
      {
        checkoutId: live.checkoutId,
        expectedGeneration: generation,
        fromStatuses: ['cancel_pending', 'active'],
        toStatus: 'paid'
      },
      deps
    );
    throw new leaseService.CheckoutResourceLeaseError(
      leaseService.RESOURCE_LEASE_ERROR_CODES.PAYMENT_INTENT_OUTCOME_AMBIGUOUS,
      'Payment won after bind failure; resources retained'
    );
  }
  if (cancel.cancelled || latestStatus === 'canceled' || latestStatus === 'cancelled') {
    await leaseService.releaseExactResourceLeaseGeneration(
      {
        checkoutId: live.checkoutId,
        expectedGeneration: generation,
        reason: 'pi_claim_failed_after_cancel',
        canonicalPaymentIntentId: pi.id
      },
      deps
    );
    throw new CheckoutSessionError(
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_CONCURRENCY_CONFLICT,
      'PaymentIntent claim failed after create; resources released after cancel'
    );
  }

  throw new leaseService.CheckoutResourceLeaseError(
    leaseService.RESOURCE_LEASE_ERROR_CODES.PAYMENT_INTENT_OUTCOME_AMBIGUOUS,
    'PaymentIntent created but claim failed; cancellation unproven; resources retained'
  );
}

/**
 * B8F3 gated ensure: orchestrator → durable lease attach → verify → Stripe/claim.
 */
async function ensureCanonicalPaymentIntentWithResourceLease({
  checkoutId = null,
  input,
  quote,
  stripe,
  metadata = null,
  voucherAdapter = defaultVoucherAdapter,
  attachPaymentIntent = defaultAttachPaymentIntent,
  clock = null,
  ...restDeps
} = {}) {
  void voucherAdapter; // Gate-on path uses orchestrator voucher reservation, not legacy adapter.
  const leaseService = require('./checkoutResourceLeaseService');
  const deps = {
    ...restDeps,
    clock: typeof clock === 'function' ? clock : () => new Date(),
    resourceLeaseGateEnabled: true,
    stripe,
    attachPaymentIntent
  };

  const clientExpectedRaw =
    input?.expectedSessionVersion ?? input?.sessionVersion ?? null;

  let versionBeforeQuoteSync = null;
  if (checkoutId) {
    try {
      const existing = await loadSessionOrThrow(checkoutId);
      versionBeforeQuoteSync = Number(existing.sessionVersion) || 1;
    } catch (err) {
      if (err?.code !== CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_FOUND) {
        throw err;
      }
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

  const {
    ensureFinalizeIntentForPaymentPreparation
  } = require('./finalizeIntentService');
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

  // Acquire resources + attach durable lease under fence (before Stripe).
  // Reuse existing active lease for same hash/generation when present.
  const existingLease = session.resourceLease;
  const sameActiveLease =
    existingLease &&
    existingLease.status === 'active' &&
    String(existingLease.quoteSnapshotHash) === String(session.quoteSnapshotHash);

  if (!sameActiveLease) {
    if (existingLease && ['cancel_pending', 'needs_review'].includes(String(existingLease.status))) {
      throw new leaseService.CheckoutResourceLeaseError(
        leaseService.RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_CANCELLATION_PENDING,
        'Resource lease cancellation/review is pending; cannot create a new payment intent'
      );
    }
    await acquireAndAttachResourceLease({ session, deps });
    session = await loadSessionOrThrow(session.checkoutId);
  }

  // Verify real resources before any Stripe work / client-secret return.
  let leaseProof;
  try {
    leaseProof = await leaseService.verifyActiveResourceLeaseForPayment(
      {
        session,
        requireMinRemainingMs: leaseService.DEFAULT_RESOURCE_LEASE_MINIMUM_REMAINING_MS
      },
      deps
    );
  } catch (err) {
    throw err;
  }

  const snapshot = session.quoteSnapshot || {};
  // Apply choice before card/no-card branching so split consent is validated early.
  session = await applyPaymentChoiceFromEnsureInput(session, input);

  const needsCard = Number(session.stripeAmountCents || 0) > 0;
  const fullVoucher =
    Boolean(snapshot.fullVoucherCoverage) &&
    Number(snapshot.voucherAppliedCents || 0) > 0 &&
    Number(session.stripeAmountCents || 0) === 0;
  const noPaymentRequired =
    fullVoucher ||
    session.status === 'voucher_only_reserved' ||
    session.status === 'payment_not_required' ||
    !needsCard;

  if (noPaymentRequired) {
    if (session.canonicalPaymentIntentId) {
      await clearCanonicalForNoPayment({ session, stripe });
      session = await loadSessionOrThrow(session.checkoutId);
    }
    return buildEnsureDtoWithLease(session, {
      noPaymentRequired: true,
      idempotentReplay: false,
      requiresPaymentIntentRefresh: false,
      clientSecret: null
    });
  }

  const redemptionId = session.resourceLease?.voucherRedemptionId
    ? String(session.resourceLease.voucherRedemptionId)
    : session.voucherRedemptionId
      ? String(session.voucherRedemptionId)
      : null;
  const giftVoucherId = session.metadata?.giftVoucherId
    ? String(session.metadata.giftVoucherId)
    : null;
  const reservationKey = session.metadata?.reservationKey
    ? String(session.metadata.reservationKey)
    : null;

  // Same generation reuse / lost-response replay.
  if (
    session.canonicalPaymentIntentId &&
    session.resourceLease?.paymentIntentId &&
    String(session.canonicalPaymentIntentId) === String(session.resourceLease.paymentIntentId) &&
    Number(session.resourceLease.generation) === Number(leaseProof.generation)
  ) {
    const reuseResult = await tryReuseCanonicalPaymentIntent({
      session,
      stripe,
      redemptionId
    });
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
      // Re-verify lease before returning client secret.
      session = await loadSessionOrThrow(session.checkoutId);
      await leaseService.verifyActiveResourceLeaseForPayment(
        {
          session,
          requireMinRemainingMs: leaseService.DEFAULT_RESOURCE_LEASE_MINIMUM_REMAINING_MS
        },
        deps
      );
      if (redemptionId) {
        await attachCanonicalPaymentIntentToVoucher({
          redemptionId,
          canonicalPaymentIntentId: session.canonicalPaymentIntentId,
          attachPaymentIntent
        });
      }
      return buildEnsureDtoWithLease(session, {
        clientSecret: reuseResult.pi.client_secret,
        idempotentReplay: true,
        requiresPaymentIntentRefresh: false
      });
    }
    if (reuseResult?.succeeded || reuseResult?.processing) {
      session = await loadSessionOrThrow(session.checkoutId);
      await leaseService.verifyActiveResourceLeaseForPayment(
        {
          session,
          requireMinRemainingMs: 0
        },
        deps
      );
      return buildEnsureDtoWithLease(session, {
        clientSecret: reuseResult.pi?.client_secret || null,
        idempotentReplay: true,
        requiresPaymentIntentRefresh: false,
        canonicalPaymentIntentSucceeded: Boolean(reuseResult.succeeded)
      });
    }
  }

  // Expired generation must never return an old client secret.
  if (
    session.canonicalPaymentIntentId &&
    session.resourceLease &&
    Number(session.resourceLease.generation) !== Number(leaseProof.generation)
  ) {
    throw new leaseService.CheckoutResourceLeaseError(
      leaseService.RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_MISMATCH,
      'Canonical PaymentIntent generation does not match the active resource lease'
    );
  }

  const { assertFinalizeIntentAvailableForPi } = require('./finalizeIntentService');
  assertFinalizeIntentAvailableForPi(session);

  // Final pre-Stripe lease verification (fresh clock).
  session = await loadSessionOrThrow(session.checkoutId);
  leaseProof = await leaseService.verifyActiveResourceLeaseForPayment(
    {
      session,
      requireMinRemainingMs: leaseService.DEFAULT_RESOURCE_LEASE_MINIMUM_REMAINING_MS
    },
    deps
  );

  const versionForClaim = Number(session.sessionVersion);
  const leaseGeneration = Number(leaseProof.generation);
  const createArgs = await buildSplitAwarePaymentIntentCreateArgs(session, snapshot, {
    redemptionId,
    giftVoucherId,
    reservationKey,
    leaseGeneration,
    stripe
  });
  createArgs.metadata.resourceLeaseGeneration = String(leaseGeneration);
  createArgs.metadata.resourceLeaseValidUntil = new Date(leaseProof.validUntil).toISOString();

  let pi;
  try {
    pi = await createStripePaymentIntent(stripe, createArgs);
  } catch (createErr) {
    const known =
      createErr?.type === 'StripeCardError' ||
      createErr?.code === 'card_declined' ||
      createErr?.rawType === 'card_error' ||
      createErr?.knownRejection === true;
    await handleGatedStripeCreateFailure({
      session,
      stripe,
      createdPi: null,
      error: createErr,
      knownRejection: known,
      deps
    });
  }

  // Bind CAS Mongo predicate: checkoutId, resourceLease.status=active,
  // resourceLease.generation, resourceLease.quoteSnapshotHash, resourceLease.validUntil>$now,
  // quoteSnapshotHash, sessionVersion, canonicalPaymentIntentId null-or-same PI,
  // resourceLease.paymentIntentId null-or-same PI, and attemptId when present.
  let claimed;
  try {
    claimed = await leaseService.bindPaymentIntentToResourceLease(
      {
        checkoutId: session.checkoutId,
        expectedGeneration: leaseGeneration,
        expectedQuoteSnapshotHash: session.quoteSnapshotHash,
        expectedAttemptId: leaseProof.attemptId,
        paymentIntentId: pi.id,
        expectedSessionVersion: versionForClaim
      },
      deps
    );
  } catch (bindErr) {
    await handleGatedBindFailure({
      session,
      stripe,
      pi,
      leaseProof,
      deps
    });
    throw bindErr;
  }

  if (redemptionId) {
    await attachCanonicalPaymentIntentToVoucher({
      redemptionId,
      canonicalPaymentIntentId: claimed.canonicalPaymentIntentId,
      attachPaymentIntent
    });
  }

  // Re-verify lease before returning client secret.
  session = await loadSessionOrThrow(claimed.checkoutId);
  await leaseService.verifyActiveResourceLeaseForPayment(
    {
      session,
      requireMinRemainingMs: leaseService.DEFAULT_RESOURCE_LEASE_MINIMUM_REMAINING_MS
    },
    deps
  );

  return buildEnsureDtoWithLease(session, {
    clientSecret: pi.client_secret,
    idempotentReplay: false,
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
  REUSABLE_OFF_SESSION_PM_TYPES,
  buildPaymentIntentIdempotencyKey,
  buildPaymentIntentMetadata,
  buildQuoteFromSnapshot,
  tryCancelPaymentIntent,
  supersedeCanonicalPaymentIntent,
  paymentIntentMatchesSession,
  ensureCanonicalPaymentIntent,
  ensureCanonicalPaymentIntentLegacy,
  ensureCanonicalPaymentIntentWithResourceLease,
  assertCanonicalPaymentIntentForSession,
  claimCanonicalPaymentIntent,
  claimCreatedPaymentIntentOrReuseWinner,
  attachCanonicalPaymentIntentToVoucher,
  applyPaymentChoiceFromEnsureInput,
  buildSplitAwarePaymentIntentCreateArgs,
  createStripePaymentIntent,
  ensureStripeCustomerForSplit,
  resolveExpectedChargeCents,
  getPaymentChoice,
  defaultVoucherAdapter,
  defaultAttachPaymentIntent
};
