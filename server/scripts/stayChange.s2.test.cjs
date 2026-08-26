/**
 * REBOOK-S2 StayChange spine — schema, helpers, money evidence, classifiers.
 * Binding: docs/stay-change-implementation-plan.md §23.33 REBOOK-S2
 * Run: cd server && node --test scripts/stayChange.s2.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const StayChange = require('../models/StayChange');
const Booking = require('../models/Booking');
const {
  commercialProductKeyFromShape,
  commercialProductKeyFromBooking,
  validateCommercialShape,
  compareCommercialProducts,
  classifyStayChangeRoute
} = require('../services/stayChange/commercialProductIdentity');
const {
  resolveSourceContractualTotalCents,
  resolveRecognizedNetSettledCoverageCents,
  computeTransferredValueCents,
  computeContractualTargetTotalCents,
  validateMoneyEvidence,
  COVERAGE_FAIL_CODES
} = require('../services/stayChange/rebookMoneyEvidence');
const {
  REBOOK_KIND,
  REBOOK_STATUSES,
  buildSourceSnapshot,
  buildTargetSnapshot,
  validateRebookStayChangeRepresentation,
  assertRebookImmutability,
  resolveReplacementCoverageCents,
  isRebookTransferSettling
} = require('../services/stayChange/rebookStayChangeSpine');
const {
  classifyReservationPaymentStatus,
  suppressesCancelledPaidRefundFollowUp
} = require('../services/ops/payment/reservationPaymentSignals');

const ROOT = path.join(__dirname, '..');
const SPINE_PATH = path.join(ROOT, 'services/stayChange/rebookStayChangeSpine.js');
const MONEY_PATH = path.join(ROOT, 'services/stayChange/rebookMoneyEvidence.js');
const MODEL_PATH = path.join(ROOT, 'models/StayChange.js');
const OID = () => new mongoose.Types.ObjectId();

let mongoServer;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

function cabinIds() {
  return { cabinA: OID(), cabinB: OID() };
}

function multiIds() {
  return { typeA: OID(), typeB: OID(), unitA: OID(), unitB: OID() };
}

function baseRebookDoc(overrides = {}) {
  const { cabinA, cabinB } = cabinIds();
  const sourceId = OID();
  const targetId = OID();
  return {
    kind: 'rebook',
    bookingId: sourceId,
    targetBookingId: targetId,
    sourceCommercialProductKey: `cabin:${cabinA}`,
    targetCommercialProductKey: `cabin:${cabinB}`,
    sourceCabinId: cabinA,
    targetCabinId: cabinB,
    sourceCabinTypeId: null,
    targetCabinTypeId: null,
    sourceUnitId: null,
    targetUnitId: null,
    checkIn: new Date('2026-09-10T00:00:00.000Z'),
    checkOut: new Date('2026-09-12T00:00:00.000Z'),
    status: 'pending',
    idempotencyKey: `rebook-s2-${OID()}`,
    payloadFingerprint: 'fp-s2-test',
    sourceSnapshot: {
      commercialProductKey: `cabin:${cabinA}`,
      cabinId: String(cabinA),
      cabinTypeId: null,
      unitId: null,
      checkIn: new Date('2026-09-10T00:00:00.000Z'),
      checkOut: new Date('2026-09-12T00:00:00.000Z'),
      adults: 2,
      children: 0,
      currency: 'eur',
      sourceContractualTotalCents: 10000,
      recognizedNetSettledCoverageCents: 10000,
      locationBookingId: null
    },
    targetSnapshot: {
      commercialProductKey: `cabin:${cabinB}`,
      cabinId: String(cabinB),
      cabinTypeId: null,
      unitId: null,
      checkIn: new Date('2026-09-10T00:00:00.000Z'),
      checkOut: new Date('2026-09-12T00:00:00.000Z'),
      adults: 2,
      children: 0,
      currency: 'eur',
      canonicalTargetQuoteCents: 10000,
      locationBookingId: null
    },
    money: {
      sourceContractualTotalCents: 10000,
      recognizedNetSettledCoverageCents: 10000,
      transferredValueCents: 10000,
      canonicalTargetQuoteCents: 10000,
      waivedUpgradeCents: 0,
      additionalChargeCents: 0,
      refundCents: 0,
      creditCents: 0,
      retainedCents: 0,
      contractualTargetTotalCents: 10000,
      settlementType: 'equal_price',
      currency: 'eur'
    },
    ...overrides
  };
}

// ─── Backward compatibility: REALLOCATE ─────────────────────────────────────

test('S2#01 REALLOCATE StayChange still validates with cabinType+unit', async () => {
  const typeId = OID();
  const u1 = OID();
  const u2 = OID();
  const doc = await StayChange.create({
    kind: 'reallocate',
    bookingId: OID(),
    sourceCommercialProductKey: `cabinType:${typeId}`,
    targetCommercialProductKey: `cabinType:${typeId}`,
    sourceCabinTypeId: typeId,
    targetCabinTypeId: typeId,
    sourceUnitId: u1,
    targetUnitId: u2,
    checkIn: new Date('2026-09-01T00:00:00.000Z'),
    checkOut: new Date('2026-09-03T00:00:00.000Z'),
    status: 'pending',
    idempotencyKey: `r1-compat-${OID()}`,
    payloadFingerprint: 'fp-r1'
  });
  assert.equal(doc.kind, 'reallocate');
  assert.equal(doc.targetBookingId, null);
  assert.equal(doc.sourceSnapshot, null);
  assert.equal(doc.money, undefined);
});

test('S2#02 REALLOCATE rejects missing unitId at schema validate', async () => {
  const typeId = OID();
  await assert.rejects(
    () =>
      StayChange.create({
        kind: 'reallocate',
        bookingId: OID(),
        sourceCommercialProductKey: `cabinType:${typeId}`,
        targetCommercialProductKey: `cabinType:${typeId}`,
        sourceCabinTypeId: typeId,
        targetCabinTypeId: typeId,
        sourceUnitId: OID(),
        // targetUnitId missing
        checkIn: new Date('2026-09-01T00:00:00.000Z'),
        checkOut: new Date('2026-09-03T00:00:00.000Z'),
        status: 'pending',
        idempotencyKey: `r1-bad-${OID()}`,
        payloadFingerprint: 'fp'
      }),
    /REALLOCATE requires/
  );
});

test('S2#03 existing StayChange schema paths retained', () => {
  const paths = StayChange.schema.paths;
  for (const p of [
    'kind',
    'bookingId',
    'sourceCommercialProductKey',
    'targetCommercialProductKey',
    'sourceCabinTypeId',
    'targetCabinTypeId',
    'sourceUnitId',
    'targetUnitId',
    'idempotencyKey',
    'payloadFingerprint',
    'status'
  ]) {
    assert.ok(paths[p], `missing path ${p}`);
  }
});

test('S2#04 idempotency unique index spec unchanged (source bookingId)', () => {
  const spec = StayChange.IDEMPOTENCY_UNIQUE_INDEX_SPEC;
  assert.deepEqual(spec.keys, { kind: 1, bookingId: 1, idempotencyKey: 1 });
  assert.equal(spec.options.name, 'stayChange_kind_booking_idempotency_unique');
  assert.equal(StayChange.schema.get('autoIndex'), false);
});

// ─── REBOOK identity ────────────────────────────────────────────────────────

test('S2#05 bookingId is source; targetBookingId separate', () => {
  const doc = baseRebookDoc();
  const v = validateRebookStayChangeRepresentation(doc);
  assert.equal(v.ok, true);
  assert.notEqual(String(doc.bookingId), String(doc.targetBookingId));
});

test('S2#06 targetBookingId may be pre-generated / Booking need not exist', async () => {
  const preMinted = OID();
  const doc = await StayChange.create(baseRebookDoc({ targetBookingId: preMinted }));
  assert.equal(String(doc.targetBookingId), String(preMinted));
  const bookingExists = await Booking.exists({ _id: preMinted });
  assert.equal(bookingExists, null);
});

test('S2#07 invalid targetBookingId rejected', () => {
  const v = validateRebookStayChangeRepresentation(baseRebookDoc({ targetBookingId: 'not-an-id' }));
  assert.equal(v.ok, false);
  assert.equal(v.code, 'TARGET_BOOKING_INVALID');
});

test('S2#08 targetBookingId may be null during precommit representation helper', () => {
  // Schema allows null; helper allows null (precommit before mint). Same-product still blocked.
  const doc = baseRebookDoc({ targetBookingId: null });
  const v = validateRebookStayChangeRepresentation(doc);
  assert.equal(v.ok, true);
});

// ─── Commercial shape ───────────────────────────────────────────────────────

test('S2#09 cabinId-only commercial shape valid', () => {
  const cabinId = OID();
  const r = validateCommercialShape({ cabinId });
  assert.equal(r.ok, true);
  assert.equal(r.shape, 'single');
  assert.equal(r.commercialProductKey, `cabin:${cabinId}`);
});

test('S2#10 cabinTypeId+unitId commercial shape valid', () => {
  const cabinTypeId = OID();
  const unitId = OID();
  const r = validateCommercialShape({ cabinTypeId, unitId });
  assert.equal(r.ok, true);
  assert.equal(r.shape, 'allocated_multi');
});

test('S2#11 both cabinId and cabinTypeId invalid', () => {
  const r = validateCommercialShape({ cabinId: OID(), cabinTypeId: OID() });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'MIXED_COMMERCIAL_IDENTITY');
});

test('S2#12 neither cabinId nor cabinTypeId invalid', () => {
  const r = validateCommercialShape({});
  assert.equal(r.ok, false);
  assert.equal(r.code, 'MISSING_COMMERCIAL_IDENTITY');
});

test('S2#13 unitId with cabinId invalid', () => {
  const r = validateCommercialShape({ cabinId: OID(), unitId: OID() });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'UNIT_WITH_SINGLE_CABIN');
});

test('S2#14 unitId with cabinType valid; comparison ignores unit', () => {
  const typeId = OID();
  const a = { cabinTypeId: typeId, unitId: OID() };
  const b = { cabinTypeId: typeId, unitId: OID() };
  assert.equal(compareCommercialProducts(a, b), 'same');
  assert.equal(commercialProductKeyFromShape(a), commercialProductKeyFromShape(b));
});

test('S2#15 LocationBooking shape rejected', () => {
  const r = validateCommercialShape({ cabinId: OID(), locationBookingId: OID() });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'LOCATION_BOOKING_UNSUPPORTED');
});

test('S2#16 unallocated multi rejected by default', () => {
  const r = validateCommercialShape({ cabinTypeId: OID() });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'UNALLOCATED_MULTI_UNSUPPORTED');
});

test('S2#17 same commercial product not accepted as REBOOK', () => {
  const cabinId = OID();
  const doc = baseRebookDoc({
    sourceCabinId: cabinId,
    targetCabinId: cabinId,
    sourceCommercialProductKey: `cabin:${cabinId}`,
    targetCommercialProductKey: `cabin:${cabinId}`,
    sourceSnapshot: null,
    targetSnapshot: null
  });
  const v = validateRebookStayChangeRepresentation(doc);
  assert.equal(v.ok, false);
  assert.equal(v.code, 'SAME_COMMERCIAL_PRODUCT');
});

test('S2#18 classifyStayChangeRoute: different key → rebook; unit-only → reallocate; cabin change → rebook', () => {
  const { typeA, typeB, unitA, unitB } = multiIds();
  const { cabinA, cabinB } = cabinIds();
  assert.equal(
    classifyStayChangeRoute({
      source: { cabinTypeId: typeA, unitId: unitA },
      target: { cabinTypeId: typeB, unitId: unitB }
    }),
    'rebook'
  );
  assert.equal(
    classifyStayChangeRoute({
      source: { cabinTypeId: typeA, unitId: unitA },
      target: { cabinTypeId: typeA, unitId: unitB }
    }),
    'reallocate'
  );
  assert.equal(
    classifyStayChangeRoute({
      source: { cabinId: cabinA },
      target: { cabinId: cabinB }
    }),
    'rebook'
  );
  assert.equal(
    classifyStayChangeRoute({
      source: { cabinId: cabinA },
      target: { cabinId: cabinA }
    }),
    'noop'
  );
  assert.equal(
    classifyStayChangeRoute({
      source: { cabinTypeId: typeA, unitId: unitA },
      target: { cabinTypeId: typeA, unitId: unitA },
      datesOrGuestsOrQuoteChanged: true
    }),
    'amend'
  );
});

// ─── Snapshots ──────────────────────────────────────────────────────────────

test('S2#19 buildSourceSnapshot freezes contractual + coverage; no PII', () => {
  const cabinId = OID();
  const booking = {
    cabinId,
    cabinTypeId: null,
    unitId: null,
    checkIn: new Date('2026-09-10'),
    checkOut: new Date('2026-09-12'),
    adults: 2,
    children: 1,
    totalValueCents: 12000
  };
  const built = buildSourceSnapshot({
    booking,
    sourceContractualTotalCents: 12000,
    recognizedNetSettledCoverageCents: 8000
  });
  assert.equal(built.ok, true);
  assert.equal(built.snapshot.sourceContractualTotalCents, 12000);
  assert.equal(built.snapshot.recognizedNetSettledCoverageCents, 8000);
  assert.equal(built.snapshot.guestInfo, undefined);
  assert.equal(built.snapshot.email, undefined);
});

test('S2#20 malformed snapshot with PII rejected', () => {
  const doc = baseRebookDoc();
  doc.sourceSnapshot = { ...doc.sourceSnapshot, email: 'guest@example.com' };
  const v = validateRebookStayChangeRepresentation(doc);
  assert.equal(v.ok, false);
  assert.equal(v.code, 'SNAPSHOT_PII_FORBIDDEN');
});

test('S2#21 buildTargetSnapshot requires quote cents', () => {
  const cabinId = OID();
  const bad = buildTargetSnapshot({
    cabinId,
    checkIn: new Date(),
    checkOut: new Date(),
    canonicalTargetQuoteCents: -1
  });
  assert.equal(bad.ok, false);
});

// ─── Money spine ────────────────────────────────────────────────────────────

test('S2#22 resolveSourceContractualTotalCents prefers totalValueCents', () => {
  const r = resolveSourceContractualTotalCents({ totalValueCents: 5500, totalPrice: 99 });
  assert.equal(r.ok, true);
  assert.equal(r.cents, 5500);
  assert.equal(r.source, 'totalValueCents');
});

test('S2#23 resolveSourceContractualTotalCents falls back to totalPrice*100', () => {
  const r = resolveSourceContractualTotalCents({ totalPrice: 42.5 });
  assert.equal(r.ok, true);
  assert.equal(r.cents, 4250);
});

test('S2#24 transferredValueCents = min(contractual, coverage)', () => {
  assert.equal(computeTransferredValueCents(10000, 4000).cents, 4000);
  assert.equal(computeTransferredValueCents(3000, 9000).cents, 3000);
  assert.equal(computeTransferredValueCents(-1, 1).ok, false);
});

test('S2#25 coverage from Payment trail; disputed fail-closed', () => {
  const booking = { totalValueCents: 10000, giftVoucherAppliedCents: 0 };
  const ok = resolveRecognizedNetSettledCoverageCents(booking, [
    { status: 'paid', amount: 40 },
    { status: 'partial', amount: 20 }
  ]);
  assert.equal(ok.ok, true);
  assert.equal(ok.cents, 6000);

  const disputed = resolveRecognizedNetSettledCoverageCents(booking, [
    { status: 'disputed', amount: 100 }
  ]);
  assert.equal(disputed.ok, false);
  assert.equal(disputed.code, COVERAGE_FAIL_CODES.DISPUTED);
});

test('S2#26 trail vs stripePaidAmountCents disagreement fail-closed', () => {
  const booking = { totalValueCents: 10000, stripePaidAmountCents: 9999 };
  const r = resolveRecognizedNetSettledCoverageCents(booking, [{ status: 'paid', amount: 100 }]);
  assert.equal(r.ok, false);
  assert.equal(r.code, COVERAGE_FAIL_CODES.TRAIL_STRIPE_DISAGREE);
});

test('S2#27 unpaid source may have zero coverage', () => {
  const r = resolveRecognizedNetSettledCoverageCents({ totalValueCents: 10000, status: 'pending' }, []);
  assert.equal(r.ok, true);
  assert.equal(r.cents, 0);
});

test('S2#28 voucher counted once; refunded payments not counted', () => {
  const booking = { totalValueCents: 10000, giftVoucherAppliedCents: 2500 };
  const r = resolveRecognizedNetSettledCoverageCents(booking, [
    { status: 'paid', amount: 50 },
    { status: 'refunded', amount: 50 }
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.cents, 7500);
});

test('S2#29 manual confirmed without evidence fail-closed', () => {
  const r = resolveRecognizedNetSettledCoverageCents(
    {
      totalValueCents: 10000,
      status: 'confirmed',
      provenance: { source: 'admin_manual' }
    },
    []
  );
  assert.equal(r.ok, false);
  assert.equal(r.code, COVERAGE_FAIL_CODES.MANUAL_AMBIGUOUS);
});

test('S2#30 waiver evidence + contractual target formula', () => {
  const r = computeContractualTargetTotalCents(14000, 4000);
  assert.equal(r.ok, true);
  assert.equal(r.cents, 10000);
  const money = validateMoneyEvidence({
    canonicalTargetQuoteCents: 14000,
    waivedUpgradeCents: 4000,
    contractualTargetTotalCents: 10000,
    sourceContractualTotalCents: 10000,
    recognizedNetSettledCoverageCents: 4000,
    transferredValueCents: 4000,
    currency: 'eur'
  });
  assert.equal(money.ok, true);
});

test('S2#31 negative money cents rejected', () => {
  const money = validateMoneyEvidence({ transferredValueCents: -1 });
  assert.equal(money.ok, false);
});

test('S2#32 currency must be 3-letter when set', () => {
  assert.equal(validateMoneyEvidence({ currency: 'EURO' }).ok, false);
  assert.equal(validateMoneyEvidence({ currency: 'eur' }).ok, true);
});

// ─── Lifecycle ──────────────────────────────────────────────────────────────

test('S2#33 locked REBOOK status enum; inventing names rejected', () => {
  assert.ok(REBOOK_STATUSES.includes('pending'));
  assert.ok(REBOOK_STATUSES.includes('inventory_secured'));
  assert.ok(REBOOK_STATUSES.includes('completed'));
  assert.ok(REBOOK_STATUSES.includes('needs_reconciliation'));
  assert.ok(!REBOOK_STATUSES.includes('planned'));
  assert.ok(!REBOOK_STATUSES.includes('precommit'));
  const v = validateRebookStayChangeRepresentation(baseRebookDoc({ status: 'planned' }));
  assert.equal(v.ok, false);
  assert.equal(v.code, 'STATUS_INVALID');
});

test('S2#34 immutability: cannot change bookingId/kind/idempotencyKey', () => {
  const before = baseRebookDoc({ status: 'pending' });
  const after = { ...before, bookingId: OID() };
  const r = assertRebookImmutability(before, after);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'IMMUTABLE_FIELD');
});

test('S2#35 immutability: evidence locked after inventory_secured', () => {
  const before = baseRebookDoc({ status: 'inventory_secured' });
  const after = {
    ...before,
    money: { ...before.money, transferredValueCents: 1, recognizedNetSettledCoverageCents: 1 }
  };
  const r = assertRebookImmutability(before, after);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'EVIDENCE_LOCKED');
});

test('S2#36 pending may still refine money before lock', () => {
  const before = baseRebookDoc({ status: 'pending' });
  const after = {
    ...before,
    money: {
      ...before.money,
      recognizedNetSettledCoverageCents: 5000,
      transferredValueCents: 5000
    }
  };
  assert.equal(assertRebookImmutability(before, after).ok, true);
});

// ─── Payment classifier + Booking field ─────────────────────────────────────

test('S2#37 Booking.settledByStayChangeId optional; no other projections', () => {
  const path = Booking.schema.paths.settledByStayChangeId;
  assert.ok(path);
  assert.equal(path.isRequired, undefined);
  assert.equal(path.options.default, null);
  assert.equal(Booking.schema.paths.lastStayChangeId, undefined);
});

test('S2#38 classifier: transfer-covered replacement reads as paid', () => {
  const scId = OID();
  const booking = {
    settledByStayChangeId: scId,
    totalPrice: 100,
    giftVoucherAppliedCents: 0
  };
  const rebookStayChange = {
    _id: scId,
    kind: 'rebook',
    status: 'completed',
    money: {
      transferredValueCents: 10000,
      contractualTargetTotalCents: 10000
    }
  };
  assert.equal(
    classifyReservationPaymentStatus({
      booking,
      linkedPaymentTrail: [],
      hasUnlinkedStripePayment: false,
      rebookStayChange
    }),
    'paid'
  );
});

test('S2#39 classifier: partial transfer coverage → partial', () => {
  const scId = OID();
  assert.equal(
    classifyReservationPaymentStatus({
      booking: { settledByStayChangeId: scId, totalPrice: 140 },
      linkedPaymentTrail: [],
      hasUnlinkedStripePayment: false,
      rebookStayChange: {
        _id: scId,
        kind: 'rebook',
        status: 'completed',
        money: { transferredValueCents: 4000, contractualTargetTotalCents: 10000 }
      }
    }),
    'partial'
  );
});

test('S2#40 rebooked_or_moved suppresses refund follow-up', () => {
  assert.equal(suppressesCancelledPaidRefundFollowUp('rebooked_or_moved'), true);
});

test('S2#41 resolveReplacementCoverageCents adds incremental', () => {
  const cents = resolveReplacementCoverageCents({
    rebookStayChange: {
      kind: 'rebook',
      money: { transferredValueCents: 4000 }
    },
    replacementIncrementalPaidCents: 2000,
    replacementVoucherCents: 1000
  });
  assert.equal(cents, 7000);
  assert.equal(isRebookTransferSettling({ kind: 'rebook', status: 'completed' }), true);
  assert.equal(isRebookTransferSettling({ kind: 'rebook', status: 'pending' }), false);
});

// ─── Persist REBOOK doc ─────────────────────────────────────────────────────

test('S2#42 StayChange.create persists REBOOK spine fields', async () => {
  const doc = await StayChange.create(baseRebookDoc());
  assert.equal(doc.kind, 'rebook');
  assert.ok(doc.bookingId);
  assert.ok(doc.targetBookingId);
  assert.ok(doc.sourceCabinId);
  assert.ok(doc.targetCabinId);
  assert.equal(doc.money.transferredValueCents, 10000);
  assert.equal(doc.money.waivedUpgradeCents, 0);
  assert.equal(doc.sourceSnapshot.sourceContractualTotalCents, 10000);
});

test('S2#43 complimentary upgrade money evidence persists waivedUpgradeCents', async () => {
  const base = baseRebookDoc();
  base.money = {
    sourceContractualTotalCents: 10000,
    recognizedNetSettledCoverageCents: 10000,
    transferredValueCents: 10000,
    canonicalTargetQuoteCents: 14000,
    waivedUpgradeCents: 4000,
    additionalChargeCents: 0,
    refundCents: 0,
    creditCents: 0,
    retainedCents: 0,
    contractualTargetTotalCents: 10000,
    settlementType: 'complimentary_upgrade',
    currency: 'eur'
  };
  base.targetSnapshot = {
    ...base.targetSnapshot,
    canonicalTargetQuoteCents: 14000
  };
  const saved = await StayChange.create(base);
  assert.equal(saved.money.waivedUpgradeCents, 4000);
  assert.equal(saved.money.settlementType, 'complimentary_upgrade');
  assert.equal(saved.money.contractualTargetTotalCents, 10000);
});

// ─── No side effects (static) ───────────────────────────────────────────────

test('S2#44 S2 modules have no Booking/Payment/claim/Stripe/index mutation', () => {
  const files = [
    SPINE_PATH,
    MONEY_PATH,
    path.join(ROOT, 'services/stayChange/commercialProductIdentity.js'),
    MODEL_PATH
  ];
  const banned = [
    'Booking.create',
    'new Booking',
    'Booking.update',
    'Booking.delete',
    'Payment.create',
    'Payment.update',
    'claimCabinNights',
    'releaseCabinNights',
    'claimUnitNights',
    'releaseUnitNights',
    'createIndex',
    'dropIndex',
    'syncIndexes',
    'stripe.',
    'Stripe('
  ];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const b of banned) {
      assert.ok(!src.includes(b), `${path.basename(file)} must not contain ${b}`);
    }
  }
});

test('S2#45 no REBOOK mutation route registration in S2 files', () => {
  const src = fs.readFileSync(SPINE_PATH, 'utf8');
  assert.ok(!src.includes('POST /rebook'));
  assert.ok(!src.includes('router.post'));
  assert.ok(!/actions\/rebook/.test(src));
});

test('S2#46 commercialProductKeyFromBooking shared with R1 semantics', () => {
  const typeId = OID();
  const cabinId = OID();
  assert.equal(
    commercialProductKeyFromBooking({ cabinTypeId: typeId }),
    `cabinType:${typeId}`
  );
  assert.equal(commercialProductKeyFromBooking({ cabinId }), `cabin:${cabinId}`);
  assert.equal(commercialProductKeyFromBooking({ cabinId, cabinTypeId: typeId }), null);
});

test('S2#47 multi→single REBOOK representation valid', () => {
  const { typeA, unitA } = multiIds();
  const { cabinB } = cabinIds();
  const doc = baseRebookDoc({
    sourceCabinId: null,
    targetCabinId: cabinB,
    sourceCabinTypeId: typeA,
    targetCabinTypeId: null,
    sourceUnitId: unitA,
    targetUnitId: null,
    sourceCommercialProductKey: `cabinType:${typeA}`,
    targetCommercialProductKey: `cabin:${cabinB}`,
    sourceSnapshot: {
      commercialProductKey: `cabinType:${typeA}`,
      cabinId: null,
      cabinTypeId: String(typeA),
      unitId: String(unitA),
      checkIn: new Date('2026-09-10'),
      checkOut: new Date('2026-09-12'),
      adults: 2,
      children: 0,
      currency: 'eur',
      sourceContractualTotalCents: 10000,
      recognizedNetSettledCoverageCents: 10000,
      locationBookingId: null
    },
    targetSnapshot: {
      commercialProductKey: `cabin:${cabinB}`,
      cabinId: String(cabinB),
      cabinTypeId: null,
      unitId: null,
      checkIn: new Date('2026-09-10'),
      checkOut: new Date('2026-09-12'),
      adults: 2,
      children: 0,
      currency: 'eur',
      canonicalTargetQuoteCents: 10000,
      locationBookingId: null
    }
  });
  assert.equal(validateRebookStayChangeRepresentation(doc).ok, true);
});

test('S2#48 REBOOK kind constant', () => {
  assert.equal(REBOOK_KIND, 'rebook');
  assert.ok(StayChange.STAY_CHANGE_KINDS.includes('rebook'));
  assert.ok(StayChange.STAY_CHANGE_KINDS.includes('amend'));
});
