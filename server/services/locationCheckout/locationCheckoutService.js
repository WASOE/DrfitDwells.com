const mongoose = require('mongoose');
const Booking = require('../../models/Booking');
const AvailabilityBlock = require('../../models/AvailabilityBlock');
const Cabin = require('../../models/Cabin');
const CabinType = require('../../models/CabinType');
const LocationBooking = require('../../models/LocationBooking');
const PaymentResolutionIssue = require('../../models/PaymentResolutionIssue');
const { createDomainError } = require('../ops/domain/errors');
const { resolveLocationTargets } = require('../ops/domain/locationInventoryService');
const { normalizeGuestStayRange } = require('../publicAvailabilityService');
const { normalizeDateToSofiaDayStart } = require('../../utils/dateTime');
const { canUseMongoTransactions } = require('../../utils/mongoTransactions');
const { openManualReviewItem } = require('../ops/ingestion/manualReviewService');
const { buildPublicLocationQuote } = require('../locationQuote/locationQuoteService');
const {
  buildPerTargetBuyoutShares
} = require('../locationQuote/locationQuotePricing');
const { normalizeRoomAllocation } = require('../../models/schemas/roomAllocationSchema');
const {
  mintCheckoutSessionId,
  createCheckoutHolds,
  releaseCheckoutHolds,
  listActiveCheckoutHolds
} = require('./locationCheckoutHoldService');
const {
  sendLocationBookingConfirmationEmail,
  sendLocationBookingInternalNotification
} = require('./locationCheckoutEmailService');
const unitNightClaimService = require('../inventory/unitNightClaimService');
const {
  ensureUnitNightClaimsShadow,
  I2_SOURCES
} = require('../inventory/ensureUnitNightClaimsShadow');
const {
  ensureUnitNightClaimsReleasedShadow,
  LIFECYCLE_SOURCES
} = require('../inventory/ensureUnitNightClaimsReleasedShadow');
const {
  ensureCabinNightClaimsShadow,
  S1_SOURCES: CABIN_S1_SOURCES
} = require('../inventory/ensureCabinNightClaimsShadow');
const {
  ensureCabinNightClaimsReleasedShadow
} = require('../inventory/ensureCabinNightClaimsReleasedShadow');
const {
  linkSavedQuoteToCheckout,
  markSavedQuoteConverted,
  scheduleSavedQuoteTask
} = require('../savedQuotes/savedQuoteService');
const { captureQuoteContactConsent } = require('../savedQuotes/quoteContactConsentService');
const { formatSofiaDateOnly } = require('../../utils/dateTime');

function defaultCurrency() {
  return (process.env.STRIPE_CURRENCY || 'eur').toLowerCase();
}

function parseGuestInfo(raw) {
  const firstName = String(raw?.firstName || '').trim();
  const lastName = String(raw?.lastName || '').trim();
  const email = String(raw?.email || '').trim().toLowerCase();
  const phone = String(raw?.phone || '').trim() || null;
  if (!firstName || !lastName || !email) {
    throw createDomainError('validation', 'guestInfo firstName, lastName, and email are required', null, 400);
  }
  return { firstName, lastName, email, phone };
}

async function loadEntityMaps(inventory) {
  const singleCabinIds = inventory.targets
    .filter((t) => t.kind === 'single_cabin')
    .map((t) => t.cabinId);
  const cabinTypeIds = [
    ...new Set(inventory.targets.filter((t) => t.kind === 'unit').map((t) => String(t.cabinTypeId)))
  ];

  const [cabins, cabinTypes] = await Promise.all([
    singleCabinIds.length ? Cabin.find({ _id: { $in: singleCabinIds } }).lean() : [],
    cabinTypeIds.length ? CabinType.find({ _id: { $in: cabinTypeIds } }).lean() : []
  ]);

  const entityByTargetKey = new Map();
  for (const cabin of cabins) {
    entityByTargetKey.set(`cabin:${cabin._id}`, cabin);
  }
  for (const cabinType of cabinTypes) {
    entityByTargetKey.set(`cabinType:${cabinType._id}`, cabinType);
  }
  return { cabins, cabinTypes, entityByTargetKey };
}

