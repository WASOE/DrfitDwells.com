/**
 * Batch B1 corrections: atomic two-code limit, status race, expectedCurrentCode, rate limit.
 * Run: cd server && node --test scripts/creatorPortalReferralCode.b1.test.cjs
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');

process.env.CREATOR_PORTAL_SESSION_SECRET = 'unit-test-creator-portal-b1-session-secret-32';
process.env.CREATOR_PORTAL_TOKEN_VERSION = '1';
process.env.NODE_ENV = 'test';

const CreatorPartner = require('../models/CreatorPartner');
const {
  getOwnedReferralCodes,
  buildInitialOwnedCodes,
  applyReferralCodeNormalization,
  REFERRAL_CODE_RE
} = require('../models/CreatorPartner');
const { issueSessionToken, COOKIE_NAME } = require('../services/creatorPortal/creatorPortalSession');
const { buildCreatorPortalMe } = require('../services/creatorPortal/creatorPortalMeService');
const {
  renameOwnCreatorReferralCode,
  buildCreatorRenameActor,
  CREATOR_MAX_OWNED_REFERRAL_CODES,
  CREATOR_RENAME_CONSTRAINTS
} = require('../services/creatorPortal/creatorPortalReferralCodeService');
const {
  findPartnerByOwnedReferralCode,
  renameCreatorReferralCode,
  ownedReferralCodesCardinalityExpr
} = require('../services/creators/creatorReferralCodeService');
const creatorPortalRoutes = require('../routes/creatorPortalRoutes');

let mongoServer;
let app;

function uniq(s = 'x') {
  return `${s}-${new mongoose.Types.ObjectId().toString().slice(-6)}`;
}

function cookieFor(partnerId) {
  const { token } = issueSessionToken(String(partnerId));
  return `${COOKIE_NAME}=${encodeURIComponent(token)}`;
}

async function createActivePartner(code, extras = {}) {
  return CreatorPartner.create({
    name: extras.name || 'Creator',
    slug: extras.slug || uniq('slug'),
    status: extras.status || 'active',
    referral: {
      code,
      ownedCodes: extras.ownedCodes !== undefined ? extras.ownedCodes : buildInitialOwnedCodes(code),
      cookieDays: 60
    },
    commission: { rateBps: 1000, basis: 'accommodation_net', eligibleAfter: 'stay_completed' },
    ...extras.fields
  });
}

/**
 * Wrap findOneAndUpdate to capture the final atomic filter (and optional pre-write hook).
 * Must preserve mongoose Query-style `.lean()` chaining used by the service.
 */
function withCapturedFindOneAndUpdate(onBeforeWrite) {
  const filters = [];
  const original = CreatorPartner.findOneAndUpdate.bind(CreatorPartner);
  CreatorPartner.findOneAndUpdate = function patched(filter, update, options) {
    filters.push(JSON.parse(JSON.stringify(filter)));
    return {
      lean() {
        return (async () => {
          if (typeof onBeforeWrite === 'function') {
            await onBeforeWrite(filter, update);
          }
          return original(filter, update, options).lean();
        })();
      },
      then(resolve, reject) {
        return this.lean().then(resolve, reject);
      }
    };
  };
  return {
    filters,
    restore() {
      CreatorPartner.findOneAndUpdate = original;
    }
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await CreatorPartner.syncIndexes();
  app = express();
  app.use(express.json());
  app.use('/api/creator-portal', creatorPortalRoutes);
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await CreatorPartner.deleteMany({});
});

test('CREATOR_MAX_OWNED_REFERRAL_CODES is 2 and constraints are creator-only', () => {
  assert.equal(CREATOR_MAX_OWNED_REFERRAL_CODES, 2);
  assert.deepEqual(CREATOR_RENAME_CONSTRAINTS, {
    requiredStatus: 'active',
    maxOwnedCodesForNewCode: 2
  });
  assert.ok(ownedReferralCodesCardinalityExpr().$size);
});

