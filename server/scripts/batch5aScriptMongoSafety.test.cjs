'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const {
  getRequiredMongoUriFromEnv,
  assertProductionApplyAllowed,
  sanitizeMongoHost,
  extractDatabaseName,
  resolveScriptMode,
  printConnectionBanner,
  connectScriptMongo
} = require('./lib/scriptMongoSafety.cjs');

const auditScript = path.join(__dirname, 'auditHistoricalDirectSales.cjs');
const upsertScript = path.join(__dirname, 'upsertInventoryOperatingPeriods.cjs');
const correctScript = path.join(__dirname, 'correctHistoricalReportingMetadata.cjs');

async function ensureDisconnected() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

test('missing Mongo URI throws before connect and matches required message', () => {
  assert.throws(
    () => getRequiredMongoUriFromEnv({}),
    (err) =>
      err.code === 'MONGO_URI_REQUIRED' &&
      err.message === 'ERROR: MONGODB_URI or MONGO_URI is required.' &&
      err.exitCode === 1
  );
});

test('missing Mongo URI exits before mongoose.connect in audit script', () => {
  // Empty strings prevent dotenv from filling URI from server/.env (dotenv does not override).
  const clean = spawnSync(process.execPath, [auditScript], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MONGODB_URI: '',
      MONGO_URI: ''
    },
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });
  assert.notEqual(clean.status, 0);
  assert.match(clean.stderr || '', /ERROR: MONGODB_URI or MONGO_URI is required\./);
  assert.doesNotMatch(clean.stderr || '', /ECONNREFUSED|MongoServerError/i);
});

test('explicit localhost URI is accepted by URI helpers', () => {
  const uri = 'mongodb://127.0.0.1:27017/drift-dwells-booking';
  assert.equal(getRequiredMongoUriFromEnv({ MONGODB_URI: uri }), uri);
  assert.equal(sanitizeMongoHost(uri), '127.0.0.1');
  assert.equal(extractDatabaseName(uri), 'drift-dwells-booking');
});

test('safe banner contains host and database name without credentials', () => {
  const uri = 'mongodb://prod_user:s3cret-pass@cluster0.example.net:27017/drift_prod';
  assert.equal(sanitizeMongoHost(uri), 'cluster0.example.net');
  assert.equal(extractDatabaseName(uri), 'drift_prod');

  let written = '';
  printConnectionBanner(
    {
      mongoHost: sanitizeMongoHost(uri),
      databaseName: extractDatabaseName(uri),
      mode: 'read-only'
    },
    {
      write(chunk) {
        written += chunk;
      }
    }
  );
  const banner = JSON.parse(written);
  assert.equal(banner.mongoHost, 'cluster0.example.net');
  assert.equal(banner.databaseName, 'drift_prod');
  assert.equal(banner.mode, 'read-only');
  assert.equal(written.includes('prod_user'), false);
  assert.equal(written.includes('s3cret-pass'), false);
  assert.equal(written.includes('mongodb://'), false);
});

test('mode helpers: audit read-only; upsert/correction dry-run vs apply', () => {
  assert.equal(resolveScriptMode({ readOnly: true }), 'read-only');
  assert.equal(resolveScriptMode({ apply: false }), 'dry-run');
  assert.equal(resolveScriptMode({ apply: true }), 'apply');
});

test('production --apply without --confirm-production-write exits without connect', async () => {
  let connected = false;
  const fakeMongoose = {
    connect: async () => {
      connected = true;
    },
    connection: { host: null, name: null }
  };
  await assert.rejects(
    () =>
      connectScriptMongo(fakeMongoose, {
        apply: true,
        confirmProductionWrite: false,
        mode: 'apply',
        env: {
          MONGODB_URI: 'mongodb://127.0.0.1:27017/test',
          NODE_ENV: 'production'
        }
      }),
    (err) => err.code === 'PRODUCTION_WRITE_CONFIRM_REQUIRED' && connected === false
  );
  assert.equal(connected, false);

  assert.throws(
    () =>
      assertProductionApplyAllowed({
        apply: true,
        confirmProductionWrite: false,
        env: { APP_ENV: 'production' }
      }),
    (err) => err.code === 'PRODUCTION_WRITE_CONFIRM_REQUIRED'
  );
});