function buildChildRoomAllocation(masterAllocation, target) {
  if (!masterAllocation) return null;
  const assignments = (masterAllocation.assignments || []).filter((row) => {
    if (row.targetKey && row.targetKey === target.targetKey) return true;
    const label = String(row.accommodationName || '').toLowerCase();
    return label && String(target.label || '').toLowerCase().includes(label);
  });
  if (!assignments.length && !masterAllocation.notes) return null;
  return {
    notes: masterAllocation.notes || null,
    assignments
  };
}

function buildChildBookingPayload({
  target,
  share,
  locationBookingId,
  checkInDate,
  checkOutDate,
  adults,
  children,
  guestInfo,
  roomAllocation,
  checkoutSessionId
}) {
  const bookingData = {
    adults: 1,
    children: 0,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    status: 'confirmed',
    guestInfo,
    totalPrice: share.childPriceShare,
    subtotalPrice: share.childPriceShare,
    childPriceShare: share.childPriceShare,
    locationBookingId,
    suppressGuestEmail: true,
    excludeFromRevenueReporting: true,
    isMasterBooking: false,
    paymentMethod: 'stripe',
    stripePaidAmountCents: 0,
    totalValueCents: 0,
    provenance: {
      source: 'website',
      channel: 'location_buyout_child',
      createdByRoute: 'POST /api/public/location-checkout/finalize'
    },
    roomAllocation: buildChildRoomAllocation(roomAllocation, target) || undefined
  };

  if (target.kind === 'single_cabin') {
    bookingData.cabinId = target.cabinId;
  } else {
    bookingData.cabinTypeId = target.cabinTypeId;
    bookingData.unitId = target.unitId;
  }

  void checkoutSessionId;
  return bookingData;
}

async function ensureLocationChildShadowClaims({
  childBookingIds,
  paymentIntentId = null,
  checkoutSessionId = null,
  ensureFn = ensureUnitNightClaimsShadow,
  ensureCabinFn = ensureCabinNightClaimsShadow,
  stripePaymentVerified = true
}) {
  if (!Array.isArray(childBookingIds) || childBookingIds.length === 0) {
    return [];
  }
  const children = await Booking.find({ _id: { $in: childBookingIds } });
  const results = [];
  for (const child of children) {
    // Post-canonical only — never inside the location txn. Failures are isolated.
    // eslint-disable-next-line no-await-in-loop
    const outcome = await ensureFn({
      booking: child,
      source: I2_SOURCES.LOCATION_CHILD,
      paymentIntentId,
      checkoutId: checkoutSessionId,
      stripePaymentVerified: paymentIntentId ? Boolean(stripePaymentVerified) : null,
      throwOnFailure: false
    });
    results.push(outcome);
    try {
      // eslint-disable-next-line no-await-in-loop
      await ensureCabinFn({
        booking: child,
        source: CABIN_S1_SOURCES.LOCATION_CHILD,
        throwOnFailure: false
      });
    } catch {
      /* cabin shadow must not alter location child canonical outcome */
    }
  }
  return results;
}