test('unauthenticated PATCH is denied', async () => {
  const res = await request(app).patch('/api/creator-portal/me/referral-code').send({ code: 'new.code' });
  assert.equal(res.status, 401);
});

test('active creator can rename once; ownedCodes keeps old+new; /me hides ownedCodes', async () => {
  const oldCode = `old.${uniq('c')}`;
  const newCode = `new.${uniq('c')}`;
  const p = await createActivePartner(oldCode);

  const out = await renameOwnCreatorReferralCode({
    partnerId: p._id,
    desiredRawCode: `@${newCode}`,
    expectedCurrentCode: oldCode
  });
  assert.equal(out.ok, true);
  assert.equal(out.changed, true);
  assert.equal(out.referralCode, newCode);
  assert.equal(out.previousReferralCode, oldCode);
  assert.equal(out.ownedCodes, undefined);

  const fresh = await CreatorPartner.findById(p._id).lean();
  assert.equal(fresh.referral.code, newCode);
  assert.ok(fresh.referral.ownedCodes.includes(oldCode));
  assert.ok(fresh.referral.ownedCodes.includes(newCode));
  assert.equal(fresh.referral.lastCodeChangedBy, buildCreatorRenameActor(p._id));

  const byOld = await findPartnerByOwnedReferralCode(oldCode, { statuses: ['active', 'paused'] });
  const byNew = await findPartnerByOwnedReferralCode(newCode, { statuses: ['active', 'paused'] });
  assert.equal(String(byOld._id), String(p._id));
  assert.equal(String(byNew._id), String(p._id));

  const me = await buildCreatorPortalMe(p._id);
  const json = JSON.stringify(me);
  assert.equal(me.profile.referralCode, newCode);
  assert.equal(json.includes('ownedCodes'), false);
  assert.equal(json.includes(oldCode), false);
});

test('same-code submission is a no-op', async () => {
  const code = `same.${uniq('c')}`;
  const p = await createActivePartner(code, { ownedCodes: [code] });
  const out = await renameOwnCreatorReferralCode({
    partnerId: p._id,
    desiredRawCode: code,
    expectedCurrentCode: code
  });
  assert.equal(out.ok, true);
  assert.equal(out.changed, false);
  assert.equal(out.referralCode, code);
  const fresh = await CreatorPartner.findById(p._id).lean();
  assert.equal(fresh.referral.lastCodeChangedBy, null);
});

