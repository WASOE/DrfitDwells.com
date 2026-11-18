'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { verifyFullBackup, confirmationToken } = require('./production.cjs');

test('production backup gate verifies exact private archive checksums and restore attestation', async t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'review-backup-gate-'));
  fs.chmodSync(parent, 0o700);
  const root = path.join(parent, 'backups');
  const backup = path.join(root, 'daily', '20261024-061021');
  fs.mkdirSync(path.join(backup, 'mongo'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(backup, 'uploads'), { recursive: true, mode: 0o700 });
  fs.chmodSync(backup, 0o700);
  const mongo = path.join(backup, 'mongo', 'driftdwells-mongo-20261024-061021.gz');
  const uploads = path.join(backup, 'uploads', 'driftdwells-uploads-20261024-061021.tar.gz');
  fs.writeFileSync(mongo, 'local backup fixture');
  fs.writeFileSync(uploads, 'local uploads fixture');
  fs.chmodSync(mongo, 0o600);
  fs.chmodSync(uploads, 0o600);
  const relative = ['mongo/driftdwells-mongo-20261024-061021.gz',
    'uploads/driftdwells-uploads-20261024-061021.tar.gz'];
  const checksums = relative.map(name =>
    `${crypto.createHash('sha256').update(fs.readFileSync(path.join(backup, name))).digest('hex')}  ${name}`
  ).join('\n') + '\n';
  fs.writeFileSync(path.join(backup, 'checksums.sha256'), checksums, { mode: 0o600 });
  fs.writeFileSync(path.join(backup, 'manifest.txt'), `backup_set_path=${backup}\n`, { mode: 0o600 });
  t.after(() => fs.rmSync(parent, { recursive: true }));

  const verified = await verifyFullBackup(backup, backup, root);
  assert.equal(verified.path, backup);
  assert.equal(verified.files, 2);
  await assert.rejects(() => verifyFullBackup(backup, path.join(root, 'daily', 'other'), root),
    /restore-verification procedure/);
  const bundle = { sha256: 'a'.repeat(64) };
  const selectedBackup = { path: backup };
  assert.equal(confirmationToken('apply', bundle, selectedBackup),
    `APPLY PRODUCTION REVIEW CORRECTION ${bundle.sha256} 20261024-061021`);
  assert.equal(confirmationToken('rollback', bundle, selectedBackup),
    `ROLL BACK PRODUCTION REVIEW CORRECTION ${bundle.sha256} 20261024-061021`);
  fs.appendFileSync(uploads, 'changed');
  await assert.rejects(() => verifyFullBackup(backup, backup, root), /checksum mismatch/);
});
