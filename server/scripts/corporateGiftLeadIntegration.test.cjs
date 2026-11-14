'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Lead = require('../models/CorporateGiftLead');
const OpsUser = require('../models/OpsUser');
const OpsNotification = require('../models/OpsNotification');
const { createCorporateGiftLead, attemptDelivery, retryDueDeliveries } = require('../services/corporateGiftLeads/service');
const { resolveOpsApiModule, resolveOpsFrontendModule } = require('../services/ops/opsModuleRegistry');
const { requireOpsModuleAccess } = require('../middleware/requireOpsModuleAccess');

let mongo;
const sent = { sendEmail: async () => ({ success: true, method: 'sent' }) };
const payload = (key, extra = {}) => ({ type: 'nomination', idempotencyKey: key, company: 'Example Ltd', companyWebsite: 'https://example.com', consent: true, ...extra });

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([Lead.syncIndexes(), OpsUser.syncIndexes(), OpsNotification.syncIndexes()]);
  await OpsUser.create({ email: 'admin@example.com', name: 'Admin', passwordHash: 'hash', role: 'admin' });
});
test.after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
test.beforeEach(async () => { await Lead.deleteMany({}); await OpsNotification.deleteMany({}); });

test('nomination retries coalesce by company while separate HR requests remain distinct', async () => {
  const first = await createCorporateGiftLead(payload('first_key_123'), { emailService: sent });
  const replay = await createCorporateGiftLead(payload('first_key_123'), { emailService: sent });
  const conflict = await createCorporateGiftLead(payload('first_key_123', { company: 'Different company' }), { emailService: sent });
  const second = await createCorporateGiftLead(payload('second_key_123', { company: ' EXAMPLE  LTD ', hrContact: 'People team', hrEmail: 'HR@EXAMPLE.COM' }), { emailService: sent });
  assert.equal(String(first.id), String(replay.id));
  assert.equal(conflict.conflict, true);
  assert.equal(String(first.id), String(second.id));
  const row = await Lead.findById(first.id).lean();
  assert.equal(row.requestKeys.length, 2);
  assert.deepEqual(row.hrContacts, ['People team']);
  assert.deepEqual(row.hrEmails, ['hr@example.com']);
  const hr = { type: 'hr', contactName: 'HR', contactEmail: 'hr@example.com' };
  await createCorporateGiftLead(payload('hr_first_key', hr), { emailService: sent });
  await createCorporateGiftLead(payload('hr_second_key', hr), { emailService: sent });
  assert.equal(await Lead.countDocuments(), 3);
  const notification = await OpsNotification.findOne().lean();
  assert.equal(notification.url, `/ops/corporate-gift-leads/${first.id}`);
  assert.equal(row.email.status, 'sent');
});

test('failed email stays visible and a retry recovers without contacting a nominee', async () => {
  const calls = [];
  const failed = { sendEmail: async (args) => { calls.push(args); return { success: false, error: 'SMTP down' }; } };
  const result = await createCorporateGiftLead(payload('delivery_key_123'), { emailService: failed });
  let lead = await Lead.findById(result.id).lean();
  assert.equal(lead.email.status, 'failed');
  assert.equal(lead.email.lastError, 'SMTP down');
  assert.equal(calls[0].to, 'jose@driftdwells.com');
  assert.equal((await attemptDelivery(result.id, 'email', { emailService: sent, force: true })).status, 'sent');
  lead = await Lead.findById(result.id).lean();
  assert.equal(lead.email.status, 'sent');
});

test('notification failure remains recoverable and retry creates a single direct link', async () => {
  const original = OpsNotification.updateOne;
  OpsNotification.updateOne = async () => { throw new Error('inbox unavailable'); };
  let result;
  try {
    result = await createCorporateGiftLead(payload('notification_key_123'), { emailService: sent });
  } finally { OpsNotification.updateOne = original; }
  const failed = await Lead.findById(result.id).lean();
  assert.equal(failed.notification.status, 'failed');
  assert.equal(failed.notification.lastError, 'inbox unavailable');
  assert.equal((await attemptDelivery(result.id, 'notification', { force: true })).status, 'sent');
  assert.equal(await OpsNotification.countDocuments({ url: `/ops/corporate-gift-leads/${result.id}` }), 1);
});

test('concurrent nominations coalesce safely', async () => {
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) =>
    createCorporateGiftLead(payload(`concurrent_key_${i}`, { hrEmail: `hr${i}@example.com` }), { emailService: sent })));
  assert.equal(new Set(results.map((result) => String(result.id))).size, 1);
  const lead = await Lead.findOne().lean();
  assert.equal(lead.requestKeys.length, 5);
  assert.equal(lead.hrEmails.length, 5);
  assert.equal(await Lead.countDocuments(), 1);
});

