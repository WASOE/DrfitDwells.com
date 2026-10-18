import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import contract from './prerender-contract.cjs';
import { executeLocalPublish, buildRemoteRsyncPhases } from '../../scripts/deploy-frontend-safe.lib.mjs';

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verification = process.argv.includes('--seo-verification');
const distDir = path.join(clientDir, verification ? '.seo-verification/dist' : 'dist');
const originals = JSON.parse(fs.readFileSync(path.join(clientDir, 'src/data/buildOriginalAssets.json')));
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
fs.mkdirSync(path.join(clientDir, '.seo-verification'), { recursive: true });
const tmp = fs.mkdtempSync(path.join(clientDir, '.seo-verification/packaging-'));

async function checkApache(webroot) {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const serverRoot = path.join(tmp, `apache-${path.basename(webroot)}`);
  fs.mkdirSync(serverRoot);
  const config = path.join(serverRoot, 'httpd.conf');
  const modules = ['mpm_event', 'authz_core', 'dir', 'mime', 'rewrite', 'headers']
    .map((name) => `LoadModule ${name}_module /usr/lib/apache2/modules/mod_${name}.so`).join('\n');
  fs.writeFileSync(config, `
ServerRoot "${serverRoot}"
PidFile "${serverRoot}/httpd.pid"
Listen 127.0.0.1:${port}
ServerName 127.0.0.1
${modules}
User "#${os.userInfo().uid}"
Group "#${os.userInfo().gid}"
ErrorLog "${serverRoot}/error.log"
TypesConfig /etc/mime.types
DocumentRoot "${webroot}"
DirectoryIndex index.html
<Directory "${webroot}">
  AllowOverride All
  Options -Indexes
  Require all granted
</Directory>
`);
  const apache = spawn('/usr/sbin/apache2', ['-f', config, '-DFOREGROUND'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let startupError;
  apache.on('error', (error) => { startupError = error; });
  const stderr = [];
  apache.stderr.on('data', (data) => stderr.push(data.toString()));
  const origin = `http://127.0.0.1:${port}`;
  try {
    let responsive = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (startupError) throw startupError;
      if (apache.exitCode !== null) throw new Error(`Apache exited: ${stderr.join('')}`);
      try {
        responsive = (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok;
      } catch (error) {
        if (error.cause?.code !== 'ECONNREFUSED') throw error;
      }
      if (responsive) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(responsive, `Apache must be responsive: ${stderr.join('')}`);
    for (const route of contract.ROUTES) {
      for (const suffix of route === '/' ? [''] : ['', '/']) {
        const response = await fetch(`${origin}${route}${suffix}?seo-check=1`);
        assert.equal(response.status, 200, route);
        assert.match(response.headers.get('content-type'), /text\/html/);
        assert.match(response.headers.get('cache-control'), /no-cache/);
        contract.validateHtml(await response.text(), route);
      }
    }
    for (const filename of fs.readdirSync(path.join(webroot, 'assets'))) {
      if (!/\.(js|css|woff2?)$/.test(filename)) continue;
      const response = await fetch(`${origin}/assets/${filename}`);
      assert.equal(response.status, 200, filename);
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(fs.readFileSync(path.join(webroot, 'assets', filename))));
      if (/\.(js|css|woff2)$/.test(filename)) {
        assert.match(response.headers.get('cache-control'), /immutable/);
      }
    }
    for (const entry of originals) {
      const url = `/media/build-originals/${path.basename(entry.original)}`;
      const response = await fetch(`${origin}${encodeURI(url)}`);
      assert.equal(response.status, 200, url);
      assert.match(response.headers.get('content-type'), /image\/jpeg/);
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), entry.sha256);
    }
    assert.equal((await fetch(`${origin}/assets/missing-file.js`)).status, 404);
    assert.equal((await fetch(`${origin}/api/missing`)).status, 404);
    const fallback = await fetch(`${origin}/search`);
    assert.equal(fallback.status, 200);
    contract.validateHtml(await fallback.text(), '/');
    const legacy = await fetch(`${origin}/cabin/69b2ff947f141a71ffa7c492`, { redirect: 'manual' });
    assert.equal(legacy.status, 301);
    assert.equal(new URL(legacy.headers.get('location')).pathname, '/stays/lux-cabin');
    console.log(`[packaging] ${path.basename(webroot)}: 34 routes, slash/query handling, all compiled assets, 7 exact JPEGs, SPA fallback, API/static 404s and legacy redirect passed on Apache.`);
  } finally {
    if (apache.exitCode === null && apache.pid) {
      const exited = new Promise((resolve) => apache.once('exit', resolve));
      apache.kill('SIGTERM');
      await exited;
    }
  }
}

try {
  if (verification) assert.throws(() => contract.assertProductionArtifacts(distDir), /must never be published/);
  else contract.assertProductionArtifacts(distDir);
  contract.validateArtifacts(distDir);
  for (const mode of ['local', 'rsync']) {
    const webroot = path.join(tmp, mode);
    fs.mkdirSync(path.join(webroot, 'uploads'), { recursive: true });
    fs.writeFileSync(path.join(webroot, 'uploads/preserve.txt'), 'Existing uploads must survive');
    if (mode === 'local') {
      executeLocalPublish({ distDir, webroot });
    } else {
      for (const phase of buildRemoteRsyncPhases({ distDir, remoteRoot: webroot })) {
        const filters = (phase.excludes || []).map((value) => `--exclude=${value}`);
        if (phase.includes?.length) filters.push(...phase.includes.map((value) => `--include=${value}`), '--exclude=*');
        const source = phase.source.endsWith('/') ? phase.source : `${phase.source}/`;
        const result = spawnSync('rsync', ['-a', ...filters, source, phase.destination], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
      }
    }
    assert.equal(fs.readFileSync(path.join(webroot, 'uploads/preserve.txt'), 'utf8'), 'Existing uploads must survive');
    assert.equal(contract.validateArtifacts(webroot).length, 34);
    if (verification) assert.throws(() => contract.assertProductionArtifacts(webroot), /must never be published/);
    const missing = contract.artifactPath(webroot, '/bg/stays/stone-house');
    const saved = fs.readFileSync(missing);
    fs.unlinkSync(missing);
    assert.throws(() => contract.validateArtifacts(webroot), /ENOENT/);
    fs.writeFileSync(missing, saved);
    await checkApache(webroot);
  }
  console.log(`[packaging] ${verification ? 'Non-publishable compiled SEO verification' : 'Production'} packaging simulation passed. No real destination was used.`);
} finally {
  fs.rmSync(tmp, { recursive: true });
}