test('production apply with both flags reaches connect; development apply needs only --apply', async () => {
  let connected = false;
  const fakeMongoose = {
    async connect() {
      connected = true;
    },
    connection: { host: '127.0.0.1', name: 'test_db' }
  };

  let banner = '';
  await connectScriptMongo(fakeMongoose, {
    apply: true,
    confirmProductionWrite: true,
    mode: 'apply',
    env: {
      MONGODB_URI: 'mongodb://127.0.0.1:27017/test_db',
      NODE_ENV: 'production'
    },
    bannerStream: {
      write(chunk) {
        banner += chunk;
      }
    }
  });
  assert.equal(connected, true);
  assert.equal(JSON.parse(banner).mode, 'apply');

  connected = false;
  banner = '';
  await connectScriptMongo(fakeMongoose, {
    apply: true,
    confirmProductionWrite: false,
    mode: 'apply',
    env: {
      MONGODB_URI: 'mongodb://127.0.0.1:27017/test_db',
      NODE_ENV: 'development'
    },
    bannerStream: {
      write(chunk) {
        banner += chunk;
      }
    }
  });
  assert.equal(connected, true);
  assert.equal(JSON.parse(banner).mode, 'apply');
});

test('connectScriptMongo prints dry-run / read-only modes correctly', async () => {
  const fakeMongoose = {
    async connect() {},
    connection: { host: '127.0.0.1', name: 'local' }
  };
  let banner = '';
  await connectScriptMongo(fakeMongoose, {
    readOnly: true,
    mode: 'read-only',
    env: { MONGODB_URI: 'mongodb://127.0.0.1:27017/local' },
    bannerStream: {
      write(chunk) {
        banner += chunk;
      }
    }
  });
  assert.equal(JSON.parse(banner).mode, 'read-only');

  banner = '';
  await connectScriptMongo(fakeMongoose, {
    apply: false,
    mode: 'dry-run',
    env: { MONGO_URI: 'mongodb://127.0.0.1:27017/local' },
    bannerStream: {
      write(chunk) {
        banner += chunk;
      }
    }
  });
  assert.equal(JSON.parse(banner).mode, 'dry-run');
});

