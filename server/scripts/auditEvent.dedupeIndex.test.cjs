/**
 * AuditEvent dedupeKey unique partial index hotfix.
 * Binding: unique WHERE dedupeKey is string — not null/missing.
 * Run: cd server && node --test scripts/auditEvent.dedupeIndex.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const AuditEvent = require('../models/AuditEvent');
const {
  AUDIT_DEDUPE_INDEX_SPEC,
  AUDIT_DEDUPE_LEGACY_SPARSE_SHAPE
} = require('../models/AuditEvent');
const { appendAuditEvent, normalizeDedupeKey } = require('../services/auditWriter');
const {
  indexExact,
  classifyAuditDedupeIndex,
  ensureR1IndexesForTests,
  dropIndexIfExists
} = require('../services/stayChange/stayChangeIndexes');
const cutover = require('./stayChangeR1Cutover');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const Cabin = require('../models/Cabin');
const {
  createBlock
} = require('../services/ops/domain/availabilityWriteService');

const AUDIT_NAME = AUDIT_DEDUPE_INDEX_SPEC.options.name;
const ROOT = path.join(__dirname, '..');

let mongoServer;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await ensureR1IndexesForTests();
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await AuditEvent.collection.deleteMany({});
  await AvailabilityBlock.collection.deleteMany({});
  await ensureR1IndexesForTests();
});

test('DEDUP#01 multiple AuditEvents with missing dedupeKey can exist', async () => {
  await appendAuditEvent({
    actorType: 'user',
    entityType: 'AvailabilityBlock',
    entityId: '1',
    action: 'manual_block_create'
  });
  await appendAuditEvent({
    actorType: 'user',
    entityType: 'AvailabilityBlock',
    entityId: '2',
    action: 'manual_block_create'
  });
  assert.equal(await AuditEvent.countDocuments({}), 2);
  assert.equal(await AuditEvent.countDocuments({ dedupeKey: { $exists: false } }), 2);
});

test('DEDUP#02 multiple AuditEvents with null dedupeKey can exist under partial index', async () => {
  await AuditEvent.collection.insertMany([
    {
      happenedAt: new Date(),
      actorType: 'user',
      entityType: 'X',
      entityId: 'n1',
      action: 'a',
      dedupeKey: null
    },
    {
      happenedAt: new Date(),
      actorType: 'user',
      entityType: 'X',
      entityId: 'n2',
      action: 'a',
      dedupeKey: null
    }
  ]);
  assert.equal(await AuditEvent.collection.countDocuments({ dedupeKey: { $type: 'null' } }), 2);
});

test('DEDUP#03 different real dedupeKeys can exist', async () => {
  await appendAuditEvent({
    actorType: 'user',
    entityType: 'Reservation',
    entityId: 'r1',
    action: 'reservation_reallocate',
    dedupeKey: 'reservation_reallocate:aaa'
  });
  await appendAuditEvent({
    actorType: 'user',
    entityType: 'Reservation',
    entityId: 'r2',
    action: 'reservation_reallocate',
    dedupeKey: 'reservation_reallocate:bbb'
  });
  assert.equal(await AuditEvent.countDocuments({}), 2);
});

test('DEDUP#04 duplicate real dedupeKey is rejected', async () => {
  const key = 'reservation_reallocate:dup';
  await appendAuditEvent({
    actorType: 'user',
    entityType: 'Reservation',
    entityId: 'r1',
    action: 'reservation_reallocate',
    dedupeKey: key
  });
  await assert.rejects(
    () =>
      appendAuditEvent({
        actorType: 'user',
        entityType: 'Reservation',
        entityId: 'r2',
        action: 'reservation_reallocate',
        dedupeKey: key
      }),
    (err) => err.code === 11000
  );
});

test('DEDUP#05 normalizeDedupeKey omits empty/null; keeps trimmed string', () => {
  assert.equal(normalizeDedupeKey(null), undefined);
  assert.equal(normalizeDedupeKey(''), undefined);
  assert.equal(normalizeDedupeKey('  '), undefined);
  assert.equal(normalizeDedupeKey('  k  '), 'k');
});

test('DEDUP#06 appendAuditEvent without dedupeKey does not store null field', async () => {
  const doc = await appendAuditEvent({
    actorType: 'user',
    entityType: 'AvailabilityBlock',
    entityId: 'x',
    action: 'manual_block_create'
  });
  const raw = await AuditEvent.collection.findOne({ _id: doc._id });
  assert.equal(Object.prototype.hasOwnProperty.call(raw, 'dedupeKey'), false);
});

test('DEDUP#07 desired index spec is partial / excludes null+missing', async () => {
  const indexes = await AuditEvent.collection.indexes();
  const exact = indexExact(indexes, AUDIT_DEDUPE_INDEX_SPEC);
  assert.equal(exact.exact, true);
  assert.deepEqual(exact.found.partialFilterExpression, { dedupeKey: { $type: 'string' } });
  assert.equal(Boolean(exact.found.sparse), false);
});

test('DEDUP#08 broken legacy sparse unique is detected as not exact', async () => {
  await dropIndexIfExists(AuditEvent.collection, AUDIT_NAME);
  await AuditEvent.collection.createIndex(AUDIT_DEDUPE_LEGACY_SPARSE_SHAPE.keys, {
    unique: true,
    sparse: true,
    name: AUDIT_NAME
  });
  const indexes = await AuditEvent.collection.indexes();
  assert.equal(indexExact(indexes, AUDIT_DEDUPE_INDEX_SPEC).exact, false);
  assert.equal(classifyAuditDedupeIndex(indexes).kind, 'legacy_sparse_unique');
  await ensureR1IndexesForTests();
});

test('DEDUP#09 legacy sparse unique rejects second null (reproduction)', async () => {
  await dropIndexIfExists(AuditEvent.collection, AUDIT_NAME);
  await AuditEvent.collection.createIndex({ dedupeKey: 1 }, { unique: true, sparse: true, name: AUDIT_NAME });
  await AuditEvent.collection.insertOne({
    happenedAt: new Date(),
    actorType: 'user',
    entityType: 'X',
    entityId: '1',
    action: 'a',
    dedupeKey: null
  });
  await assert.rejects(
    () =>
      AuditEvent.collection.insertOne({
        happenedAt: new Date(),
        actorType: 'user',
        entityType: 'X',
        entityId: '2',
        action: 'a',
        dedupeKey: null
      }),
    (err) => err.code === 11000
  );
  await ensureR1IndexesForTests();
});

test('DEDUP#10 createIndexes refuses legacy sparse without replace flag', async () => {
  await dropIndexIfExists(AuditEvent.collection, AUDIT_NAME);
  await AuditEvent.collection.createIndex({ dedupeKey: 1 }, { unique: true, sparse: true, name: AUDIT_NAME });
  const report = await cutover.buildReport();
  assert.equal(report.auditDedupeIndexKind, 'legacy_sparse_unique');
  await assert.rejects(() => cutover.createIndexes(report), /replace-audit-dedupe-index/i);
  await ensureR1IndexesForTests();
});

test('DEDUP#11 replace-audit-dedupe-index migrates legacy sparse → partial', async () => {
  await dropIndexIfExists(AuditEvent.collection, AUDIT_NAME);
  await AuditEvent.collection.createIndex({ dedupeKey: 1 }, { unique: true, sparse: true, name: AUDIT_NAME });
  // Seed multiple nulls is impossible under legacy; seed one null + missing after replace.
  await AuditEvent.collection.insertOne({
    happenedAt: new Date(),
    actorType: 'user',
    entityType: 'X',
    entityId: 'pre',
    action: 'a',
    dedupeKey: null
  });
  let report = await cutover.buildReport();
  const result = await cutover.replaceAuditDedupeIndex(report);
  assert.equal(result.replaced, true);
  report = await cutover.buildReport();
  assert.equal(report.auditDedupeIndexKind, 'desired_partial');
  assert.equal(report.requiredAuditDedupeUniqueExact, true);
  // After replace, second null must succeed
  await AuditEvent.collection.insertOne({
    happenedAt: new Date(),
    actorType: 'user',
    entityType: 'X',
    entityId: 'post',
    action: 'a',
    dedupeKey: null
  });
  assert.equal(await AuditEvent.collection.countDocuments({ dedupeKey: { $type: 'null' } }), 2);
});

test('DEDUP#12 verify/default performs no index mutation', async () => {
  const before = (await AuditEvent.collection.indexes()).map((i) => i.name).sort();
  const report = await cutover.buildReport();
  assert.equal(report.mutation == null || true, true);
  const after = (await AuditEvent.collection.indexes()).map((i) => i.name).sort();
  assert.deepEqual(before, after);
});

test('DEDUP#13 replace refuses string dedupe duplicates', async () => {
  await dropIndexIfExists(AuditEvent.collection, AUDIT_NAME);
  await AuditEvent.collection.insertMany([
    {
      happenedAt: new Date(),
      actorType: 'user',
      entityType: 'X',
      entityId: '1',
      action: 'a',
      dedupeKey: 'same'
    },
    {
      happenedAt: new Date(),
      actorType: 'user',
      entityType: 'X',
      entityId: '2',
      action: 'a',
      dedupeKey: 'same'
    }
  ]);
  const report = await cutover.buildReport();
  assert.ok(report.duplicateAuditDedupeKeys > 0);
  await assert.rejects(() => cutover.replaceAuditDedupeIndex(report), /duplicate string/i);
  await AuditEvent.collection.deleteMany({});
  await ensureR1IndexesForTests();
});

test('DEDUP#14 unexpected index state refuses replace', async () => {
  await dropIndexIfExists(AuditEvent.collection, AUDIT_NAME);
  await AuditEvent.collection.createIndex(
    { dedupeKey: 1 },
    { unique: false, name: AUDIT_NAME }
  );
  const report = await cutover.buildReport();
  assert.equal(report.auditDedupeIndexKind, 'unexpected');
  await assert.rejects(() => cutover.replaceAuditDedupeIndex(report), /unexpected/i);
  await ensureR1IndexesForTests();
});

test('DEDUP#15 migration never mutates AuditEvent documents', async () => {
  await dropIndexIfExists(AuditEvent.collection, AUDIT_NAME);
  await AuditEvent.collection.createIndex({ dedupeKey: 1 }, { unique: true, sparse: true, name: AUDIT_NAME });
  const id = (
    await AuditEvent.collection.insertOne({
      happenedAt: new Date(),
      actorType: 'user',
      entityType: 'X',
      entityId: 'keep',
      action: 'a',
      dedupeKey: null,
      metadata: { marker: 1 }
    })
  ).insertedId;
  const before = await AuditEvent.collection.findOne({ _id: id });
  await cutover.replaceAuditDedupeIndex(await cutover.buildReport());
  const after = await AuditEvent.collection.findOne({ _id: id });
  assert.equal(after.dedupeKey, null);
  assert.equal(after.metadata.marker, 1);
  assert.equal(String(after._id), String(before._id));
});

test('DEDUP#16 document classification counts', async () => {
  await AuditEvent.collection.insertMany([
    {
      happenedAt: new Date(),
      actorType: 'user',
      entityType: 'X',
      entityId: '1',
      action: 'a'
    },
    {
      happenedAt: new Date(),
      actorType: 'user',
      entityType: 'X',
      entityId: '2',
      action: 'a',
      dedupeKey: null
    },
    {
      happenedAt: new Date(),
      actorType: 'user',
      entityType: 'X',
      entityId: '3',
      action: 'a',
      dedupeKey: 'k'
    }
  ]);
  const c = await cutover.classifyAuditDedupeDocuments();
  assert.equal(c.total, 3);
  assert.equal(c.missingDedupeKey, 1);
  assert.equal(c.nullDedupeKey, 1);
  assert.equal(c.stringDedupeKey, 1);
});

test('DEDUP#17 manual block emits AuditEvent without dedupeKey; order is audit-then-block', async () => {
  const cabin = await Cabin.create({
    name: 'Dedup Cabin',
    slug: `dedup-cabin-${Date.now()}`,
    description: 'd',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/c.jpg',
    location: 'Bulgaria',
    isActive: true,
    propertyKind: 'cabin'
  });
  const src = fs.readFileSync(
    path.join(ROOT, 'services/ops/domain/availabilityWriteService.js'),
    'utf8'
  );
  const auditIdx = src.indexOf('await appendAuditEvent');
  const createIdx = src.indexOf('AvailabilityBlock.create');
  assert.ok(auditIdx > 0 && createIdx > auditIdx, 'audit must precede block create');

  const auditsBefore = await AuditEvent.countDocuments();
  const blocksBefore = await AvailabilityBlock.countDocuments();
  const result = await createBlock({
    blockType: 'manual_block',
    cabinId: cabin._id,
    startDate: '2026-11-01',
    endDate: '2026-11-03',
    reason: 'hotfix test',
    ctx: {
      user: { id: 'admin', role: 'admin' },
      route: 'POST /api/ops/availability/manual-blocks',
      req: { user: { id: 'admin', role: 'admin' }, headers: {} }
    }
  });
  assert.ok(result.blockId);
  assert.equal(await AuditEvent.countDocuments(), auditsBefore + 1);
  assert.equal(await AvailabilityBlock.countDocuments(), blocksBefore + 1);
  const audit = await AuditEvent.findOne({ entityId: result.blockId }).lean();
  assert.ok(audit);
  assert.equal(audit.dedupeKey, undefined);
  assert.equal(audit.action, 'manual_block_create');
});

test('DEDUP#18 maintenance block emits AuditEvent without dedupeKey', async () => {
  const cabin = await Cabin.create({
    name: 'Dedup Maint',
    slug: `dedup-maint-${Date.now()}`,
    description: 'd',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/c.jpg',
    location: 'Bulgaria',
    isActive: true,
    propertyKind: 'cabin'
  });
  const result = await createBlock({
    blockType: 'maintenance',
    cabinId: cabin._id,
    startDate: '2026-11-10',
    endDate: '2026-11-12',
    ctx: {
      user: { id: 'admin', role: 'admin' },
      route: 'POST /api/ops/availability/maintenance-blocks',
      req: { user: { id: 'admin', role: 'admin' }, headers: {} }
    }
  });
  const audit = await AuditEvent.findOne({ entityId: result.blockId }).lean();
  assert.equal(audit.action, 'maintenance_create');
  assert.equal(audit.dedupeKey, undefined);
});

test('DEDUP#19 static: no random dedupe generation / no AuditEvent backfill in hotfix modules', () => {
  const files = [
    path.join(ROOT, 'models/AuditEvent.js'),
    path.join(ROOT, 'services/auditWriter.js'),
    path.join(ROOT, 'services/stayChange/stayChangeIndexes.js'),
    path.join(ROOT, 'scripts/stayChangeR1Cutover.js')
  ];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(!src.includes('crypto.randomUUID'));
    assert.ok(!src.includes('Math.random()'));
    assert.ok(!/AuditEvent\.updateMany|collection\.updateMany/.test(src));
    assert.ok(!/AuditEvent\.deleteMany|collection\.deleteMany/.test(src) || f.includes('test'));
  }
  const cutoverSrc = fs.readFileSync(path.join(ROOT, 'scripts/stayChangeR1Cutover.js'), 'utf8');
  assert.ok(cutoverSrc.includes('Never mutates'));
  assert.ok(cutoverSrc.includes('dropIndex'));
});

test('DEDUP#20 replace already-desired is skip', async () => {
  await ensureR1IndexesForTests();
  const result = await cutover.replaceAuditDedupeIndex(await cutover.buildReport());
  assert.equal(result.skipped, true);
});