async function recordLocationCheckoutFailure({
  paymentIntentId,
  checkoutSessionId,
  guestInfo,
  errorCode,
  errorSummary,
  paymentIntent
}) {
  if (!paymentIntentId) return null;

  const issue = await PaymentResolutionIssue.findOneAndUpdate(
    { paymentIntentId: String(paymentIntentId).trim() },
    {
      $set: {
        status: 'needs_review',
        issueType: 'location_checkout_finalization_failure',
        amount: typeof paymentIntent?.amount === 'number' ? paymentIntent.amount / 100 : null,
        currency: paymentIntent?.currency ? String(paymentIntent.currency).toLowerCase() : null,
        guest: {
          name: [guestInfo?.firstName, guestInfo?.lastName].filter(Boolean).join(' ').trim() || null,
          email: guestInfo?.email || null,
          phone: guestInfo?.phone || null
        },
        bookingAttempt: {
          entityType: 'location_buyout',
          checkIn: null,
          checkOut: null,
          guests: null
        },
        errorSummary,
        errorCode,
        metadata: {
          sourceRoute: 'POST /api/public/location-checkout/finalize',
          checkoutSessionId,
          paymentIntentStatus: paymentIntent?.status || null
        }
      },
      $setOnInsert: { resolvedAt: null, resolutionNote: null }
    },
    { new: true, upsert: true }
  );

  await openManualReviewItem({
    category: 'payment_finalization_failure',
    severity: 'high',
    entityType: 'PaymentResolutionIssue',
    entityId: String(issue._id),
    title: 'Whole-Valley checkout finalization failed after payment',
    details: errorSummary || 'Location checkout finalize failed',
    provenance: {
      source: 'location_checkout_finalize',
      sourceReference: checkoutSessionId || paymentIntentId
    },
    evidence: { errorCode, checkoutSessionId }
  });

  return issue;
}

async function cleanupPartialLocationFinalize({
  locationBookingId,
  childBookingIds,
  checkoutSessionId
}) {
  if (childBookingIds?.length) {
    for (const childId of childBookingIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await ensureUnitNightClaimsReleasedShadow({
          bookingId: childId,
          lifecycleSource: LIFECYCLE_SOURCES.LOCATION_ROLLBACK
        });
      } catch {
        /* nonfatal to rollback */
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await ensureCabinNightClaimsReleasedShadow({
          bookingId: childId,
          lifecycleSource: LIFECYCLE_SOURCES.LOCATION_ROLLBACK
        });
      } catch {
        /* nonfatal to rollback */
      }
    }
    await Booking.deleteMany({ _id: { $in: childBookingIds } });
  }
  if (locationBookingId) {
    await LocationBooking.deleteOne({ _id: locationBookingId });
  }
  if (checkoutSessionId) {
    await releaseCheckoutHolds(checkoutSessionId, 'location_checkout_finalize_cleanup');
  }
}

