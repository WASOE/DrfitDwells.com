import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { apacheSharedAssetsDirectives } from './shared-assets.mjs';

export function assertSiteAssetMapping(config, sharedAssets) {
  const expected = apacheSharedAssetsDirectives(sharedAssets);
  let matches = 0;
  for (const match of config.matchAll(/<VirtualHost\b[^>]*>[\s\S]*?<\/VirtualHost>/g)) {
    const block = match[0];
    if (!/^\s*ServerName\s+www\.driftdwells\.com\s*$/m.test(block)) continue;
    if (!/^\s*ServerAlias\s+www\.driftdwells\.com\s+driftdwells\.com\s*$/m.test(block) ||
        !block.includes(expected) || (block.match(/^\s*(?:Alias|AliasMatch|ScriptAlias)\s+\/assets(?:\/|\s)/gm) || []).length !== 1) {
      throw new Error('Production asset vhost mapping is missing or ambiguous');
    }
    matches++;
  }
  if (matches !== 2) throw new Error('Expected exactly two site asset vhost mappings');
}

function readSiteConfig() {
  const result = spawnSync('sudo', ['-n', 'cat', '/usr/local/directadmin/data/users/illoc/httpd.conf'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Unable to read the production site vhost configuration');
  return result.stdout;
}

function originGet(ip, asset, expectedSize) {
  return new Promise((resolve, reject) => {
    const request = https.get({
      hostname: ip, port: 443, servername: 'driftdwells.com',
      path: `/${asset}?releasecheck=${crypto.randomBytes(12).toString('hex')}`,
      headers: { Host: 'driftdwells.com', 'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity' },
      timeout: 15000
    }, response => {
      if (response.statusCode !== 200 || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
        response.resume();
        reject(new Error(`Asset origin response failed: ${asset} HTTP ${response.statusCode}`));
        return;
      }
      const digest = crypto.createHash('sha256');
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > expectedSize) response.destroy(new Error(`Asset origin size exceeds expected: ${asset}`));
        else digest.update(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ size, sha256: digest.digest('hex') }));
    });
    request.on('timeout', () => request.destroy(new Error(`Asset origin timed out: ${asset}`)));
    request.on('error', reject);
  });
}

/**
 * Validate the exact site's config, then fetch the published bytes from a
 * certificate-validated origin IP rather than a potentially stale CDN.
 */
export async function verifyProductionAssets({ sharedAssets, assets, originIp, config = readSiteConfig(), get = originGet }) {
  if (net.isIP(originIp) === 0) throw new Error('An explicit origin IP is required');
  assertSiteAssetMapping(config, sharedAssets);
  const sentinel = `verification-${crypto.randomBytes(16).toString('hex')}.txt`;
  const file = path.join(sharedAssets, sentinel);
  const content = crypto.randomBytes(32);
  const fd = fs.openSync(file, 'wx', 0o444);
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  try {
    const check = [{ path: `assets/${sentinel}`, size: content.length,
      sha256: crypto.createHash('sha256').update(content).digest('hex') }, ...assets];
    for (const asset of check) {
      if (!/^assets\/[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(asset.path) ||
          asset.path.split('/').some(part => part === '.' || part === '..') ||
          !Number.isSafeInteger(asset.size) || asset.size < 0 || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
        throw new Error('Invalid asset metadata');
      }
      const actual = await get(originIp, asset.path, asset.size);
      if (actual.size !== asset.size || actual.sha256 !== asset.sha256) throw new Error(`Origin asset mismatch: ${asset.path}`);
    }
  } finally {
    fs.unlinkSync(file);
  }
  return { ok: true };
}