// Integration tests share mongoose — keep strictly sequential.
test('upsert and correction scripts honour dry-run and production confirm flags', async () => {
  await ensureDisconnected();
  const mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  const periodsFile = path.join(os.tmpdir(), `periods-${Date.now()}.json`);
  fs.writeFileSync(
    periodsFile,
    JSON.stringify([
      {
        propertyKind: 'cabin',
        entityType: 'cabin',
        entityId: '507f1f77bcf86cd799439011',
        operatingFrom: '2026-01-01',
        operatingTo: null,
        reason: 'opened',
        source: 'test',
        notes: ''
      }
    ])
  );

  const { main: upsertMain } = require('./upsertInventoryOperatingPeriods.cjs');
  const { main: correctMain } = require('./correctHistoricalReportingMetadata.cjs');
  const InventoryOperatingPeriod = require('../models/InventoryOperatingPeriod');
  const Booking = require('../models/Booking');

  const dry = await upsertMain(
    ['node', upsertScript, '--file', periodsFile],
    { MONGODB_URI: uri, NODE_ENV: 'test' }
  );
  assert.equal(dry.mode, 'dry-run');
  assert.equal(dry.written, 0);

  await assert.rejects(
    () =>
      upsertMain(['node', upsertScript, '--file', periodsFile, '--apply'], {
        MONGODB_URI: uri,
        NODE_ENV: 'production'
      }),
    (err) => err.code === 'PRODUCTION_WRITE_CONFIRM_REQUIRED'
  );

  await ensureDisconnected();
  await mongoose.connect(uri);
  assert.equal(await InventoryOperatingPeriod.countDocuments({}), 0);
  await mongoose.disconnect();

  const applied = await upsertMain(
    [
      'node',
      upsertScript,
      '--file',
      periodsFile,
      '--apply',
      '--confirm-production-write'
    ],
    { MONGODB_URI: uri, NODE_ENV: 'production' }
  );
  assert.equal(applied.mode, 'apply');
  assert.equal(applied.written, 1);

  await ensureDisconnected();
  await mongoose.connect(uri);
  assert.equal(await InventoryOperatingPeriod.countDocuments({}), 1);

  const bookingId = new mongoose.Types.ObjectId();
  await Booking.collection.insertOne({
    _id: bookingId,
    checkIn: new Date('2026-08-01T00:00:00.000Z'),
    checkOut: new Date('2026-08-02T00:00:00.000Z'),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'x@test.com', phone: '+1' },
    totalPrice: 10,
    status: 'confirmed',
    paymentMethod: 'card',
    cabinId: new mongoose.Types.ObjectId(),
    isTest: false,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  await mongoose.disconnect();

  const correctDry = await correctMain(
    ['node', correctScript, '--mark-test', String(bookingId)],
    { MONGODB_URI: uri, NODE_ENV: 'development' }
  );
  assert.equal(correctDry.mode, 'dry-run');
  assert.equal(correctDry.written, false);

  await ensureDisconnected();
  await mongoose.connect(uri);
  assert.equal((await Booking.findById(bookingId).lean()).isTest, false);
  await mongoose.disconnect();

  const correctApplied = await correctMain(
    ['node', correctScript, '--mark-test', String(bookingId), '--apply'],
    { MONGODB_URI: uri, NODE_ENV: 'development' }
  );
  assert.equal(correctApplied.mode, 'apply');
  assert.equal(correctApplied.written, true);

  await ensureDisconnected();
  await mongoose.connect(uri);
  const after = await Booking.findById(bookingId).lean();
  assert.equal(after.isTest, true);
  assert.equal(after.status, 'confirmed');
  assert.equal(after.totalPrice, 10);
  assert.equal(after.guestInfo.email, 'x@test.com');
  await mongoose.disconnect();

  fs.unlinkSync(periodsFile);
  await mongoServer.stop();
});

function writeTempPeriodsFile() {
  const periodsFile = path.join(os.tmpdir(), `periods-stdout-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(
    periodsFile,
    JSON.stringify([
      {
        propertyKind: 'cabin',
        entityType: 'cabin',
        entityId: '507f1f77bcf86cd799439011',
        operatingFrom: '2026-01-01',
        operatingTo: null,
        reason: 'opened',
        source: 'test',
        notes: ''
      }
    ])
  );
  return periodsFile;
}

test('upsert dry-run stdout is exactly one JSON.parse-able document; banner on stderr', async () => {
  await ensureDisconnected();
  const mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  const periodsFile = writeTempPeriodsFile();

  const result = spawnSync(process.execPath, [upsertScript, '--file', periodsFile], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MONGODB_URI: uri,
      MONGO_URI: ''
    },
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.mode, 'dry-run');
  assert.equal(parsed.count, 1);
  assert.ok(Array.isArray(parsed.proposals));
  assert.equal(parsed.ok, undefined);
  assert.match(result.stderr || '', /"mongoHost"/);
  assert.match(result.stderr || '', /"mode": "dry-run"/);
  assert.doesNotMatch(result.stdout || '', /"mongoHost"/);

  fs.unlinkSync(periodsFile);
  await mongoServer.stop();
});

test('upsert apply stdout is exactly one JSON.parse-able document with mocked writes', async () => {
  await ensureDisconnected();
  const mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  const periodsFile = writeTempPeriodsFile();

  const { main: upsertMain } = require('./upsertInventoryOperatingPeriods.cjs');
  const InventoryOperatingPeriod = require('../models/InventoryOperatingPeriod');
  const auditWriter = require('../services/auditWriter');

  const origFindOneAndUpdate = InventoryOperatingPeriod.findOneAndUpdate;
  const origAppendAudit = auditWriter.appendAuditEvent;
  let writeCalls = 0;
  InventoryOperatingPeriod.findOneAndUpdate = async () => {
    writeCalls += 1;
    return { _id: new mongoose.Types.ObjectId() };
  };
  auditWriter.appendAuditEvent = async () => {};

  const stdoutChunks = [];
  const origLog = console.log;
  console.log = (...args) => {
    stdoutChunks.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  };

  try {
    const applied = await upsertMain(
      ['node', upsertScript, '--file', periodsFile, '--apply'],
      { MONGODB_URI: uri, NODE_ENV: 'development' }
    );
    assert.equal(applied.mode, 'apply');
    assert.equal(applied.written, 1);
    assert.equal(writeCalls, 1);
    assert.equal(stdoutChunks.length, 1, 'apply must emit a single console.log');
    const parsed = JSON.parse(stdoutChunks[0]);
    assert.equal(parsed.mode, 'apply');
    assert.equal(parsed.ok, true);
    assert.equal(parsed.written, 1);
    assert.equal(parsed.count, 1);
    assert.ok(Array.isArray(parsed.proposals));
    assert.equal(parsed.proposals.length, 1);
  } finally {
    console.log = origLog;
    InventoryOperatingPeriod.findOneAndUpdate = origFindOneAndUpdate;
    auditWriter.appendAuditEvent = origAppendAudit;
    fs.unlinkSync(periodsFile);
    await ensureDisconnected();
    await mongoServer.stop();
  }
});
