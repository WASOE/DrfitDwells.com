import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apacheSharedAssetsDirectives } from './shared-assets.mjs';
import { assertSiteAssetMapping, verifyProductionAssets } from './production-assets.mjs';

test('requires both exact site mappings and verifies served bytes', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-assets-http-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directives = apacheSharedAssetsDirectives(root);
  const block = `<VirtualHost *:443>\nServerName www.driftdwells.com\nServerAlias www.driftdwells.com driftdwells.com\n${directives}\n</VirtualHost>`;
  const config = `${block}\n${block}`;
  assert.throws(() => assertSiteAssetMapping(block, root), /exactly two/);
  fs.writeFileSync(path.join(root, 'old.js'), 'old');
  const get = async (ip, route) => {
    assert.equal(ip, '127.0.0.1');
    const data = fs.readFileSync(path.join(root, route.slice('assets/'.length)));
    return { size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
  };
  const assets = [{ path: 'assets/old.js', size: 3, sha256: crypto.createHash('sha256').update('old').digest('hex') }];
  assert.deepEqual(await verifyProductionAssets({ sharedAssets: root, assets, originIp: '127.0.0.1', config, get }), { ok: true });
  await assert.rejects(verifyProductionAssets({ sharedAssets: root, assets: [{ ...assets[0], size: 8 }], originIp: '127.0.0.1', config, get }), /mismatch/);
  assert.deepEqual(fs.readdirSync(root), ['old.js']);
});
