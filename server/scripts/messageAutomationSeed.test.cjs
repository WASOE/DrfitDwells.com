/**
 * Batch 5 — Seed contract tests.
 *
 * Run: npm run test:messaging-seed (from server/)
 *
 * Exercises the seed module against an in-memory MongoDB:
 *   - Dry-run is read-only.
 *   - Apply inserts the expected rows.
 *   - Apply is idempotent (re-run = no inserts).
 *   - Existing rows are never overwritten.
 *   - Every seeded rule is `enabled: false, mode: 'shadow'`.
 *   - Every seeded template is `status: 'draft'`.
 *   - Guest rules have `requirePaidIfStripe: true`; OPS alerts have `false`.
 *   - Guest templates declare the locked 11 V1 variables.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const MessageTemplate = require('../models/MessageTemplate');
const MessageAutomationRule = require('../models/MessageAutomationRule');

const {
  buildAllTemplates,
  buildAllRules,
  runSeed
} = require('./seedMessageAutomation');

const EXPECTED_TEMPLATE_COUNT = 7;
const EXPECTED_RULE_COUNT = 5;

const GUEST_RULE_KEYS = [
  'arrival_instructions_pre_arrival_cabin',
  'arrival_instructions_pre_arrival_valley'
];
const OPS_RULE_KEYS = [
  'ops_alert_guest_arriving_in_8_days',
  'ops_alert_guest_check_in_tomorrow',
  'ops_alert_guest_checkout_today'
];

const GUEST_TEMPLATE_KEYS = ['arrival_3d_the_cabin', 'arrival_3d_the_valley'];

const LOCKED_GUEST_VARIABLES = [
  'guestFirstName',
  'propertyName',
  'checkInDate',
  'checkOutDate',
  'arrivalWindow',
  'guideUrl',
  'meetingPointLabel',
  'googleMapsUrl',
  'supportPhone',
  'transportNote',
  'packingReminderShort'
];

let mongoServer;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Promise.all([MessageTemplate.syncIndexes(), MessageAutomationRule.syncIndexes()]);
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([MessageTemplate.deleteMany({}), MessageAutomationRule.deleteMany({})]);
});

// ---------------------------------------------------------------------------
// Pure builder contracts
// ---------------------------------------------------------------------------

test('buildAllTemplates returns exactly 7 rows', () => {
  const rows = buildAllTemplates();
  assert.equal(rows.length, EXPECTED_TEMPLATE_COUNT);
});

test('every built template is status="draft"', () => {
  const rows = buildAllTemplates();
  for (const row of rows) {
    assert.equal(row.status, 'draft', `template ${row.key}/${row.channel} not draft`);
  }
});

test('every built template uses locale="en", version=1', () => {
  const rows = buildAllTemplates();
  for (const row of rows) {
    assert.equal(row.locale, 'en');
    assert.equal(row.version, 1);
  }
});

test('guest templates declare exactly the locked 11 variables', () => {
  const rows = buildAllTemplates().filter((r) => GUEST_TEMPLATE_KEYS.includes(r.key));
  assert.equal(rows.length, 4);
  for (const row of rows) {
    const schema = row.variableSchema || {};
    const required = (schema.required || []).slice().sort();
    assert.deepEqual(required, [...LOCKED_GUEST_VARIABLES].sort(), `template ${row.key}/${row.channel} variables drift`);
  }
});

test('OPS alert templates use propertyKind="any"', () => {
  const rows = buildAllTemplates().filter(
    (r) => !GUEST_TEMPLATE_KEYS.includes(r.key)
  );
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.propertyKind, 'any');
    assert.equal(row.channel, 'email');
  }
});

test('WhatsApp templates carry whatsappTemplateName + whatsappLocale', () => {
  const rows = buildAllTemplates().filter((r) => r.channel === 'whatsapp');
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.whatsappLocale, 'en');
    assert.match(row.whatsappTemplateName, /_v1$/);
  }
});

test('email templates carry emailSubject + emailBodyMarkup', () => {
  const rows = buildAllTemplates().filter((r) => r.channel === 'email');
  assert.ok(rows.length >= 5);
  for (const row of rows) {
    assert.equal(typeof row.emailSubject, 'string');
    assert.ok(row.emailSubject.length > 0);
    assert.equal(typeof row.emailBodyMarkup, 'string');
    assert.ok(row.emailBodyMarkup.length > 0);
  }
});

test('buildAllRules returns exactly 5 rows, all inert', () => {
  const rows = buildAllRules();
  assert.equal(rows.length, EXPECTED_RULE_COUNT);
  for (const row of rows) {
    assert.equal(row.enabled, false, `rule ${row.ruleKey} enabled !== false`);
    assert.equal(row.mode, 'shadow', `rule ${row.ruleKey} mode !== shadow`);
  }
});

test('guest rules: requirePaidIfStripe=true, requiredBookingStatus=["confirmed"], whatsapp_first_email_fallback', () => {
  const rows = buildAllRules().filter((r) => GUEST_RULE_KEYS.includes(r.ruleKey));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.requirePaidIfStripe, true);
    assert.deepEqual(row.requiredBookingStatus, ['confirmed']);
    assert.equal(row.channelStrategy, 'whatsapp_first_email_fallback');
    assert.equal(row.audience, 'guest');
    assert.deepEqual(row.triggerConfig, { offsetHours: -72, sofiaHour: 17, sofiaMinute: 0 });
  }
});

test('OPS rules: requirePaidIfStripe=false, requiredBookingStatus=["confirmed","in_house"], email_only, audience=ops', () => {
  const rows = buildAllRules().filter((r) => OPS_RULE_KEYS.includes(r.ruleKey));
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.requirePaidIfStripe, false);
    assert.deepEqual(row.requiredBookingStatus.slice().sort(), ['confirmed', 'in_house']);
    assert.equal(row.channelStrategy, 'email_only');
    assert.equal(row.audience, 'ops');
    assert.equal(row.propertyScope, 'any');
  }
});

// ---------------------------------------------------------------------------
// runSeed against in-memory Mongo
// ---------------------------------------------------------------------------

test('runSeed dry-run on empty DB inserts nothing', async () => {
  const res = await runSeed({ apply: false });
  assert.equal(res.exitCode, 0);
  assert.equal(res.writes, null);

  const [tCount, rCount] = await Promise.all([
    MessageTemplate.countDocuments({}),
    MessageAutomationRule.countDocuments({})
  ]);
  assert.equal(tCount, 0);
  assert.equal(rCount, 0);
});

test('runSeed apply on empty DB inserts 7 templates and 5 rules', async () => {
  const res = await runSeed({ apply: true });
  assert.equal(res.exitCode, 0);
  assert.ok(res.writes);
  assert.equal(res.writes.templates.filter((r) => r.inserted).length, EXPECTED_TEMPLATE_COUNT);
  assert.equal(res.writes.rules.filter((r) => r.inserted).length, EXPECTED_RULE_COUNT);

  const [tCount, rCount] = await Promise.all([
    MessageTemplate.countDocuments({}),
    MessageAutomationRule.countDocuments({})
  ]);
  assert.equal(tCount, EXPECTED_TEMPLATE_COUNT);
  assert.equal(rCount, EXPECTED_RULE_COUNT);

  const rules = await MessageAutomationRule.find({}).lean();
  for (const r of rules) {
    assert.equal(r.enabled, false);
    assert.equal(r.mode, 'shadow');
  }
  const templates = await MessageTemplate.find({}).lean();
  for (const t of templates) {
    assert.equal(t.status, 'draft');
  }
});

test('runSeed apply is idempotent — second run inserts nothing', async () => {
  await runSeed({ apply: true });
  const second = await runSeed({ apply: true });
  assert.equal(second.exitCode, 0);
  assert.deepEqual(second.writes, { templates: [], rules: [] });

  const [tCount, rCount] = await Promise.all([
    MessageTemplate.countDocuments({}),
    MessageAutomationRule.countDocuments({})
  ]);
  assert.equal(tCount, EXPECTED_TEMPLATE_COUNT);
  assert.equal(rCount, EXPECTED_RULE_COUNT);
});

test('runSeed apply does NOT overwrite an existing APPROVED template', async () => {
  const customBody = '<p>HUMAN-EDITED COPY — DO NOT TOUCH</p>';
  const customSubject = 'human-edited subject';

  const preExisting = await MessageTemplate.create({
    key: 'arrival_3d_the_cabin',
    version: 1,
    channel: 'email',
    locale: 'en',
    propertyKind: 'cabin',
    status: 'approved',
    emailSubject: customSubject,
    emailBodyMarkup: customBody,
    approvedBy: 'jose',
    approvedAt: new Date('2026-01-01T00:00:00Z')
  });

  await runSeed({ apply: true });

  const reread = await MessageTemplate.findById(preExisting._id).lean();
  assert.equal(reread.status, 'approved', 'status was mutated');
  assert.equal(reread.emailSubject, customSubject, 'subject was mutated');
  assert.equal(reread.emailBodyMarkup, customBody, 'body was mutated');

  // The seed still inserts the other 6 templates around it.
  const tCount = await MessageTemplate.countDocuments({});
  assert.equal(tCount, EXPECTED_TEMPLATE_COUNT);
});

test('runSeed apply does NOT overwrite an existing rule with OPS-flipped flags', async () => {
  const preExisting = await MessageAutomationRule.create({
    ruleKey: 'arrival_instructions_pre_arrival_cabin',
    description: 'human-edited',
    triggerType: 'time_relative_to_check_in',
    triggerConfig: { offsetHours: -72, sofiaHour: 19, sofiaMinute: 30 },
    propertyScope: 'cabin',
    channelStrategy: 'whatsapp_first_email_fallback',
    templateKeyByChannel: { whatsapp: 'arrival_3d_the_cabin', email: 'arrival_3d_the_cabin' },
    requiresConsent: 'transactional',
    enabled: true,
    mode: 'auto',
    audience: 'guest',
    requiredBookingStatus: ['confirmed'],
    requirePaidIfStripe: true
  });

  await runSeed({ apply: true });

  const reread = await MessageAutomationRule.findById(preExisting._id).lean();
  assert.equal(reread.enabled, true, 'enabled was mutated');
  assert.equal(reread.mode, 'auto', 'mode was mutated');
  assert.equal(reread.description, 'human-edited', 'description was mutated');
  assert.equal(reread.triggerConfig.sofiaHour, 19, 'triggerConfig was mutated');

  const rCount = await MessageAutomationRule.countDocuments({});
  assert.equal(rCount, EXPECTED_RULE_COUNT);
});

test('runSeed dry-run reports inserts without writing', async () => {
  // Pre-populate one row to confirm the report splits correctly.
  await MessageTemplate.create({
    key: 'arrival_3d_the_cabin',
    version: 1,
    channel: 'email',
    locale: 'en',
    propertyKind: 'cabin',
    status: 'draft'
  });

  const before = await MessageTemplate.countDocuments({});
  const res = await runSeed({ apply: false });
  const after = await MessageTemplate.countDocuments({});

  assert.equal(res.exitCode, 0);
  assert.equal(res.writes, null);
  assert.equal(before, after, 'dry-run must not write');
});

test('runSeed apply refuses in production without ALLOW_PRODUCTION_SEED=1', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevAllow = process.env.ALLOW_PRODUCTION_SEED;
  process.env.NODE_ENV = 'production';
  delete process.env.ALLOW_PRODUCTION_SEED;
  try {
    const res = await runSeed({ apply: true });
    assert.equal(res.exitCode, 1);
    assert.equal(res.writes, null);

    const [tCount, rCount] = await Promise.all([
      MessageTemplate.countDocuments({}),
      MessageAutomationRule.countDocuments({})
    ]);
    assert.equal(tCount, 0);
    assert.equal(rCount, 0);
  } finally {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    if (prevAllow === undefined) delete process.env.ALLOW_PRODUCTION_SEED;
    else process.env.ALLOW_PRODUCTION_SEED = prevAllow;
  }
});

test('runSeed apply proceeds in production when ALLOW_PRODUCTION_SEED=1', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevAllow = process.env.ALLOW_PRODUCTION_SEED;
  process.env.NODE_ENV = 'production';
  process.env.ALLOW_PRODUCTION_SEED = '1';
  try {
    const res = await runSeed({ apply: true });
    assert.equal(res.exitCode, 0);
    assert.ok(res.writes);

    const tCount = await MessageTemplate.countDocuments({});
    const rCount = await MessageAutomationRule.countDocuments({});
    assert.equal(tCount, EXPECTED_TEMPLATE_COUNT);
    assert.equal(rCount, EXPECTED_RULE_COUNT);
  } finally {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    if (prevAllow === undefined) delete process.env.ALLOW_PRODUCTION_SEED;
    else process.env.ALLOW_PRODUCTION_SEED = prevAllow;
  }
});
