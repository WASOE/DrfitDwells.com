/**
 * SMTP health and certificate expiry tests — Batch 2.
 * Run: cd server && node --test scripts/smtpHealth.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const ManualReviewItem = require('../models/ManualReviewItem');
const {
  SMTP_TRANSPORT_UNHEALTHY,
  SMTP_CERT_EXPIRING,
  getSafeSmtpDiagnostics,
  runSmtpHealthCheck
} = require('../services/email/smtpHealthService');
const {
  runCheckOnce,
  __setRunSmtpHealthCheckForTesting,
  __resetRunSmtpHealthCheckForTesting,
  stopSmtpHealthSchedulerForTest
} = require('../services/email/smtpHealthScheduler');

let mongoServer;
const originalEnv = { ...process.env };

function sampleDiagnostics() {
  return {
    configured: true,
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    tlsServername: 'mail.example.com',
    source: 'SMTP_HOST',
    hasAuth: true
  };
}

function healthyCertResult() {
  return {
    readOk: true,
    ok: true,
    expiring: false,
    diagnostics: sampleDiagnostics(),
    warningDays: 14,
    validTo: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    daysRemaining: 90
  };
}

function expiringCertResult(daysRemaining = 10) {
  const validTo = new Date(Date.now() + daysRemaining * 24 * 60 * 60 * 1000);
  return {
    readOk: true,
    ok: false,
    expiring: true,
    diagnostics: sampleDiagnostics(),
    warningDays: 14,
    validTo: validTo.toISOString(),
    daysRemaining
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await ManualReviewItem.syncIndexes();
});

test.after(async () => {
  process.env = { ...originalEnv };
  __resetRunSmtpHealthCheckForTesting();
  stopSmtpHealthSchedulerForTest();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_SECURE = 'false';
  process.env.SMTP_TLS_SERVERNAME = 'mail.example.com';
  process.env.SMTP_USER = 'smtp-user';
  process.env.SMTP_PASS = 'super-secret-password';
  delete process.env.SMTP_URL;
  await ManualReviewItem.deleteMany({});
  __resetRunSmtpHealthCheckForTesting();
  stopSmtpHealthSchedulerForTest();
});

test('1. verify failure opens one smtp_transport_unhealthy ManualReviewItem', async () => {
  await runSmtpHealthCheck({
    verifyTransport: async () => ({
      ok: false,
      error: 'connection refused',
      diagnostics: sampleDiagnostics()
    }),
    checkCertificate: async () => ({ readOk: false, ok: true, expiring: false })
  });

  const items = await ManualReviewItem.find({ category: SMTP_TRANSPORT_UNHEALTHY, status: 'open' }).lean();
  assert.equal(items.length, 1);
  assert.equal(items[0].severity, 'critical');
  assert.equal(items[0].title, 'SMTP transport unhealthy');
  assert.equal(items[0].evidence.host, 'smtp.example.com');
  assert.equal(items[0].evidence.port, 587);
  assert.equal(items[0].evidence.tlsServername, 'mail.example.com');
});

test('2. repeated verify failure does not create duplicate open items', async () => {
  const deps = {
    verifyTransport: async () => ({
      ok: false,
      error: 'still down',
      diagnostics: sampleDiagnostics()
    }),
    checkCertificate: async () => ({ readOk: false, ok: true, expiring: false })
  };

  await runSmtpHealthCheck(deps);
  await runSmtpHealthCheck(deps);

  const count = await ManualReviewItem.countDocuments({
    category: SMTP_TRANSPORT_UNHEALTHY,
    status: 'open'
  });
  assert.equal(count, 1);
});

test('3. later verify success resolves smtp_transport_unhealthy', async () => {
  await runSmtpHealthCheck({
    verifyTransport: async () => ({
      ok: false,
      error: 'down',
      diagnostics: sampleDiagnostics()
    }),
    checkCertificate: async () => ({ readOk: false, ok: true, expiring: false })
  });

  await runSmtpHealthCheck({
    verifyTransport: async () => ({ ok: true, diagnostics: sampleDiagnostics() }),
    checkCertificate: async () => healthyCertResult()
  });

  const openCount = await ManualReviewItem.countDocuments({
    category: SMTP_TRANSPORT_UNHEALTHY,
    status: 'open'
  });
  const resolved = await ManualReviewItem.findOne({
    category: SMTP_TRANSPORT_UNHEALTHY,
    status: 'resolved'
  }).lean();
  assert.equal(openCount, 0);
  assert.ok(resolved);
  assert.match(resolved.resolution?.note || '', /verification succeeded/i);
});

test('4. cert expiring within warning window opens smtp_cert_expiring', async () => {
  await runSmtpHealthCheck({
    verifyTransport: async () => ({ ok: true, diagnostics: sampleDiagnostics() }),
    checkCertificate: async () => expiringCertResult(10)
  });

  const item = await ManualReviewItem.findOne({
    category: SMTP_CERT_EXPIRING,
    status: 'open'
  }).lean();
  assert.ok(item);
  assert.equal(item.severity, 'high');
  assert.equal(item.title, 'SMTP certificate expiring');
  assert.equal(item.evidence.daysRemaining, 10);
  assert.ok(item.evidence.validTo);
});

test('5. healthy cert resolves smtp_cert_expiring', async () => {
  await ManualReviewItem.create({
    category: SMTP_CERT_EXPIRING,
    severity: 'high',
    status: 'open',
    entityType: 'SmtpHealth',
    entityId: 'smtp.example.com:587',
    title: 'SMTP certificate expiring',
    details: 'seeded',
    evidence: { daysRemaining: 5 }
  });

  await runSmtpHealthCheck({
    verifyTransport: async () => ({ ok: true, diagnostics: sampleDiagnostics() }),
    checkCertificate: async () => healthyCertResult()
  });

  const openCount = await ManualReviewItem.countDocuments({
    category: SMTP_CERT_EXPIRING,
    status: 'open'
  });
  const resolved = await ManualReviewItem.findOne({
    category: SMTP_CERT_EXPIRING,
    status: 'resolved'
  }).lean();
  assert.equal(openCount, 0);
  assert.ok(resolved);
});

test('6. diagnostics never include password or auth secret', async () => {
  const diagnostics = getSafeSmtpDiagnostics();
  const result = await runSmtpHealthCheck({
    verifyTransport: async () => ({
      ok: false,
      error: 'auth failed',
      diagnostics
    }),
    checkCertificate: async () => ({ readOk: false, ok: true, expiring: false })
  });

  const blob = JSON.stringify({ diagnostics, result }).toLowerCase();
  assert.equal(blob.includes('super-secret-password'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(diagnostics, 'pass'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(diagnostics, 'password'), false);
  assert.equal(diagnostics.hasAuth, true);

  const item = await ManualReviewItem.findOne({ category: SMTP_TRANSPORT_UNHEALTHY }).lean();
  const evidenceBlob = JSON.stringify(item?.evidence || {}).toLowerCase();
  assert.equal(evidenceBlob.includes('super-secret-password'), false);
  assert.equal(evidenceBlob.includes('smtp-user'), false);
});

test('7. scheduler prevents overlapping runs', async () => {
  let release;
  __setRunSmtpHealthCheckForTesting(
    () =>
      new Promise((resolve) => {
        release = () =>
          resolve({
            lastStatus: 'healthy',
            lastError: null,
            diagnostics: sampleDiagnostics(),
            certificate: { readOk: true, expiring: false, validTo: null, daysRemaining: 90 }
          });
      })
  );

  const first = runCheckOnce();
  const second = await runCheckOnce();
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'in_progress');
  release();
  const firstResult = await first;
  assert.equal(firstResult.skipped, false);
});