test('scheduled retry recovers failed email and expired notification lease', async () => {
  const result = await createCorporateGiftLead(payload('scheduled_retry_123'), { emailService: sent });
  const old = new Date(Date.now() - 6 * 60 * 1000);
  await Lead.updateOne({ _id: result.id }, { $set: {
    'email.status': 'failed', 'email.claimedAt': old,
    'notification.status': 'sending', 'notification.claimedAt': old
  } });
  const emailService = require('../services/emailService');
  const original = emailService.sendEmail;
  emailService.sendEmail = sent.sendEmail;
  try { await retryDueDeliveries(); } finally { emailService.sendEmail = original; }
  const lead = await Lead.findById(result.id).lean();
  assert.equal(lead.email.status, 'sent');
  assert.equal(lead.notification.status, 'sent');
  assert.equal(await OpsNotification.countDocuments({ url: `/ops/corporate-gift-leads/${result.id}` }), 1);
});

test('public endpoint persists both modes and rejects conflicting replays', async () => {
  const routePath = require.resolve('../routes/publicCorporateGiftLeadRoutes');
  delete require.cache[routePath];
  const app = express();
  app.use(express.json());
  app.use('/leads', require(routePath));
  const nomination = payload('http_nomination_123', { hrContact: 'People team' });
  const hr = payload('http_hr_request_123', {
    type: 'hr', contactName: 'Ada', contactEmail: 'ada@example.com'
  });
  const emailService = require('../services/emailService');
  const originalSendEmail = emailService.sendEmail;
  emailService.sendEmail = sent.sendEmail;
  try {
    assert.equal((await request(app).post('/leads').send(nomination)).status, 201);
    assert.equal((await request(app).post('/leads').send(nomination)).status, 200);
    assert.equal((await request(app).post('/leads').send({ ...nomination, company: 'Different Ltd' })).status, 409);
    assert.equal((await request(app).post('/leads').send(hr)).status, 201);
    assert.equal(await Lead.countDocuments({ type: 'nomination' }), 1);
    assert.equal(await Lead.countDocuments({ type: 'hr', contactEmail: 'ada@example.com' }), 1);
  } finally {
    emailService.sendEmail = originalSendEmail;
  }
});

test('public endpoint handles validation, honeypot, rate limiting, and persistence failure', async () => {
  const routePath = require.resolve('../routes/publicCorporateGiftLeadRoutes');
  delete require.cache[routePath];
  const app = express();
  app.use(express.json());
  app.use('/leads', require(routePath));
  assert.equal((await request(app).post('/leads').send({})).status, 400);
  assert.equal((await request(app).post('/leads').send(payload('honey_key_123', { honeypot: 'spam' }))).status, 204);
  assert.equal(await Lead.countDocuments(), 0);
  const original = Lead.create;
  Lead.create = async () => { throw new Error('database unavailable'); };
  try {
    assert.equal((await request(app).post('/leads').send(payload('failed_key_123'))).status, 503);
  } finally { Lead.create = original; }
  await request(app).post('/leads').send({});
  await request(app).post('/leads').send({});
  assert.equal((await request(app).post('/leads').send({})).status, 429);
});

test('Ops module registry restricts both paths to finance', () => {
  assert.equal(resolveOpsApiModule('/corporate-gift-leads/123'), 'finance');
  assert.equal(resolveOpsFrontendModule('/ops/corporate-gift-leads/123'), 'finance');
});

test('finance guard protects list, details, status and internal notes', async () => {
  const result = await createCorporateGiftLead(payload('ops_access_123'), { emailService: sent });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { role: 'operator', modules: req.get('x-finance') ? ['finance'] : ['calendar'] }; next(); });
  app.use(requireOpsModuleAccess);
  app.use('/corporate-gift-leads', require('../routes/ops/modules/corporateGiftLeadsRoutes'));
  const path = `/corporate-gift-leads/${result.id}`;
  assert.equal((await request(app).get('/corporate-gift-leads')).status, 403);
  assert.equal((await request(app).get(path)).status, 403);
  assert.equal((await request(app).patch(path).send({ status: 'won', notes: 'private' })).status, 403);
  assert.equal((await request(app).get(path).set('x-finance', 'yes')).status, 200);
  const listing = await request(app).get('/corporate-gift-leads').set('x-finance', 'yes');
  assert.deepEqual(listing.body.data.items[0].hrEmails, []);
  assert.equal((await request(app).patch(path).set('x-finance', 'yes').send({ status: 'unknown', notes: '' })).status, 400);
  const updated = await request(app).patch(path).set('x-finance', 'yes').send({ status: 'researching', notes: 'Internal only' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.notes, 'Internal only');
  assert.equal(updated.body.data.status, 'researching');
});

test('missing unique indexes fail closed', async () => {
  const original = Lead.collection.indexes;
  Lead.collection.indexes = async () => [];
  try {
    await assert.rejects(createCorporateGiftLead(payload('missing_index_123'), { emailService: sent }), /unique indexes are missing/);
    assert.equal(await Lead.countDocuments(), 0);
  } finally { Lead.collection.indexes = original; }
});