async function createLocationCheckoutPaymentIntent(body, { stripe }) {
  if (!stripe) {
    throw createDomainError('validation', 'Card payments are not configured', null, 503);
  }

  const locationKey = 'valley';
  const checkoutSessionId = mintCheckoutSessionId();
  const roomAllocation = normalizeRoomAllocation(body?.roomAllocation);

  const quote = await buildPublicLocationQuote(locationKey, {
    checkIn: body.checkIn,
    checkOut: body.checkOut,
    adults: body.adults,
    children: body.children,
    roomAllocation
  });

  if (!quote.available) {
    throw createDomainError(
      'validation',
      quote.unavailableReason || 'The Valley is not available for your selected dates',
      { conflicts: quote.conflicts || [] },
      409
    );
  }

  const { startDate, endDate } = normalizeGuestStayRange(body.checkIn, body.checkOut);
  const inventory = await resolveLocationTargets(locationKey);

  let holdsCreated = false;
  try {
    await createCheckoutHolds({
      checkoutSessionId,
      locationKey,
      startDate,
      endDate,
      targets: inventory.targets
    });
    holdsCreated = true;

    const amountCents = Math.round(quote.totalPrice * 100);
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: defaultCurrency(),
      automatic_payment_methods: { enabled: true },
      metadata: {
        flowVersion: 'location_buyout_v1',
        checkoutSessionId,
        locationKey,
        checkIn: startDate.toISOString(),
        checkOut: endDate.toISOString(),
        totalPriceCents: String(amountCents),
        adults: String(quote.adults || body.adults || 1),
        children: String(quote.children || body.children || 0)
      }
    });

    const holdExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    scheduleSavedQuoteTask('link-location-checkout', () =>
      linkSavedQuoteToCheckout({
        checkoutId: checkoutSessionId,
        checkoutExpiresAt: holdExpiresAt,
        sessionKey: body.funnelSessionKey || null,
        visitorKey: body.funnelVisitorKey || null,
        locationKey,
        checkInDateOnly: formatSofiaDateOnly(startDate),
        checkOutDateOnly: formatSofiaDateOnly(endDate),
        adults: quote.adults || body.adults || 1,
        children: quote.children || body.children || 0,
        quotedTotalCents: amountCents,
        guestEmail: body.guestEmail || body.guestInfo?.email || null
      })
    );

    try {
      const {
        recordServerCheckoutStarted,
        recordServerPaymentEvent
      } = require('../conversion/funnelEventService');
      const checkInDateOnly = formatSofiaDateOnly(startDate);
      const checkOutDateOnly = formatSofiaDateOnly(endDate);
      void recordServerCheckoutStarted({
        checkoutId: checkoutSessionId,
        paymentId: paymentIntent.id,
        sessionKey: body.funnelSessionKey || null,
        visitorKey: body.funnelVisitorKey || null,
        locationId: locationKey,
        propertyKind: 'valley',
        checkInDateOnly,
        checkOutDateOnly,
        adults: quote.adults || body.adults || 1,
        children: quote.children || body.children || 0,
        quotedTotalCents: amountCents
      }).catch(() => {});
      void recordServerPaymentEvent({
        eventName: 'payment_started',
        paymentId: paymentIntent.id,
        stateCode: 'requires_payment_method',
        sessionKey: body.funnelSessionKey || null,
        visitorKey: body.funnelVisitorKey || null,
        checkoutId: checkoutSessionId,
        locationId: locationKey,
        propertyKind: 'valley',
        checkInDateOnly,
        checkOutDateOnly,
        quotedTotalCents: amountCents,
        origin: 'api'
      }).catch(() => {});
    } catch {
      /* analytics must never block checkout */
    }

    return {
      checkoutSessionId,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      quote
    };
  } catch (err) {
    if (holdsCreated) {
      await releaseCheckoutHolds(checkoutSessionId, 'location_checkout_pi_failed');
    }
    throw err;
  }
}

