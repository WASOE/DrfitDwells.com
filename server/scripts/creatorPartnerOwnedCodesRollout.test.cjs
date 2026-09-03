/**
 * B0 rollout: ownership audit, ownedCodes index readiness, deliberate index ensure.
 * Run: cd server && node --test scripts/creatorPartnerOwnedCodesRollout.test.cjs
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CreatorPartner = require('../models/CreatorPartner');
const {
  auditCreatorPartnerOwnedCodesConflicts,
  buildPartnerOwnershipProjection
} = require('../services/creators/creatorPartnerOwnedCodesAudit');
const {
  OWNED_CODES_INDEX_KEYS,
  ERR,
  assertCreatorPartnerOwnedCodesUniqueIndex,
  assertCreatorPartnerOwnedCodesIndexBootReady,
  ensureCreatorPartnerOwnedCodesUniqueIndex
} = require('../services/creators/creatorPartnerOwnedCodesIndex');
const {
  backfillCreatorPartnerOwnedCodes
} = require('../services/creators/creatorReferralCodeService');
const { startApiProcess } = require('../bootstrap/startApiProcess');

let mongoServer;

function uniq(s = 'x') {
  return `${s}-${new mongoose.Types.ObjectId().toString().slice(-6)}`;
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await CreatorPartner.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await CreatorPartner.deleteMany({});
});

test('ownership audit: no conflict', async () => {
  await CreatorPartner.create({
    name: 'A',
    slug: uniq('a'),
    status: 'active',
    referral: { code: `a.${uniq('c')}`, cookieDays: 60 }
  });
  await CreatorPartner.create({
    name: 'B',
    slug: uniq('b'),
    status: 'active',
    referral: { code: `b.${uniq('c')}`, cookieDays: 60 }
  });
  const audit = await auditCreatorPartnerOwnedCodesConflicts();
  assert.equal(audit.ok, true);
  assert.equal(audit.conflictsFound, 0);
  assert.equal(audit.safeForUniqueIndex, true);
  assert.equal(audit.safeForBackfillWrite, true);
  assert.equal(audit.partnersScanned, 2);
});

test('ownership audit: same normalized code across partners', async () => {
  const code = `same.${uniq('c')}`;
  const partners = [
    {
      _id: new mongoose.Types.ObjectId(),
      name: 'A',
      referral: { code, ownedCodes: [code] }
    },
    {
      _id: new mongoose.Types.ObjectId(),
      name: 'B',
      referral: { code: `other.${uniq('c')}`, ownedCodes: [code] }
    }
  ];
  const audit = await auditCreatorPartnerOwnedCodesConflicts(partners);
  assert.equal(audit.ok, false);
  assert.ok(audit.conflictsFound >= 1);
  assert.equal(audit.safeForUniqueIndex, false);
  assert.equal(audit.conflicts[0].normalizedCode, code);
  assert.ok(
    audit.conflicts[0].partnerA.source === 'historical_alias' ||
      audit.conflicts[0].partnerB.source === 'historical_alias' ||
      audit.conflicts[0].partnerA.source === 'current_and_alias' ||
      audit.conflicts[0].partnerB.source === 'current_and_alias'
  );
});

test('ownership audit: case-normalized collision', async () => {
  const partners = [
    {
      _id: new mongoose.Types.ObjectId(),
      name: 'CaseA',
      referral: { code: 'CaseCodeX', ownedCodes: ['CaseCodeX'] }
    },
    {
      _id: new mongoose.Types.ObjectId(),
      name: 'CaseB',
      referral: { code: 'casecodex', ownedCodes: ['casecodex'] }
    }
  ];
  const audit = await auditCreatorPartnerOwnedCodesConflicts(partners);
  assert.equal(audit.ok, false);
  assert.equal(audit.safeForUniqueIndex, false);
  assert.ok(audit.conflicts.some((c) => c.normalizedCode === 'casecodex'));
});

test('ownership audit: whitespace-normalized collision', async () => {
  const partners = [
    {
      _id: new mongoose.Types.ObjectId(),
      name: 'WS1',
      referral: { code: '  spaced.code  ', ownedCodes: ['  spaced.code  '] }
    },
    {
      _id: new mongoose.Types.ObjectId(),
      name: 'WS2',
      referral: { code: 'spaced.code', ownedCodes: ['spaced.code'] }
    }
  ];
  const audit = await auditCreatorPartnerOwnedCodesConflicts(partners);
  assert.equal(audit.ok, false);
  assert.ok(audit.conflicts.some((c) => c.normalizedCode === 'spaced.code'));
});

test('ownership audit: historical alias collision', async () => {
  const alias = `alias.${uniq('c')}`;
  const currA = `curr.a.${uniq('c')}`;
  const currB = `curr.b.${uniq('c')}`;
  const partners = [
    {
      _id: new mongoose.Types.ObjectId(),
      name: 'HistA',
      referral: { code: currA, ownedCodes: [currA, alias] }
    },
    {
      _id: new mongoose.Types.ObjectId(),
      name: 'HistB',
      referral: { code: currB, ownedCodes: [currB, alias] }
    }
  ];
  const audit = await auditCreatorPartnerOwnedCodesConflicts(partners);
  assert.equal(audit.ok, false);
  const hit = audit.conflicts.find((c) => c.normalizedCode === alias);
  assert.ok(hit);
  assert.ok(
    hit.partnerA.source === 'historical_alias' || hit.partnerB.source === 'historical_alias'
  );
});

test('ownership audit: same-partner duplicates do not create cross-partner conflict', async () => {
  const code = `dupself.${uniq('c')}`;
  const partners = [
    {
      _id: new mongoose.Types.ObjectId(),
      name: 'Self',
      referral: { code, ownedCodes: [code, code, code] }
    }
  ];
  const audit = await auditCreatorPartnerOwnedCodesConflicts(partners);
  assert.equal(audit.ok, true);
  assert.equal(audit.conflictsFound, 0);
  const proj = buildPartnerOwnershipProjection(partners[0]);
  assert.deepEqual(proj.simulatedOwnedCodes, [code]);
});

test('dry-run writes nothing and reports audit fields', async () => {
  const code = `dry.${uniq('c')}`;
  const p = await CreatorPartner.create({
    name: 'Dry',
    slug: uniq('dry'),
    status: 'active',
    referral: { code, cookieDays: 60 }
  });
  await CreatorPartner.collection.updateOne({ _id: p._id }, { $unset: { 'referral.ownedCodes': 1 } });

  let updateCalls = 0;
  const orig = CreatorPartner.updateOne;
  CreatorPartner.updateOne = async (...args) => {
    updateCalls += 1;
    return orig.apply(CreatorPartner, args);
  };
  try {
    const dry = await backfillCreatorPartnerOwnedCodes({ dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.wrote, false);
    assert.equal(dry.ok, true);
    assert.equal(typeof dry.partnersScanned, 'number');
    assert.equal(typeof dry.safeForUniqueIndex, 'boolean');
    assert.equal(updateCalls, 0);
    const fresh = await CreatorPartner.findById(p._id).lean();
    assert.equal(fresh.referral.ownedCodes, undefined);
  } finally {
    CreatorPartner.updateOne = orig;
  }
});

test('--write aborts before any mutation if conflict exists', async () => {
  // Simulate conflicting post-backfill ownership without inserting duplicate index keys:
  // stub CreatorPartner.find used by the backfill loader.
  const shared = `conflict.${uniq('c')}`;
  const free = `free.${uniq('c')}`;
  const partners = [
    {
      _id: new mongoose.Types.ObjectId(),
      name: 'A',
      referral: { code: shared, ownedCodes: [shared] }
    },
    {
      _id: new mongoose.Types.ObjectId(),
      name: 'B',
      referral: { code: free, ownedCodes: [free, shared] }
    }
  ];

  const origFind = CreatorPartner.find;
  CreatorPartner.find = () => ({
    select() {
      return {
        lean: async () => partners
      };
    }
  });

  let updateCalls = 0;
  const origUpdate = CreatorPartner.updateOne;
  CreatorPartner.updateOne = async (...args) => {
    updateCalls += 1;
    return origUpdate.apply(CreatorPartner, args);
  };
  try {
    const result = await backfillCreatorPartnerOwnedCodes({ dryRun: false });
    assert.equal(result.ok, false);
    assert.equal(result.aborted, true);
    assert.equal(result.wrote, false);
    assert.equal(result.safeForBackfillWrite, false);
    assert.ok(result.conflictsFound >= 1);
    assert.equal(updateCalls, 0);
  } finally {
    CreatorPartner.find = origFind;
    CreatorPartner.updateOne = origUpdate;
  }
});

test('startup readiness: required unique index exists → passes', async () => {
  const indexes = [
    { name: '_id_', key: { _id: 1 } },
    { name: 'referral.ownedCodes_1', key: { ...OWNED_CODES_INDEX_KEYS }, unique: true }
  ];
  const result = await assertCreatorPartnerOwnedCodesUniqueIndex({
    collection: { indexes: async () => indexes }
  });
  assert.equal(result.ok, true);
  const boot = await assertCreatorPartnerOwnedCodesIndexBootReady({
    processName: 'test',
    collection: { indexes: async () => indexes }
  });
  assert.equal(boot.ok, true);
});

test('startup readiness: index missing → fails', async () => {
  await assert.rejects(
    () =>
      assertCreatorPartnerOwnedCodesUniqueIndex({
        collection: { indexes: async () => [{ name: '_id_', key: { _id: 1 } }] }
      }),
    (err) => err && err.code === ERR.INDEX_MISSING
  );
});

test('startup readiness: index exists but non-unique → fails', async () => {
  await assert.rejects(
    () =>
      assertCreatorPartnerOwnedCodesUniqueIndex({
        collection: {
          indexes: async () => [
            { name: 'referral.ownedCodes_1', key: { ...OWNED_CODES_INDEX_KEYS }, unique: false }
          ]
        }
      }),
    (err) => err && err.code === ERR.INDEX_WRONG
  );
});

test('startup readiness: wrong key definition → fails', async () => {
  await assert.rejects(
    () =>
      assertCreatorPartnerOwnedCodesUniqueIndex({
        collection: {
          indexes: async () => [
            { name: 'referral.code_1', key: { 'referral.code': 1 }, unique: true }
          ]
        }
      }),
    (err) => err && err.code === ERR.INDEX_MISSING
  );
});

test('index ensure: conflict → refuses create', async () => {
  let created = false;
  const result = await ensureCreatorPartnerOwnedCodesUniqueIndex({
    auditFn: async () => ({
      safeForUniqueIndex: false,
      conflictsFound: 1,
      conflicts: [{ normalizedCode: 'x' }],
      partnersScanned: 2
    }),
    createIndexFn: async () => {
      created = true;
      return 'should-not-run';
    },
    collection: {
      indexes: async () => []
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.created, false);
  assert.equal(result.reason, 'ownership_conflicts');
  assert.equal(created, false);
});

test('index ensure: clean dataset creates exact unique index then verifies', async () => {
  const state = { indexes: [{ name: '_id_', key: { _id: 1 } }] };
  const result = await ensureCreatorPartnerOwnedCodesUniqueIndex({
    auditFn: async () => ({
      safeForUniqueIndex: true,
      conflictsFound: 0,
      conflicts: [],
      partnersScanned: 0,
      partnersNeedingBackfill: 0,
      normalizedCodesScanned: 0
    }),
    collection: {
      indexes: async () => state.indexes,
      createIndex: async () => {
        throw new Error('should use inject createIndexFn');
      }
    },
    createIndexFn: async (keys, options) => {
      assert.deepEqual(keys, { ...OWNED_CODES_INDEX_KEYS });
      assert.equal(options.unique, true);
      state.indexes.push({
        name: options.name || 'referral.ownedCodes_1',
        key: { ...keys },
        unique: true
      });
      return options.name || 'referral.ownedCodes_1';
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.index.unique, true);
  assert.deepEqual(result.index.key, { ...OWNED_CODES_INDEX_KEYS });
});

test('startApiProcess fails closed when ownedCodes index assert throws', async () => {
  const events = [];
  let exitCode = null;
  const result = await startApiProcess({
    connectDbFn: async () => {
      events.push('mongo');
      return { connection: { host: 'test' } };
    },
    assertAuthorityBootFn: async () => {
      events.push('cabin');
      return { required: false, ok: true };
    },
    assertOwnedCodesIndexBootFn: async () => {
      events.push('owned');
      const err = new Error('ownedCodes index missing');
      err.code = ERR.INDEX_MISSING;
      throw err;
    },
    startPostConnectRuntimeFn: () => {
      events.push('workers');
    },
    startHttpListenerFn: () => {
      events.push('listen');
      return { close() {} };
    },
    env: { CABIN_NIGHT_CLAIM_MODE: 'off' },
    exitFn: (code) => {
      exitCode = code;
      events.push(`exit:${code}`);
    },
    logError: () => {},
    logInfo: () => {}
  });
  assert.equal(result.ok, false);
  assert.equal(result.listened, false);
  assert.equal(exitCode, 1);
  assert.equal(events.includes('listen'), false);
  assert.equal(events.includes('workers'), false);
  assert.ok(events.includes('owned'));
  assert.ok(events.includes('exit:1'));
});

test('startApiProcess listens only after ownedCodes assert passes', async () => {
  const events = [];
  const result = await startApiProcess({
    connectDbFn: async () => {
      events.push('mongo');
      return { connection: { host: 'test' } };
    },
    assertAuthorityBootFn: async () => {
      events.push('cabin');
      return { required: true, ok: true };
    },
    assertOwnedCodesIndexBootFn: async () => {
      events.push('owned');
      return { ok: true };
    },
    startPostConnectRuntimeFn: () => {
      events.push('workers');
    },
    startHttpListenerFn: () => {
      events.push('listen');
      return { close() {} };
    },
    env: { CABIN_NIGHT_CLAIM_MODE: 'authoritative' },
    exitFn: () => {},
    logError: () => {},
    logInfo: () => {}
  });
  assert.equal(result.ok, true);
  assert.deepEqual(events, ['mongo', 'cabin', 'owned', 'workers', 'listen']);
});

test('backfill script and ensure script disable autoIndex and never syncIndexes', () => {
  const backfill = fs.readFileSync(path.join(__dirname, 'backfillCreatorPartnerOwnedCodes.cjs'), 'utf8');
  const ensure = fs.readFileSync(path.join(__dirname, 'ensureCreatorPartnerOwnedCodesIndex.cjs'), 'utf8');
  for (const src of [backfill, ensure]) {
    assert.match(src, /mongoose\.set\(\s*['"]autoIndex['"]\s*,\s*false\s*\)/);
    assert.match(src, /autoIndex:\s*false/);
    assert.doesNotMatch(src, /\.syncIndexes\s*\(/);
  }
  assert.match(ensure, /ensureCreatorPartnerOwnedCodesUniqueIndex/);
});

test('server.js wires ownedCodes boot gate before listen', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(src, /assertCreatorPartnerOwnedCodesIndexBootReady/);
  assert.match(src, /assertOwnedCodesIndexBootFn:\s*assertCreatorPartnerOwnedCodesIndexBootReady/);
  const ownedIdx = src.indexOf('assertOwnedCodesIndexBootFn');
  const listenIdx = src.indexOf('startHttpListenerFn');
  assert.ok(ownedIdx > 0 && listenIdx > ownedIdx);
});
