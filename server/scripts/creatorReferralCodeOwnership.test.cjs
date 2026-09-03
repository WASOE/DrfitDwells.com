/**
 * Batch B0: alias-safe referral code ownership.
 * Run: cd server && node --test scripts/creatorReferralCodeOwnership.test.cjs
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CreatorPartner = require('../models/CreatorPartner');
const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const CreatorReferralVisit = require('../models/CreatorReferralVisit');
const GiftVoucher = require('../models/GiftVoucher');
const {
  getOwnedReferralCodes,
  buildInitialOwnedCodes
} = require('../models/CreatorPartner');
const {
  buildCreatorAttributionMaps,
  resolveBookingCreatorAttribution
} = require('../services/creators/creatorAttributionResolver');
const {
  renameCreatorReferralCode,
  findPartnerByOwnedReferralCode,
  backfillCreatorPartnerOwnedCodes,
  applyCreatorPartnerOpsAtomicUpdate,
  boundActorMetadata,
  LAST_CODE_CHANGED_BY_MAX_LENGTH
} = require('../services/creators/creatorReferralCodeService');
const {
  listCreatorPartnerAttributedBookings,
  buildSingleCreatorPartnerStats
} = require('../services/ops/creatorPartnerStatsService');
const { recalculateCreatorCommissionForPartner } = require('../services/ops/creatorCommissionLedgerService');
const { resolveCreatorAttributionForVoucher } = require('../services/giftVouchers/giftVoucherCommissionService');

let mongoServer;

function uniq(s = 'x') {
  return `${s}-${new mongoose.Types.ObjectId().toString().slice(-6)}`;
}

function nextDates() {
  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 14);
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 2);
  return { checkIn, checkOut };
}

async function createCabin() {
  return Cabin.create({
    name: `Cabin ${uniq('c')}`,
    description: 'Test cabin',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'B',
    isActive: true,
    transportOptions: []
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await CreatorPartner.syncIndexes();
  await Booking.syncIndexes();
  await Cabin.syncIndexes();
  await CreatorReferralVisit.syncIndexes();
  await GiftVoucher.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await CreatorReferralVisit.deleteMany({});
  await GiftVoucher.deleteMany({});
  await Booking.deleteMany({});
  await Cabin.deleteMany({});
  await CreatorPartner.deleteMany({});
});

test('create initializes ownedCodes with current code', async () => {
  const code = `init.${uniq('c')}`;
  const p = await CreatorPartner.create({
    name: 'Init',
    slug: uniq('init'),
    status: 'active',
    referral: { code, ownedCodes: buildInitialOwnedCodes(code), cookieDays: 60 }
  });
  assert.deepEqual(getOwnedReferralCodes(p), [code]);
  assert.ok(Array.isArray(p.referral.ownedCodes));
  assert.deepEqual(p.referral.ownedCodes, [code]);
});

test('pre-validate ensures current code is in ownedCodes when omitted', async () => {
  const code = `auto.${uniq('c')}`;
  const p = await CreatorPartner.create({
    name: 'Auto',
    slug: uniq('auto'),
    status: 'active',
    referral: { code, cookieDays: 60 }
  });
  assert.deepEqual(p.referral.ownedCodes, [code]);
});

test('getOwnedReferralCodes falls back to current when ownedCodes missing', () => {
  const codes = getOwnedReferralCodes({ referral: { code: 'legacy.ref' } });
  assert.deepEqual(codes, ['legacy.ref']);
});

test('backfill writes ownedCodes idempotently', async () => {
  const code = `bf.${uniq('c')}`;
  // Insert bypassing mongoose setters carefully via create without ownedCodes then strip
  const p = await CreatorPartner.create({
    name: 'BF',
    slug: uniq('bf'),
    status: 'active',
    referral: { code, cookieDays: 60 }
  });
  // Simulate pre-backfill document: clear ownedCodes at Mongo level
  await CreatorPartner.collection.updateOne({ _id: p._id }, { $unset: { 'referral.ownedCodes': 1 } });

  const dry = await backfillCreatorPartnerOwnedCodes({ dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.ok, true);
  assert.equal(dry.safeForUniqueIndex, true);
  assert.ok(dry.matched >= 1);
  assert.ok(dry.partnersNeedingBackfill >= 1);

  const written = await backfillCreatorPartnerOwnedCodes({ dryRun: false });
  assert.equal(written.dryRun, false);
  assert.equal(written.ok, true);
  assert.ok(written.modified >= 1);

  const again = await backfillCreatorPartnerOwnedCodes({ dryRun: false });
  assert.equal(again.modified, 0);

  const fresh = await CreatorPartner.findById(p._id).lean();
  assert.deepEqual(fresh.referral.ownedCodes, [code]);
});

test('rename keeps old code in ownedCodes and updates current', async () => {
  const oldCode = `old.${uniq('c')}`;
  const newCode = `new.${uniq('c')}`;
  const p = await CreatorPartner.create({
    name: 'Rename',
    slug: uniq('ren'),
    status: 'active',
    referral: { code: oldCode, ownedCodes: [oldCode], cookieDays: 60 }
  });

  const out = await renameCreatorReferralCode({
    partnerId: p._id,
    desiredRawCode: `@${newCode}`,
    actor: 'ops@test'
  });
  assert.equal(out.ok, true);
  assert.equal(out.changed, true);
  assert.equal(out.referralCode, newCode);
  assert.equal(out.previousReferralCode, oldCode);
  assert.equal(out.partner.referral.code, newCode);
  assert.ok(out.partner.referral.ownedCodes.includes(oldCode));
  assert.ok(out.partner.referral.ownedCodes.includes(newCode));
  assert.equal(out.partner.referral.lastCodeChangedBy, 'ops@test');
  assert.ok(out.partner.referral.codeChangedAt);
});

test('rename can switch current back to own alias', async () => {
  const a = `a.${uniq('c')}`;
  const b = `b.${uniq('c')}`;
  const p = await CreatorPartner.create({
    name: 'AliasSwitch',
    slug: uniq('as'),
    status: 'active',
    referral: { code: a, ownedCodes: [a], cookieDays: 60 }
  });
  await renameCreatorReferralCode({ partnerId: p._id, desiredRawCode: b, actor: 'ops' });
  const back = await renameCreatorReferralCode({ partnerId: p._id, desiredRawCode: a, actor: 'ops' });
  assert.equal(back.ok, true);
  assert.equal(back.changed, true);
  assert.equal(back.referralCode, a);
  assert.ok(back.partner.referral.ownedCodes.includes(a));
  assert.ok(back.partner.referral.ownedCodes.includes(b));
});

test('another partner cannot claim current or alias code', async () => {
  const oldCode = `held.${uniq('c')}`;
  const newCode = `curr.${uniq('c')}`;
  const a = await CreatorPartner.create({
    name: 'A',
    slug: uniq('pa'),
    status: 'active',
    referral: { code: oldCode, ownedCodes: [oldCode], cookieDays: 60 }
  });
  await renameCreatorReferralCode({ partnerId: a._id, desiredRawCode: newCode, actor: 'ops' });

  const b = await CreatorPartner.create({
    name: 'B',
    slug: uniq('pb'),
    status: 'active',
    referral: { code: `free.${uniq('c')}`, cookieDays: 60 }
  });

  const stealCurrent = await renameCreatorReferralCode({
    partnerId: b._id,
    desiredRawCode: newCode,
    actor: 'ops'
  });
  assert.equal(stealCurrent.ok, false);
  assert.equal(stealCurrent.code, 'CODE_TAKEN');

  const stealAlias = await renameCreatorReferralCode({
    partnerId: b._id,
    desiredRawCode: oldCode,
    actor: 'ops'
  });
  assert.equal(stealAlias.ok, false);
  assert.equal(stealAlias.code, 'CODE_TAKEN');
});

test('attribution maps include aliases after rename', async () => {
  const oldCode = `map.old.${uniq('c')}`;
  const newCode = `map.new.${uniq('c')}`;
  const p = await CreatorPartner.create({
    name: 'Map',
    slug: uniq('map'),
    status: 'active',
    referral: { code: oldCode, ownedCodes: [oldCode], cookieDays: 60 }
  });
  await renameCreatorReferralCode({ partnerId: p._id, desiredRawCode: newCode, actor: 'ops' });

  const maps = buildCreatorAttributionMaps(
    await CreatorPartner.find({}).select('_id status referral promo').lean()
  );
  assert.equal(maps.referralToCreatorId.get(oldCode), String(p._id));
  assert.equal(maps.referralToCreatorId.get(newCode), String(p._id));

  const resolved = resolveBookingCreatorAttribution(
    { attribution: { referralCode: oldCode } },
    maps
  );
  assert.equal(resolved.creatorPartnerId, String(p._id));
  assert.equal(resolved.source, 'creator_referral');
});

test('stats and booking list still find historical bookings by old code', async () => {
  const oldCode = `hist.${uniq('c')}`;
  const newCode = `hist2.${uniq('c')}`;
  const p = await CreatorPartner.create({
    name: 'Hist',
    slug: uniq('hist'),
    status: 'active',
    referral: { code: oldCode, ownedCodes: [oldCode], cookieDays: 60 },
    commission: { rateBps: 1000, basis: 'accommodation_net', eligibleAfter: 'stay_completed' }
  });
  const cabin = await createCabin();
  const { checkIn, checkOut } = nextDates();
  await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'a@example.com', phone: '+10000000001' },
    status: 'confirmed',
    totalPrice: 200,
    subtotalPrice: 200,
    discountAmount: 0,
    totalValueCents: 20000,
    giftVoucherAppliedCents: 0,
    stripePaidAmountCents: 20000,
    attribution: { referralCode: oldCode }
  });

  await renameCreatorReferralCode({ partnerId: p._id, desiredRawCode: newCode, actor: 'ops' });
  const partner = await CreatorPartner.findById(p._id).lean();

  const bookings = await listCreatorPartnerAttributedBookings(partner, { limit: 20 });
  assert.equal(bookings.length, 1);
  assert.equal(bookings[0].referralCode, oldCode);

  const stats = await buildSingleCreatorPartnerStats(partner);
  assert.equal(stats.attributedBookings, 1);

  const recalc = await recalculateCreatorCommissionForPartner(partner);
  assert.equal(recalc.processed, 1);
});

test('findPartnerByOwnedReferralCode resolves alias and visit-eligible statuses', async () => {
  const oldCode = `vis.${uniq('c')}`;
  const newCode = `vis2.${uniq('c')}`;
  const p = await CreatorPartner.create({
    name: 'Vis',
    slug: uniq('vis'),
    status: 'active',
    referral: { code: oldCode, ownedCodes: [oldCode], cookieDays: 60 }
  });
  await renameCreatorReferralCode({ partnerId: p._id, desiredRawCode: newCode, actor: 'ops' });

  const byAlias = await findPartnerByOwnedReferralCode(oldCode, { statuses: ['active', 'paused'] });
  assert.ok(byAlias);
  assert.equal(String(byAlias._id), String(p._id));

  const byCurrent = await findPartnerByOwnedReferralCode(newCode, { statuses: ['active', 'paused'] });
  assert.equal(String(byCurrent._id), String(p._id));
});

test('gift voucher attribution resolves renamed alias code', async () => {
  const oldCode = `gv.${uniq('c')}`;
  const newCode = `gv2.${uniq('c')}`;
  const p = await CreatorPartner.create({
    name: 'GV',
    slug: uniq('gv'),
    status: 'active',
    referral: { code: oldCode, ownedCodes: [oldCode], cookieDays: 60 },
    commission: { rateBps: 1000, basis: 'accommodation_net', eligibleAfter: 'stay_completed' }
  });
  await renameCreatorReferralCode({ partnerId: p._id, desiredRawCode: newCode, actor: 'ops' });

  const resolved = await resolveCreatorAttributionForVoucher({
    attribution: { referralCode: oldCode, creatorPartnerId: p._id }
  });
  assert.equal(resolved.ok, true);
  assert.equal(String(resolved.creator._id), String(p._id));
});

test('same-code rename is a no-op', async () => {
  const code = `same.${uniq('c')}`;
  const p = await CreatorPartner.create({
    name: 'Same',
    slug: uniq('same'),
    status: 'active',
    referral: { code, ownedCodes: [code], cookieDays: 60 }
  });
  const out = await renameCreatorReferralCode({ partnerId: p._id, desiredRawCode: code, actor: 'ops' });
  assert.equal(out.ok, true);
  assert.equal(out.changed, false);
  assert.equal(out.referralCode, code);
});

test('create rejects second partner with same owned alias via unique index', async () => {
  const code = `uniq.${uniq('c')}`;
  await CreatorPartner.create({
    name: 'One',
    slug: uniq('one'),
    status: 'active',
    referral: { code, ownedCodes: [code], cookieDays: 60 }
  });
  await assert.rejects(
    () =>
      CreatorPartner.create({
        name: 'Two',
        slug: uniq('two'),
        status: 'active',
        referral: { code: `other.${uniq('c')}`, ownedCodes: [code], cookieDays: 60 }
      }),
    (err) => err && err.code === 11000
  );
});

test('boundActorMetadata truncates to LAST_CODE_CHANGED_BY_MAX_LENGTH', () => {
  assert.equal(LAST_CODE_CHANGED_BY_MAX_LENGTH, 200);
  const long = 'a'.repeat(250);
  assert.equal(boundActorMetadata(long).length, 200);
});

test('OPS PATCH source uses single atomic update (no save-then-rename)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../routes/ops/modules/creatorPartnersRoutes.js'),
    'utf8'
  );
  assert.match(src, /applyCreatorPartnerOpsAtomicUpdate/);
  assert.doesNotMatch(src, /await doc\.save\(\)/);
  assert.doesNotMatch(src, /renameCreatorReferralCode/);
});

test('backfill script disables autoIndex and never creates/syncs indexes', () => {
  const src = fs.readFileSync(path.join(__dirname, 'backfillCreatorPartnerOwnedCodes.cjs'), 'utf8');
  assert.match(src, /mongoose\.set\(\s*['"]autoIndex['"]\s*,\s*false\s*\)/);
  assert.match(src, /autoIndex:\s*false/);
  assert.doesNotMatch(src, /\.syncIndexes\s*\(/);
  assert.doesNotMatch(src, /\.createIndexes\s*\(/);
  assert.doesNotMatch(src, /\.ensureIndexes\s*\(/);
  assert.doesNotMatch(src, /createIndex\s*\(/);
});

test('combined OPS field update plus successful rename applies everything', async () => {
  const oldCode = `combo.old.${uniq('c')}`;
  const newCode = `combo.new.${uniq('c')}`;
  const p = await CreatorPartner.create({
    name: 'Before',
    slug: uniq('combo'),
    status: 'active',
    notes: 'old-notes',
    referral: { code: oldCode, ownedCodes: [oldCode], cookieDays: 60 }
  });

  const out = await applyCreatorPartnerOpsAtomicUpdate({
    partnerId: p._id,
    desiredReferralCode: newCode,
    fieldUpdates: {
      name: 'After',
      notes: 'new-notes',
      status: 'paused',
      referralCookieDays: 90,
      updatedBy: 'ops@test'
    },
    actor: 'ops@test'
  });

  assert.equal(out.ok, true);
  assert.equal(out.referralCodeChanged, true);
  assert.equal(out.partner.name, 'After');
  assert.equal(out.partner.notes, 'new-notes');
  assert.equal(out.partner.status, 'paused');
  assert.equal(out.partner.referral.code, newCode);
  assert.equal(out.partner.referral.cookieDays, 90);
  assert.ok(out.partner.referral.ownedCodes.includes(oldCode));
  assert.ok(out.partner.referral.ownedCodes.includes(newCode));
  assert.equal(out.partner.referral.lastCodeChangedBy, 'ops@test');
  assert.ok(out.partner.referral.codeChangedAt);
});

test('taken-code conflict applies nothing', async () => {
  const held = `held.${uniq('c')}`;
  await CreatorPartner.create({
    name: 'Holder',
    slug: uniq('hold'),
    status: 'active',
    referral: { code: held, ownedCodes: [held], cookieDays: 60 }
  });
  const mine = `mine.${uniq('c')}`;
  const p = await CreatorPartner.create({
    name: 'Mine',
    slug: uniq('mine'),
    status: 'active',
    notes: 'keep-me',
    referral: { code: mine, ownedCodes: [mine], cookieDays: 60 }
  });

  const out = await applyCreatorPartnerOpsAtomicUpdate({
    partnerId: p._id,
    desiredReferralCode: held,
    fieldUpdates: { name: 'ShouldNotPersist', notes: 'nope' },
    actor: 'ops'
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'CODE_TAKEN');

  const fresh = await CreatorPartner.findById(p._id).lean();
  assert.equal(fresh.name, 'Mine');
  assert.equal(fresh.notes, 'keep-me');
  assert.equal(fresh.referral.code, mine);
  assert.equal(fresh.referral.lastCodeChangedBy, null);
});

test('invalid-code failure applies nothing', async () => {
  const code = `inv.${uniq('c')}`;
  const p = await CreatorPartner.create({
    name: 'ValidName',
    slug: uniq('inv'),
    status: 'active',
    notes: 'keep',
    referral: { code, ownedCodes: [code], cookieDays: 60 }
  });

  const out = await applyCreatorPartnerOpsAtomicUpdate({
    partnerId: p._id,
    desiredReferralCode: 'BAD CODE!!',
    fieldUpdates: { name: 'Changed', notes: 'changed' },
    actor: 'ops'
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'INVALID_CODE');

  const fresh = await CreatorPartner.findById(p._id).lean();
  assert.equal(fresh.name, 'ValidName');
  assert.equal(fresh.notes, 'keep');
  assert.equal(fresh.referral.code, code);
});

test('stale-current conflict applies nothing', async () => {
  const a = `stale.a.${uniq('c')}`;
  const b = `stale.b.${uniq('c')}`;
  const c = `stale.c.${uniq('c')}`;
  const p = await CreatorPartner.create({
    name: 'Stale',
    slug: uniq('stale'),
    status: 'active',
    notes: 'keep',
    referral: { code: a, ownedCodes: [a], cookieDays: 60 }
  });

  // Simulate concurrent rename A→B after our read would have seen A.
  const origFindById = CreatorPartner.findById.bind(CreatorPartner);
  let findCount = 0;
  CreatorPartner.findById = (...args) => {
    const q = origFindById(...args);
    const origLean = q.lean.bind(q);
    q.lean = async (...leanArgs) => {
      const doc = await origLean(...leanArgs);
      findCount += 1;
      if (findCount === 1 && doc && String(doc._id) === String(p._id)) {
        await CreatorPartner.collection.updateOne(
          { _id: p._id },
          {
            $set: {
              'referral.code': b,
              'referral.ownedCodes': [a, b],
              name: 'Concurrent'
            }
          }
        );
      }
      return doc;
    };
    return q;
  };

  try {
    const out = await applyCreatorPartnerOpsAtomicUpdate({
      partnerId: p._id,
      desiredReferralCode: c,
      fieldUpdates: { name: 'ShouldNotPersist', notes: 'nope' },
      actor: 'ops'
    });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'CODE_CHANGED');
  } finally {
    CreatorPartner.findById = origFindById;
  }

  const fresh = await CreatorPartner.findById(p._id).lean();
  assert.equal(fresh.referral.code, b);
  assert.equal(fresh.name, 'Concurrent');
  assert.equal(fresh.notes, 'keep');
  assert.ok(!fresh.referral.ownedCodes.includes(c));
});

test('same-code submission applies unrelated fields and does not record a rename', async () => {
  const code = `same2.${uniq('c')}`;
  const p = await CreatorPartner.create({
    name: 'SameBefore',
    slug: uniq('same2'),
    status: 'active',
    notes: 'old',
    referral: { code, ownedCodes: [code], cookieDays: 60 }
  });

  const out = await applyCreatorPartnerOpsAtomicUpdate({
    partnerId: p._id,
    desiredReferralCode: code,
    fieldUpdates: { name: 'SameAfter', notes: 'new', referralCookieDays: 45 },
    actor: 'ops@test'
  });

  assert.equal(out.ok, true);
  assert.equal(out.referralCodeChanged, false);
  assert.equal(out.partner.name, 'SameAfter');
  assert.equal(out.partner.notes, 'new');
  assert.equal(out.partner.referral.code, code);
  assert.equal(out.partner.referral.cookieDays, 45);
  assert.equal(out.partner.referral.lastCodeChangedBy, null);
  assert.equal(out.partner.referral.codeChangedAt, null);
});

test('duplicate-key failure applies nothing', async () => {
  const slug = uniq('dupslug');
  await CreatorPartner.create({
    name: 'Other',
    slug,
    status: 'active',
    referral: { code: `other.${uniq('c')}`, cookieDays: 60 }
  });
  const code = `dup.${uniq('c')}`;
  const p = await CreatorPartner.create({
    name: 'Target',
    slug: uniq('target'),
    status: 'active',
    notes: 'keep',
    referral: { code, ownedCodes: [code], cookieDays: 60 }
  });

  const out = await applyCreatorPartnerOpsAtomicUpdate({
    partnerId: p._id,
    desiredReferralCode: undefined,
    fieldUpdates: { slug, name: 'ShouldNotPersist', notes: 'nope' },
    actor: 'ops'
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'CODE_TAKEN');

  const fresh = await CreatorPartner.findById(p._id).lean();
  assert.equal(fresh.name, 'Target');
  assert.equal(fresh.notes, 'keep');
  assert.notEqual(fresh.slug, slug);
  assert.equal(fresh.referral.code, code);
});

test('backfill dry-run performs no document writes and no index operations', async () => {
  const code = `dryidx.${uniq('c')}`;
  const p = await CreatorPartner.create({
    name: 'Dry',
    slug: uniq('dry'),
    status: 'active',
    referral: { code, cookieDays: 60 }
  });
  await CreatorPartner.collection.updateOne({ _id: p._id }, { $unset: { 'referral.ownedCodes': 1 } });

  const counts = {
    updateOne: 0,
    updateMany: 0,
    bulkWrite: 0,
    findOneAndUpdate: 0,
    syncIndexes: 0,
    createIndexes: 0,
    createIndex: 0
  };

  const originals = {
    updateOne: CreatorPartner.updateOne,
    updateMany: CreatorPartner.updateMany,
    bulkWrite: CreatorPartner.bulkWrite,
    findOneAndUpdate: CreatorPartner.findOneAndUpdate,
    syncIndexes: CreatorPartner.syncIndexes,
    createIndexes: CreatorPartner.createIndexes,
    createIndex: CreatorPartner.collection.createIndex.bind(CreatorPartner.collection)
  };

  CreatorPartner.updateOne = async (...args) => {
    counts.updateOne += 1;
    return originals.updateOne.apply(CreatorPartner, args);
  };
  CreatorPartner.updateMany = async (...args) => {
    counts.updateMany += 1;
    return originals.updateMany.apply(CreatorPartner, args);
  };
  CreatorPartner.bulkWrite = async (...args) => {
    counts.bulkWrite += 1;
    return originals.bulkWrite.apply(CreatorPartner, args);
  };
  CreatorPartner.findOneAndUpdate = async (...args) => {
    counts.findOneAndUpdate += 1;
    return originals.findOneAndUpdate.apply(CreatorPartner, args);
  };
  CreatorPartner.syncIndexes = async (...args) => {
    counts.syncIndexes += 1;
    return originals.syncIndexes.apply(CreatorPartner, args);
  };
  CreatorPartner.createIndexes = async (...args) => {
    counts.createIndexes += 1;
    return originals.createIndexes.apply(CreatorPartner, args);
  };
  CreatorPartner.collection.createIndex = async (...args) => {
    counts.createIndex += 1;
    return originals.createIndex(...args);
  };

  try {
    const dry = await backfillCreatorPartnerOwnedCodes({ dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.ok(dry.matched >= 1);
    assert.equal(dry.modified, 0);
    assert.equal(counts.updateOne, 0);
    assert.equal(counts.updateMany, 0);
    assert.equal(counts.bulkWrite, 0);
    assert.equal(counts.findOneAndUpdate, 0);
    assert.equal(counts.syncIndexes, 0);
    assert.equal(counts.createIndexes, 0);
    assert.equal(counts.createIndex, 0);

    const fresh = await CreatorPartner.findById(p._id).lean();
    assert.equal(fresh.referral.ownedCodes, undefined);
  } finally {
    CreatorPartner.updateOne = originals.updateOne;
    CreatorPartner.updateMany = originals.updateMany;
    CreatorPartner.bulkWrite = originals.bulkWrite;
    CreatorPartner.findOneAndUpdate = originals.findOneAndUpdate;
    CreatorPartner.syncIndexes = originals.syncIndexes;
    CreatorPartner.createIndexes = originals.createIndexes;
    CreatorPartner.collection.createIndex = originals.createIndex;
  }
});

test('backfill write mode does not perform index operations', async () => {
  const code = `writeidx.${uniq('c')}`;
  const p = await CreatorPartner.create({
    name: 'Write',
    slug: uniq('write'),
    status: 'active',
    referral: { code, cookieDays: 60 }
  });
  await CreatorPartner.collection.updateOne({ _id: p._id }, { $unset: { 'referral.ownedCodes': 1 } });

  const counts = { syncIndexes: 0, createIndexes: 0, createIndex: 0 };
  const originals = {
    syncIndexes: CreatorPartner.syncIndexes,
    createIndexes: CreatorPartner.createIndexes,
    createIndex: CreatorPartner.collection.createIndex.bind(CreatorPartner.collection)
  };
  CreatorPartner.syncIndexes = async (...args) => {
    counts.syncIndexes += 1;
    return originals.syncIndexes.apply(CreatorPartner, args);
  };
  CreatorPartner.createIndexes = async (...args) => {
    counts.createIndexes += 1;
    return originals.createIndexes.apply(CreatorPartner, args);
  };
  CreatorPartner.collection.createIndex = async (...args) => {
    counts.createIndex += 1;
    return originals.createIndex(...args);
  };

  try {
    const written = await backfillCreatorPartnerOwnedCodes({ dryRun: false });
    assert.equal(written.dryRun, false);
    assert.ok(written.modified >= 1);
    assert.equal(counts.syncIndexes, 0);
    assert.equal(counts.createIndexes, 0);
    assert.equal(counts.createIndex, 0);
    const fresh = await CreatorPartner.findById(p._id).lean();
    assert.deepEqual(fresh.referral.ownedCodes, [code]);
  } finally {
    CreatorPartner.syncIndexes = originals.syncIndexes;
    CreatorPartner.createIndexes = originals.createIndexes;
    CreatorPartner.collection.createIndex = originals.createIndex;
  }
});

test('rename bounds lastCodeChangedBy before write', async () => {
  const oldCode = `bound.old.${uniq('c')}`;
  const newCode = `bound.new.${uniq('c')}`;
  const p = await CreatorPartner.create({
    name: 'Bound',
    slug: uniq('bound'),
    status: 'active',
    referral: { code: oldCode, ownedCodes: [oldCode], cookieDays: 60 }
  });
  const out = await renameCreatorReferralCode({
    partnerId: p._id,
    desiredRawCode: newCode,
    actor: 'z'.repeat(250)
  });
  assert.equal(out.ok, true);
  assert.equal(out.partner.referral.lastCodeChangedBy.length, LAST_CODE_CHANGED_BY_MAX_LENGTH);
});