test('creator self-service cannot exceed two owned codes; switch between owned works at limit', async () => {
  const a = `a.${uniq('c')}`;
  const b = `b.${uniq('c')}`;
  const c = `c.${uniq('c')}`;
  const p = await createActivePartner(a, { ownedCodes: [a] });
  const first = await renameOwnCreatorReferralCode({
    partnerId: p._id,
    desiredRawCode: b,
    expectedCurrentCode: a
  });
  assert.equal(first.ok, true);

  const blocked = await renameOwnCreatorReferralCode({
    partnerId: p._id,
    desiredRawCode: c,
    expectedCurrentCode: b
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'ALIAS_LIMIT');

  const switchBack = await renameOwnCreatorReferralCode({
    partnerId: p._id,
    desiredRawCode: a,
    expectedCurrentCode: b
  });
  assert.equal(switchBack.ok, true);
  assert.equal(switchBack.referralCode, a);
  assert.deepEqual(
    getOwnedReferralCodes(await CreatorPartner.findById(p._id).lean()).sort(),
    [a, b].sort()
  );
});

test('legacy partners without ownedCodes are counted correctly for the two-code limit', async () => {
  const a = `legacy.${uniq('c')}`;
  const b = `legacy2.${uniq('c')}`;
  const c = `legacy3.${uniq('c')}`;
  const p = await createActivePartner(a, { ownedCodes: [a] });
  await CreatorPartner.updateOne({ _id: p._id }, { $unset: { 'referral.ownedCodes': 1 } });

  const first = await renameOwnCreatorReferralCode({
    partnerId: p._id,
    desiredRawCode: b,
    expectedCurrentCode: a
  });
  assert.equal(first.ok, true);
  assert.equal(getOwnedReferralCodes(await CreatorPartner.findById(p._id).lean()).length, 2);

  const blocked = await renameOwnCreatorReferralCode({
    partnerId: p._id,
    desiredRawCode: c,
    expectedCurrentCode: b
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'ALIAS_LIMIT');
});

test('two simultaneous requests for different new codes: exactly one success; atomic filter has $expr', async () => {
  const a = `base.${uniq('c')}`;
  const b = `raceb.${uniq('c')}`;
  const c = `racec.${uniq('c')}`;
  const p = await createActivePartner(a, { ownedCodes: [a] });

  const { filters, restore } = withCapturedFindOneAndUpdate();
  let results;
  try {
    results = await Promise.all([
      renameOwnCreatorReferralCode({
        partnerId: p._id,
        desiredRawCode: b,
        expectedCurrentCode: a
      }),
      renameOwnCreatorReferralCode({
        partnerId: p._id,
        desiredRawCode: c,
        expectedCurrentCode: a
      })
    ]);
  } finally {
    restore();
  }

  const ok = results.filter((r) => r.ok && r.changed);
  const fail = results.filter((r) => !r.ok);
  assert.equal(ok.length, 1, `expected one success, got ${JSON.stringify(results)}`);
  assert.equal(fail.length, 1);

  const fresh = await CreatorPartner.findById(p._id).lean();
  const owned = getOwnedReferralCodes(fresh);
  assert.equal(owned.length, 2, `owned must stay at 2, got ${owned.join(',')}`);
  assert.ok(owned.includes(a));
  assert.ok(owned.includes(ok[0].referralCode));

  const exprFilters = filters.filter((f) => f.$expr);
  assert.ok(exprFilters.length >= 1, 'atomic update must include $expr cardinality');
  for (const f of exprFilters) {
    assert.equal(f.status, 'active');
    assert.equal(f['referral.code'], a);
    assert.deepEqual(f.$expr.$lt[0], ownedReferralCodesCardinalityExpr());
    assert.equal(f.$expr.$lt[1], 2);
  }
});

test('stale expectedCurrentCode after re-read: atomic filter locks on expected, returns CODE_CHANGED', async () => {
  const a = `lock.a.${uniq('c')}`;
  const b = `lock.b.${uniq('c')}`;
  const c = `lock.c.${uniq('c')}`;
  const p = await createActivePartner(a, { ownedCodes: [a] });

  // After rename's initial read of A, mutate A→B before apply's re-read.
  let findLeanCount = 0;
  const originalFindById = CreatorPartner.findById.bind(CreatorPartner);
  function wrapQuery(query) {
    const originalLean = query.lean.bind(query);
    query.lean = function leanPatched(...leanArgs) {
      return Promise.resolve(originalLean(...leanArgs)).then(async (doc) => {
        findLeanCount += 1;
        if (findLeanCount === 1 && doc) {
          await CreatorPartner.updateOne(
            { _id: doc._id },
            { $set: { 'referral.code': b, 'referral.ownedCodes': [a, b] } }
          );
        }
        return doc;
      });
    };
    const originalSelect = query.select.bind(query);
    query.select = function selectPatched(...selectArgs) {
      return wrapQuery(originalSelect(...selectArgs));
    };
    return query;
  }
  CreatorPartner.findById = function findByIdPatched(id, ...rest) {
    return wrapQuery(originalFindById(id, ...rest));
  };

  const { filters, restore: restoreUpdate } = withCapturedFindOneAndUpdate();
  let out;
  try {
    out = await renameOwnCreatorReferralCode({
      partnerId: p._id,
      desiredRawCode: c,
      expectedCurrentCode: a
    });
  } finally {
    CreatorPartner.findById = originalFindById;
    restoreUpdate();
  }

  assert.equal(out.ok, false);
  assert.equal(out.code, 'CODE_CHANGED');
  assert.ok(filters.length >= 1, 'must reach atomic findOneAndUpdate');
  assert.equal(
    filters[0]['referral.code'],
    a,
    'atomic filter must lock on expectedCurrentCode, not re-read current B'
  );
  assert.equal(filters[0].status, 'active');

  const fresh = await CreatorPartner.findById(p._id).lean();
  assert.equal(fresh.referral.code, b, 'must not apply stale A→C over B');
  assert.ok(!getOwnedReferralCodes(fresh).includes(c));
});

test('active-to-paused race prevents rename; atomic filter requires status active', async () => {
  const oldCode = `pause.race.${uniq('c')}`;
  const newCode = `pause.next.${uniq('c')}`;
  const p = await createActivePartner(oldCode, { ownedCodes: [oldCode] });

  const { filters, restore } = withCapturedFindOneAndUpdate(async () => {
    await CreatorPartner.updateOne({ _id: p._id }, { $set: { status: 'paused' } });
  });
  let out;
  try {
    out = await renameOwnCreatorReferralCode({
      partnerId: p._id,
      desiredRawCode: newCode,
      expectedCurrentCode: oldCode
    });
  } finally {
    restore();
  }

  assert.equal(out.ok, false);
  assert.equal(out.code, 'REFERRAL_CODE_CHANGE_UNAVAILABLE');
  assert.ok(filters.length >= 1);
  assert.equal(filters[0].status, 'active');
  assert.equal(filters[0]['referral.code'], oldCode);

  const fresh = await CreatorPartner.findById(p._id).lean();
  assert.equal(fresh.status, 'paused');
  assert.equal(fresh.referral.code, oldCode);
});

test('active-to-archived race prevents rename; atomic filter requires status active', async () => {
  const oldCode = `arch.race.${uniq('c')}`;
  const newCode = `arch.next.${uniq('c')}`;
  const p = await createActivePartner(oldCode, { ownedCodes: [oldCode] });

  const { filters, restore } = withCapturedFindOneAndUpdate(async () => {
    await CreatorPartner.updateOne({ _id: p._id }, { $set: { status: 'archived' } });
  });
  let out;
  try {
    out = await renameOwnCreatorReferralCode({
      partnerId: p._id,
      desiredRawCode: newCode,
      expectedCurrentCode: oldCode
    });
  } finally {
    restore();
  }

  assert.equal(out.ok, false);
  assert.equal(out.code, 'REFERRAL_CODE_CHANGE_UNAVAILABLE');
  assert.equal(filters[0].status, 'active');

  const fresh = await CreatorPartner.findById(p._id).lean();
  assert.equal(fresh.status, 'archived');
  assert.equal(fresh.referral.code, oldCode);
});

test('OPS rename remains unrestricted beyond two owned codes', async () => {
  const a = `ops.a.${uniq('c')}`;
  const b = `ops.b.${uniq('c')}`;
  const c = `ops.c.${uniq('c')}`;
  const p = await createActivePartner(a, { ownedCodes: [a] });
  await renameCreatorReferralCode({ partnerId: p._id, desiredRawCode: b, actor: 'ops:test' });
  const third = await renameCreatorReferralCode({
    partnerId: p._id,
    desiredRawCode: c,
    actor: 'ops:test'
  });
  assert.equal(third.ok, true);
  assert.equal(third.referralCode, c);
  assert.deepEqual(
    getOwnedReferralCodes(await CreatorPartner.findById(p._id).lean()).sort(),
    [a, b, c].sort()
  );
});

test('paused creator cannot self-rename', async () => {
  const code = `paused.${uniq('c')}`;
  const p = await createActivePartner(code, { status: 'paused', ownedCodes: [code] });
  const out = await renameOwnCreatorReferralCode({
    partnerId: p._id,
    desiredRawCode: `next.${uniq('c')}`,
    expectedCurrentCode: code
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'REFERRAL_CODE_CHANGE_UNAVAILABLE');
});

test('invalid code rejected', async () => {
  const code = `inv.${uniq('c')}`;
  const p = await createActivePartner(code, { ownedCodes: [code] });
  const out = await renameOwnCreatorReferralCode({
    partnerId: p._id,
    desiredRawCode: 'BAD CODE!!',
    expectedCurrentCode: code
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'INVALID_CODE');
});

test('cannot take another creator current or historical code', async () => {
  const heldOld = `held.old.${uniq('c')}`;
  const heldNew = `held.new.${uniq('c')}`;
  const a = await createActivePartner(heldOld, { ownedCodes: [heldOld], name: 'Holder', slug: uniq('hold') });
  await renameOwnCreatorReferralCode({
    partnerId: a._id,
    desiredRawCode: heldNew,
    expectedCurrentCode: heldOld
  });

  const mine = `mine.${uniq('c')}`;
  const b = await createActivePartner(mine, { ownedCodes: [mine], name: 'Other', slug: uniq('oth') });

  const stealCurrent = await renameOwnCreatorReferralCode({
    partnerId: b._id,
    desiredRawCode: heldNew,
    expectedCurrentCode: mine
  });
  assert.equal(stealCurrent.ok, false);
  assert.equal(stealCurrent.code, 'CODE_TAKEN');

  const stealAlias = await renameOwnCreatorReferralCode({
    partnerId: b._id,
    desiredRawCode: heldOld,
    expectedCurrentCode: mine
  });
  assert.equal(stealAlias.ok, false);
  assert.equal(stealAlias.code, 'CODE_TAKEN');
});

test('HTTP PATCH success and mutation response omit ownedCodes', async () => {
  const oldCode = `http.old.${uniq('c')}`;
  const newCode = `http.new.${uniq('c')}`;
  const p = await createActivePartner(oldCode, { ownedCodes: [oldCode], name: 'Http', slug: uniq('http') });

  const res = await request(app)
    .patch('/api/creator-portal/me/referral-code')
    .set('Cookie', cookieFor(p._id))
    .send({ code: newCode, expectedCurrentCode: oldCode });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.referralCode, newCode);
  assert.equal(res.body.data.changed, true);
  assert.equal(JSON.stringify(res.body).includes('ownedCodes'), false);

  const meRes = await request(app).get('/api/creator-portal/me').set('Cookie', cookieFor(p._id));
  assert.equal(meRes.status, 200);
  assert.equal(meRes.body.data.profile.referralCode, newCode);
  assert.equal(JSON.stringify(meRes.body).includes('ownedCodes'), false);
});

test('HTTP PATCH rejects body partnerId targeting and unexpected fields', async () => {
  const a = await createActivePartner(`a.${uniq('c')}`, { name: 'A', slug: uniq('aa') });
  const b = await createActivePartner(`b.${uniq('c')}`, { name: 'B', slug: uniq('bb') });

  const res = await request(app)
    .patch('/api/creator-portal/me/referral-code')
    .set('Cookie', cookieFor(a._id))
    .send({ code: `x.${uniq('c')}`, partnerId: String(b._id), expectedCurrentCode: a.referral.code });
  assert.equal(res.status, 400);
});

test('missing expectedCurrentCode returns 400', async () => {
  const code = `miss.${uniq('c')}`;
  const p = await createActivePartner(code, { ownedCodes: [code] });
  const res = await request(app)
    .patch('/api/creator-portal/me/referral-code')
    .set('Cookie', cookieFor(p._id))
    .send({ code: `next.${uniq('c')}` });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'INVALID_EXPECTED_CURRENT');
  const fresh = await CreatorPartner.findById(p._id).lean();
  assert.equal(fresh.referral.code, code);
});

test('invalid expectedCurrentCode types and values return 400', async () => {
  const payloads = [null, '', 'BAD CODE!!', 'a'.repeat(81), ['x'], { x: 1 }];
  for (const expectedCurrentCode of payloads) {
    const code = `badexp.${uniq('c')}`;
    const p = await createActivePartner(code, { ownedCodes: [code], slug: uniq('bex') });
    const next = `next.${uniq('c')}`;
    const res = await request(app)
      .patch('/api/creator-portal/me/referral-code')
      .set('Cookie', cookieFor(p._id))
      .send({ code: next, expectedCurrentCode });
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(expectedCurrentCode)}`);
    assert.equal(res.body.code, 'INVALID_EXPECTED_CURRENT');
    const fresh = await CreatorPartner.findById(p._id).lean();
    assert.equal(fresh.referral.code, code);
  }
});

test('stale expectedCurrentCode returns 409 without mutation', async () => {
  const code = `stale.${uniq('c')}`;
  const p = await createActivePartner(code, { ownedCodes: [code] });
  const res = await request(app)
    .patch('/api/creator-portal/me/referral-code')
    .set('Cookie', cookieFor(p._id))
    .send({ code: `next.${uniq('c')}`, expectedCurrentCode: 'not-the-current' });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'CODE_CHANGED');
  const fresh = await CreatorPartner.findById(p._id).lean();
  assert.equal(fresh.referral.code, code);
});

test('HTTP PATCH paused status returns 403 REFERRAL_CODE_CHANGE_UNAVAILABLE', async () => {
  const code = `http.paused.${uniq('c')}`;
  const p = await createActivePartner(code, { status: 'paused', ownedCodes: [code] });
  const res = await request(app)
    .patch('/api/creator-portal/me/referral-code')
    .set('Cookie', cookieFor(p._id))
    .send({ code: `np.${uniq('c')}`, expectedCurrentCode: code });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'REFERRAL_CODE_CHANGE_UNAVAILABLE');
});

test('five rename attempts allowed; sixth returns 429; key is per authenticated creator', async () => {
  const codeA = `rl.a.${uniq('c')}`;
  const codeB = `rl.b.${uniq('c')}`;
  const pA = await createActivePartner(codeA, { ownedCodes: [codeA], name: 'RL-A', slug: uniq('rla') });
  const pB = await createActivePartner(codeB, { ownedCodes: [codeB], name: 'RL-B', slug: uniq('rlb') });

  const statusesA = [];
  for (let i = 0; i < 5; i += 1) {
    const res = await request(app)
      .patch('/api/creator-portal/me/referral-code')
      .set('Cookie', cookieFor(pA._id))
      .send({ code: codeA, expectedCurrentCode: codeA });
    statusesA.push(res.status);
  }
  assert.deepEqual(statusesA, [200, 200, 200, 200, 200]);

  const sixth = await request(app)
    .patch('/api/creator-portal/me/referral-code')
    .set('Cookie', cookieFor(pA._id))
    .send({ code: codeA, expectedCurrentCode: codeA });
  assert.equal(sixth.status, 429);

  // Different authenticated creator has an independent bucket.
  const other = await request(app)
    .patch('/api/creator-portal/me/referral-code')
    .set('Cookie', cookieFor(pB._id))
    .send({ code: codeB, expectedCurrentCode: codeB });
  assert.equal(other.status, 200);
});

test('client preview normalization matches backend applyReferralCodeNormalization + REFERRAL_CODE_RE', () => {
  const samples = [
    '  \u200B@Foo.Bar\u200B  ',
    '@@hello_world',
    'ok_code-1',
    'BAD CODE!!',
    '',
    'a'.repeat(81)
  ];
  for (const raw of samples) {
    const backendNorm = applyReferralCodeNormalization(raw);
    const backendValid = backendNorm && REFERRAL_CODE_RE.test(backendNorm) ? backendNorm : null;
    // Mirror client util algorithm inline (same as referralCodeNormalize.js)
    let value = String(raw ?? '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim()
      .toLowerCase()
      .replace(/^@+/, '')
      .trim()
      .toLowerCase();
    value = value || null;
    const clientValid = value && REFERRAL_CODE_RE.test(value) ? value : null;
    assert.equal(clientValid, backendValid, `mismatch for ${JSON.stringify(raw)}`);
  }
});
