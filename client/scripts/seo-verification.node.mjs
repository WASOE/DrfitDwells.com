import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import contract from './prerender-contract.cjs';
import clientConfig from '../vite.config.js';

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(clientDir, 'src/data/buildOriginalAssets.json')));

test('seven exact original JPEGs are versionable public inputs, not ignored upload dependencies', () => {
  const mediaSource = fs.readFileSync(path.join(clientDir, 'src/data/buildMediaLibrary.js'), 'utf8');
  assert.equal(manifest.length, 7);
  for (const entry of manifest) {
    const publicPath = `/media/build-originals/${path.basename(entry.original)}`;
    const bytes = fs.readFileSync(path.join(clientDir, 'public', publicPath));
    assert.equal(bytes.subarray(0, 3).toString('hex'), 'ffd8ff');
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.ok(mediaSource.includes(publicPath));
    assert.ok(!mediaSource.includes(entry.original));
  }
});

test('production configuration still rejects an absent Stripe key, independently of SEO configuration', () => {
  const tmp = fs.mkdtempSync(path.join(clientDir, 'scripts/.guard-test-'));
  try {
    fs.copyFileSync(path.join(clientDir, 'vite.config.js'), path.join(tmp, 'vite.config.mjs'));
    const env = { ...process.env };
    delete env.VITE_STRIPE_PUBLISHABLE_KEY;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import config from ${JSON.stringify(path.join(tmp, 'vite.config.mjs'))}; config({command:'build', mode:'production'});`
    ], { env, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Client build requires a valid VITE_STRIPE_PUBLISHABLE_KEY/);
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
  assert.ok(clientConfig({ command: 'serve', mode: 'seo-verification' }).build);
  const verificationSource = fs.readFileSync(path.join(clientDir, 'scripts/build-seo-verification.mjs'), 'utf8');
  assert.match(verificationSource, /outDir: distDir/);
  assert.match(verificationSource, /envDir: false/);
  assert.match(verificationSource, /VITE_STRIPE_PUBLISHABLE_KEY': JSON.stringify\(''\)/);
  assert.ok(!verificationSource.includes('pk_test_'));
  assert.ok(!verificationSource.includes('pk_live_'));
});

test('production preflight rejects isolated output even when copied to a production directory', () => {
  const tmp = fs.mkdtempSync(path.join(clientDir, 'scripts/.verification-test-'));
  try {
    fs.writeFileSync(path.join(tmp, 'index.html'), `<meta name="${contract.VERIFICATION_MARKER}" content="not-for-publication">`);
    assert.throws(() => contract.assertProductionArtifacts(tmp), /must never be published/);
    fs.writeFileSync(path.join(tmp, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(tmp, `${contract.VERIFICATION_MARKER}.json`), '{}');
    assert.throws(() => contract.assertProductionArtifacts(tmp), /must never be published/);
    fs.unlinkSync(path.join(tmp, `${contract.VERIFICATION_MARKER}.json`));
    assert.doesNotThrow(() => contract.assertProductionArtifacts(tmp));
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});
