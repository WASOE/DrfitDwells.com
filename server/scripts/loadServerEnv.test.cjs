'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  loadServerEnv,
  resolveServerEnvPath,
  isNonEmptyEnvValue,
  __resetLoadServerEnvForTesting
} = require('../config/loadServerEnv');

function makeTempEnvFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddw-loadenv-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, contents, 'utf8');
  return { dir, file };
}

test.beforeEach(() => {
  __resetLoadServerEnvForTesting();
});

test('isNonEmptyEnvValue treats empty/whitespace as absent', () => {
  assert.equal(isNonEmptyEnvValue(undefined), false);
  assert.equal(isNonEmptyEnvValue(null), false);
  assert.equal(isNonEmptyEnvValue(''), false);
  assert.equal(isNonEmptyEnvValue('   '), false);
  assert.equal(isNonEmptyEnvValue('smtp.example'), true);
});

test('resolveServerEnvPath is independent of cwd (points at server/.env)', () => {
  const prev = process.cwd();
  try {
    process.chdir(path.join(__dirname, '../..')); // repo root
    const p = resolveServerEnvPath();
    assert.equal(path.basename(path.dirname(p)), 'server');
    assert.equal(path.basename(p), '.env');
    assert.ok(path.isAbsolute(p));
  } finally {
    process.chdir(prev);
  }
});

test('repository-root cwd still loads fixture via envPath / absolute server path', () => {
  const { file } = makeTempEnvFile('SMTP_HOST=fixture-smtp.example\nSMTP_PORT=587\n');
  const env = {};
  const prev = process.cwd();
  try {
    process.chdir(path.join(__dirname, '../..'));
    const res = loadServerEnv({ envPath: file, env, forceReload: true });
    assert.equal(res.loaded, true);
    assert.equal(res.missing, false);
    assert.equal(env.SMTP_HOST, 'fixture-smtp.example');
    assert.equal(res.presence.smtpHostPresent, true);
    assert.ok(!JSON.stringify(res).includes('fixture-smtp.example') || res.path);
    // metadata must not include secret-like values for SMTP_PASS
    assert.equal(Object.prototype.hasOwnProperty.call(res, 'SMTP_PASS'), false);
  } finally {
    process.chdir(prev);
  }
});

test('non-empty process.env wins over file (override:false semantics)', () => {
  const { file } = makeTempEnvFile('SMTP_HOST=from-file\nMONGODB_URI=mongodb://from-file\n');
  const env = { SMTP_HOST: 'from-process', MONGODB_URI: '' };
  const res = loadServerEnv({ envPath: file, env, forceReload: true });
  assert.equal(env.SMTP_HOST, 'from-process');
  // empty treated as absent → filled from file
  assert.equal(env.MONGODB_URI, 'mongodb://from-file');
  assert.ok(res.skippedNonEmptyProcessEnv >= 1);
  assert.ok(res.keysLoaded >= 1);
});

test('no production root-.env fallback — loader never reads repo root .env', () => {
  const env = {};
  const res = loadServerEnv({
    envPath: path.join(os.tmpdir(), 'definitely-missing-ddw-env-' + Date.now()),
    env,
    forceReload: true,
    nodeEnv: 'production'
  });
  assert.equal(res.missing, true);
  assert.equal(res.loaded, false);
  assert.equal(res.source, 'missing_file');
  assert.equal(env.SMTP_HOST, undefined);
});

test('missing file with complete process.env succeeds (loaded false)', () => {
  const env = {
    SMTP_HOST: 'smtp.example',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/x',
    EMAIL_DELIVERY_REQUIRED: '1'
  };
  const res = loadServerEnv({
    envPath: path.join(os.tmpdir(), 'missing-' + Date.now()),
    env,
    forceReload: true
  });
  assert.equal(res.missing, true);
  assert.equal(res.presence.smtpHostPresent, true);
  assert.equal(res.presence.mongoUriPresent, true);
});

test('missing file with missing required config reports absence', () => {
  const env = {};
  const res = loadServerEnv({
    envPath: path.join(os.tmpdir(), 'missing2-' + Date.now()),
    env,
    forceReload: true
  });
  assert.equal(res.presence.smtpHostPresent, false);
  assert.equal(res.presence.smtpUrlPresent, false);
  assert.equal(res.presence.mongoUriPresent, false);
});

test('idempotent repeated calls without forceReload', () => {
  const { file } = makeTempEnvFile('SMTP_HOST=once\n');
  const env = {};
  const a = loadServerEnv({ envPath: file, env, forceReload: true });
  env.SMTP_HOST = 'mutated';
  const b = loadServerEnv({ envPath: file, env });
  assert.equal(a.loaded, true);
  assert.equal(b.source, a.source);
  // second call is noop for applying file again
  assert.equal(env.SMTP_HOST, 'mutated');
});

test('returned metadata contains no secret values', () => {
  const { file } = makeTempEnvFile('SMTP_PASS=supersecret\nSMTP_HOST=h\n');
  const env = {};
  const res = loadServerEnv({ envPath: file, env, forceReload: true });
  const json = JSON.stringify(res);
  assert.equal(json.includes('supersecret'), false);
  assert.equal(env.SMTP_PASS, 'supersecret'); // applied to env, not returned
});