async function finalizeLocationCheckout(body, { stripe, ensureUnitNightClaimsShadowFn = null } = {}) {
  const checkoutSessionId = String(body?.checkoutSessionId || '').trim();
  const paymentIntentId = String(body?.paymentIntentId || '').trim();
  const ensureFn = ensureUnitNightClaimsShadowFn || ensureUnitNightClaimsShadow;
  if (!checkoutSessionId || !paymentIntentId) {
    throw createDomainError(
      'validation',
      'checkoutSessionId and paymentIntentId are required',
      null,
      400
    );
  }

  const existing = await LocationBooking.findOne({ checkoutSessionId }).lean();
  if (existing) {
    try {
      const {
        recordServerPaymentEvent,
        recordLocationBookingFunnelConversion
      } = require('../conversion/funnelEventService');
      void recordServerPaymentEvent({
        eventName: 'payment_succeeded',
        paymentId: paymentIntentId,
        stateCode: 'succeeded',
        sessionKey: body.funnelSessionKey || null,
        visitorKey: body.funnelVisitorKey || null,
        checkoutId: checkoutSessionId,
        locationId: 'valley',
        propertyKind: 'valley',
        origin: 'api'
      }).catch(() => {});
      void recordLocationBookingFunnelConversion(existing, {
        funnelSessionKey: body.funnelSessionKey || null,
        funnelVisitorKey: body.funnelVisitorKey || null,
        checkoutId: checkoutSessionId,
        paymentId: paymentIntentId
      }).catch(() => {});
    } catch {
      /* ignore */
    }
    await ensureLocationChildShadowClaims({
      childBookingIds: existing.childBookingIds || [],
      paymentIntentId,
      checkoutSessionId,
      ensureFn,
      stripePaymentVerified: true
    });
    return {
      idempotentReplay: true,
      locationBookingId: String(existing._id),
      childBookingIds: (existing.childBookingIds || []).map(String),
      status: existing.status
    };
  }

  const guestInfo = parseGuestInfo(body.guestInfo);
  const roomAllocation = normalizeRoomAllocation(body?.roomAllocation);
  const adults = Math.max(1, parseInt(body.adults, 10) || 1);
  const children = Math.max(0, parseInt(body.children, 10) || 0);

  let paymentIntent = null;
  if (stripe) {
    paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status !== 'succeeded') {
      throw createDomainError(
        'validation',
        `Payment not completed (status: ${paymentIntent.status})`,
        null,
        402
      );
    }
    if (String(paymentIntent.metadata?.checkoutSessionId || '') !== checkoutSessionId) {
      throw createDomainError('validation', 'Payment session does not match checkout', null, 400);
    }
  }

  const holds = await listActiveCheckoutHolds(checkoutSessionId);
  if (!holds.length) {
    throw createDomainError(
      'validation',
      'Checkout holds have expired or are missing. Please restart checkout.',
      null,
      409
    );
  }

  const checkIn = paymentIntent?.metadata?.checkIn || body.checkIn;
  const checkOut = paymentIntent?.metadata?.checkOut || body.checkOut;
  const { startDate: checkInDate, endDate: checkOutDate } = normalizeGuestStayRange(checkIn, checkOut);

  const quote = await buildPublicLocationQuote('valley', {
    checkIn,
    checkOut,
    adults,
    children,
    roomAllocation,
    excludeCheckoutSessionId: checkoutSessionId
  });

  if (!quote.available) {
    await recordLocationCheckoutFailure({
      paymentIntentId,
      checkoutSessionId,
      guestInfo,
      errorCode: 'LOCATION_NOT_AVAILABLE_AT_FINALIZE',
      errorSummary: quote.unavailableReason || 'Valley unavailable at finalize',
      paymentIntent
    });
    throw createDomainError(
      'validation',
      quote.unavailableReason || 'The Valley is no longer available for these dates',
      null,
      409
    );
  }

  const expectedCents = Math.round(quote.totalPrice * 100);
  if (paymentIntent && paymentIntent.amount !== expectedCents) {
    await recordLocationCheckoutFailure({
      paymentIntentId,
      checkoutSessionId,
      guestInfo,
      errorCode: 'PAYMENT_AMOUNT_MISMATCH',
      errorSummary: `expected=${expectedCents} actual=${paymentIntent.amount}`,
      paymentIntent
    });
    throw createDomainError('validation', 'Payment amount does not match quote', null, 400);
  }

  const inventory = await resolveLocationTargets('valley');
  const { entityByTargetKey } = await loadEntityMaps(inventory);
  const perTargetShares = buildPerTargetBuyoutShares({
    inventory,
    entityByTargetKey,
    nights: quote.nights
  });
  const shareByTargetKey = new Map(perTargetShares.map((row) => [row.targetKey, row]));

  const usesTransactions = await canUseMongoTransactions();
  const childBookingIds = [];
  let locationBookingId = null;
  /** @type {{ bookingId: string, unitId: string, insertedNightsThisAttempt: string[] }[]} */
  const locationClaimAttempts = [];

  // I6: mint child ids + acquire ALL multi-unit claims before durable LocationBooking set.
  const preparedChildren = [];
  for (const target of inventory.targets) {
    const share = shareByTargetKey.get(target.targetKey);
    if (!share) {
      throw new Error(`Missing buyout share for target ${target.targetKey}`);
    }
    const childPayload = buildChildBookingPayload({
      target,
      share,
      locationBookingId: null,
      checkInDate,
      checkOutDate,
      adults,
      children,
      guestInfo,
      roomAllocation,
      checkoutSessionId
    });
    childPayload._id = new mongoose.Types.ObjectId();
    preparedChildren.push({ target, childPayload });
  }

  try {
    for (const { childPayload } of preparedChildren) {
      if (!(childPayload.cabinTypeId && childPayload.unitId)) continue;
      // eslint-disable-next-line no-await-in-loop
      const claimed = await unitNightClaimService.claimUnitNights({
        bookingId: childPayload._id,
        unitId: childPayload.unitId,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        source: I2_SOURCES.LOCATION_CHILD
      });
      locationClaimAttempts.push({
        bookingId: String(childPayload._id),
        unitId: String(childPayload.unitId),
        insertedNightsThisAttempt: claimed.insertedNightsThisAttempt || []
      });
    }
  } catch (claimErr) {
    for (const attempt of locationClaimAttempts) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await unitNightClaimService.compensateClaimAttempt({
          bookingId: attempt.bookingId,
          unitId: attempt.unitId,
          insertedNightsThisAttempt: attempt.insertedNightsThisAttempt
        });
      } catch {
        try {
          // eslint-disable-next-line no-await-in-loop
          await unitNightClaimService.releaseUnitNights({ bookingId: attempt.bookingId });
        } catch {
          /* orphan → I5 */
        }
      }
    }
    await recordLocationCheckoutFailure({
      paymentIntentId,
      checkoutSessionId,
      guestInfo,
      errorCode: claimErr.code || 'LOCATION_CLAIM_FAILED',
      errorSummary: claimErr.message,
      paymentIntent
    });
    throw createDomainError(
      'conflict',
      process.env.NODE_ENV === 'development'
        ? `Could not secure Valley inventory: ${claimErr.message}`
        : 'Could not finalize your Valley booking. Inventory conflict.',
      { details: claimErr.details || null },
      409
    );
  }

  const runFinalize = async (session = null) => {
    const createOpts = session ? { session } : undefined;
    const writeOpts = session ? { session } : undefined;

    const locationBooking = await LocationBooking.create(
      [
        {
          locationKey: 'valley',
          checkIn: checkInDate,
          checkOut: checkOutDate,
          adults,
          children,
          guestInfo,
          totalPrice: quote.totalPrice,
          currency: 'EUR',
          stripePaymentIntentId: paymentIntentId,
          status: 'confirmed',
          childBookingIds: [],
          includedTargetSnapshot: inventory.targets,
          quoteSnapshot: quote,
          source: 'website',
          checkoutSessionId,
          roomAllocation: roomAllocation || null
        }
      ],
      createOpts
    );
    const master = Array.isArray(locationBooking) ? locationBooking[0] : locationBooking;
    locationBookingId = master._id;

    for (const { childPayload } of preparedChildren) {
      childPayload.locationBookingId = master._id;
      // eslint-disable-next-line no-await-in-loop
      const child = await Booking.create([childPayload], createOpts);
      childBookingIds.push((Array.isArray(child) ? child[0] : child)._id);
    }

    master.childBookingIds = childBookingIds;
    await master.save(writeOpts);

    await AvailabilityBlock.updateMany(
      {
        checkoutSessionId,
        blockType: 'checkout_hold',
        status: 'active'
      },
      {
        status: 'tombstoned',
        tombstonedAt: new Date(),
        tombstoneReason: 'location_checkout_finalized'
      },
      writeOpts
    );
  };

  try {
    if (usesTransactions) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await runFinalize(session);
        });
      } finally {
        await session.endSession();
      }
    } else {
      await runFinalize(null);
    }
  } catch (err) {
    for (const attempt of locationClaimAttempts) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await unitNightClaimService.compensateClaimAttempt({
          bookingId: attempt.bookingId,
          unitId: attempt.unitId,
          insertedNightsThisAttempt: attempt.insertedNightsThisAttempt
        });
      } catch {
        try {
          // eslint-disable-next-line no-await-in-loop
          await unitNightClaimService.releaseUnitNights({ bookingId: attempt.bookingId });
        } catch {
          /* orphan */
        }
      }
    }
    await cleanupPartialLocationFinalize({
      locationBookingId,
      childBookingIds,
      checkoutSessionId: null
    });
    await recordLocationCheckoutFailure({
      paymentIntentId,
      checkoutSessionId,
      guestInfo,
      errorCode: err.code || 'LOCATION_FINALIZE_FAILED',
      errorSummary: err.message,
      paymentIntent
    });
    throw createDomainError(
      'validation',
      process.env.NODE_ENV === 'development'
        ? `Could not finalize Valley booking: ${err.message}`
        : 'Could not finalize your Valley booking. Our team has been notified.',
      null,
      500
    );
  }

  // Idempotent repair/assert after canonical survival (claims already acquired).
  await ensureLocationChildShadowClaims({
    childBookingIds,
    paymentIntentId,
    checkoutSessionId,
    ensureFn,
    stripePaymentVerified: true
  });

  const masterDoc = await LocationBooking.findById(locationBookingId);
  if (masterDoc && !masterDoc.confirmationEmailSentAt) {
    const emailResult = await sendLocationBookingConfirmationEmail(masterDoc);
    if (emailResult?.success) {
      masterDoc.confirmationEmailSentAt = new Date();
      await masterDoc.save();
    }
    await sendLocationBookingInternalNotification({
      locationBooking: masterDoc,
      childCount: childBookingIds.length
    });
  }

  scheduleSavedQuoteTask('location-consent-then-convert', async () => {
    await captureQuoteContactConsent({
      email: guestInfo?.email,
      quoteDeliveryRequested: body.quoteDeliveryRequested,
      bookingReminderConsent: body.bookingReminderConsent,
      marketingConsent: body.marketingConsent,
      sourceSurface: 'valley_checkout',
      checkoutSessionId,
      locationBookingId,
      propertyKind: 'valley',
      recordDeclines: true
    });
    await markSavedQuoteConverted({
      locationBookingId,
      checkoutId: checkoutSessionId,
      guestEmail: guestInfo?.email || null,
      locationKey: 'valley',
      checkInDateOnly: formatSofiaDateOnly(checkInDate),
      checkOutDateOnly: formatSofiaDateOnly(checkOutDate)
    });
  });

  try {
    const {
      recordServerPaymentEvent,
      recordLocationBookingFunnelConversion
    } = require('../conversion/funnelEventService');
    const locDoc =
      masterDoc ||
      (await LocationBooking.findById(locationBookingId).lean());
    void recordServerPaymentEvent({
      eventName: 'payment_succeeded',
      paymentId: paymentIntentId,
      stateCode: 'succeeded',
      sessionKey: body.funnelSessionKey || null,
      visitorKey: body.funnelVisitorKey || null,
      checkoutId: checkoutSessionId,
      locationId: 'valley',
      propertyKind: 'valley',
      checkInDateOnly: formatSofiaDateOnly(checkInDate),
      checkOutDateOnly: formatSofiaDateOnly(checkOutDate),
      quotedTotalCents: Math.round(Number(locDoc?.totalPrice || quote.totalPrice || 0) * 100),
      origin: 'api'
    }).catch(() => {});
    if (locDoc) {
      void recordLocationBookingFunnelConversion(locDoc, {
        funnelSessionKey: body.funnelSessionKey || null,
        funnelVisitorKey: body.funnelVisitorKey || null,
        checkoutId: checkoutSessionId,
        paymentId: paymentIntentId
      }).catch(() => {});
    }
  } catch {
    /* analytics must never block finalize */
  }

  return {
    idempotentReplay: false,
    locationBookingId: String(locationBookingId),
    childBookingIds: childBookingIds.map(String),
    status: 'confirmed',
    usesTransactions
  };
}

module.exports = {
  createLocationCheckoutPaymentIntent,
  finalizeLocationCheckout,
  recordLocationCheckoutFailure,
  cleanupPartialLocationFinalize
};
