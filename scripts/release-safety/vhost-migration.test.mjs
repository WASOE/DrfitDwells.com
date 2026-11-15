import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { apacheSharedAssetsDirectives } from './shared-assets.mjs';
import { renderAccountConfig } from './fixtures/directadmin/renderer.mjs';
import { prepareSiteVhostConfig } from './vhost-migration.mjs';
import {
  assertSiteSharedAssetsMapping,
  migrateSiteVhost,
  planSiteVhostMigration,
  recoverSiteVhostMigration
} from './vhost-migration.mjs';

const root = '/home/illoc/domains/driftdwells.com/public_html';
const pointer = '/home/illoc/releases/frontend/current';
const sharedAssets = '/home/illoc/releases/frontend/shared-assets';
const cli = fileURLToPath(new URL('./vhost-migration-cli.mjs', import.meta.url));
function vhost(port, host, documentRoot, aliases = 'www.driftdwells.com driftdwells.com') {
  return `<VirtualHost *:${port}>
ProxyPass /api http://127.0.0.1:5000/api
ProxyPass /uploads http://127.0.0.1:5000/uploads
Alias /legal/ ${root}/legal/
<Directory "${root}/legal">
 Options -Indexes
</Directory>
ServerName ${host}
ServerAlias ${aliases}
DocumentRoot "${documentRoot}"
<Directory "${documentRoot}">
</Directory>
</VirtualHost>`;
}
const site = [
  vhost(80, 'www.driftdwells.com', root).replace('</VirtualHost>', `${apacheSharedAssetsDirectives(sharedAssets)}\n</VirtualHost>`),
  vhost(443, 'www.driftdwells.com', root).replace('</VirtualHost>', `${apacheSharedAssetsDirectives(sharedAssets)}\n</VirtualHost>`)
];
const other = vhost(443, 'test.driftdwells.com', `${root}/test`, 'test.driftdwells.com staging.driftdwells.com');
const expectedSharedAssetsDirectives = [
  `Alias /assets/ "${sharedAssets}/"`,
  `<Directory "${sharedAssets}">`,
  '  Options -Indexes -ExecCGI -FollowSymLinks',
  '  AllowOverride None',
  '  Require all granted',
  '</Directory>',
  '<LocationMatch "^/assets/(?:.*/)?\\\\.">',
  '  Require all denied',
  '</LocationMatch>'
].join('\n');

test('shared-assets directive generator has the agreed exact syntax and spacing', () => {
  assert.equal(apacheSharedAssetsDirectives(sharedAssets), expectedSharedAssetsDirectives);
});

test('changes only the two exact main site vhosts and preserves test site and proxies', () => {
  const source = `# generated preamble\n${[...site, other].join('\n')}\n# generated footer`;
  const result = prepareSiteVhostConfig(source, { originalRoot: root, releasePointer: pointer, sharedAssets });
  const expected = source.replace(/<VirtualHost\b[^>]*>[\s\S]*?<\/VirtualHost>/g, block =>
    block.includes('ServerName www.driftdwells.com')
      ? block.replace(`DocumentRoot "${root}"`, `DocumentRoot "${pointer}"`)
        .replace(`<Directory "${root}">`, `<Directory "${pointer}">`)
        .replace(`<Directory "${root}/legal">`, `<Directory "${pointer}/legal">`)
        .replace(`Alias /legal/ ${root}/legal/`, `Alias /legal/ ${pointer}/legal/`)
      : block);
  assert.equal(result, expected);
  assert.ok(result.includes(other));
  assert.ok(result.endsWith('# generated footer'));
  assert.equal((result.match(/DocumentRoot "\/home\/illoc\/releases\/frontend\/current"/g) || []).length, 2);
  assert.equal((result.match(/ProxyPass \/uploads /g) || []).length, 3);
  assert.ok(result.includes(`<Directory "${pointer}/legal">`));
  assert.ok(result.includes(`Alias /legal/ ${pointer}/legal/`));
  assert.equal((result.match(/Alias \/assets\//g) || []).length, 2);
  assert.equal(result.includes(expectedSharedAssetsDirectives), true);
  assert.equal(result.includes(other), true);
});

test('refuses ambiguous or incomplete configuration', () => {
  const options = { originalRoot: root, releasePointer: pointer, sharedAssets };
  assert.throws(() => prepareSiteVhostConfig(site[0], options), /exactly two/);
  assert.throws(() => prepareSiteVhostConfig(site.join('\n').replace('ProxyPass /api', 'ProxyPass /not-api'), options), /Missing site proxy/);
  assert.throws(() => prepareSiteVhostConfig(site.join('\n'), { ...options, releasePointer: `${root}/current` }), /separate/);
  assert.throws(() => prepareSiteVhostConfig(site.join('\n').replaceAll(sharedAssets, `${sharedAssets}-wrong`), options), /shared-assets Apache mapping/);
  assert.throws(() => prepareSiteVhostConfig(site.join('\n').replace('Alias /assets/', 'AliasMatch /assets/'), options), /shared-assets Apache mapping/);
  assert.throws(() => prepareSiteVhostConfig(site.join('\n'), { originalRoot: root, releasePointer: pointer }), /Shared assets/);
});

test('adds the exact assets mapping only to site vhosts that lack one', () => {
  const completeSource = [...site, other].join('\n');
  const sourceWithoutAliases = completeSource.replaceAll(apacheSharedAssetsDirectives(sharedAssets), '');
  const result = prepareSiteVhostConfig(sourceWithoutAliases, {
    originalRoot: root, releasePointer: pointer, sharedAssets
  });
  assert.equal((result.match(/Alias \/assets\//g) || []).length, 2);
  assert.equal(result.includes(other), true);
  const siteBlocks = [...result.matchAll(/<VirtualHost\b[^>]*>[\s\S]*?<\/VirtualHost>/g)]
    .map(match => match[0]).filter(block => block.includes('ServerName www.driftdwells.com'));
  assert.equal(siteBlocks.length, 2);
  assert.ok(siteBlocks.every(block => block.includes(expectedSharedAssetsDirectives)));
  const testBlock = [...result.matchAll(/<VirtualHost\b[^>]*>[\s\S]*?<\/VirtualHost>/g)]
    .map(match => match[0]).find(block => /^\s*ServerName\s+test\.driftdwells\.com\s*$/m.test(block));
  assert.equal(testBlock, other);
  assert.deepEqual(assertSiteSharedAssetsMapping(result, sharedAssets), { ok: true, vhostsVerified: 2 });
  const partial = completeSource.replace('AllowOverride None', 'AllowOverride All');
  assert.throws(() => prepareSiteVhostConfig(partial, {
    originalRoot: root, releasePointer: pointer, sharedAssets
  }), /conflicting|incomplete/);
});

test('migration and activation verification require exact main-vhost identities', () => {
  const valid = [...site, other].join('\n');
  assert.deepEqual(assertSiteSharedAssetsMapping(valid, sharedAssets), { ok: true, vhostsVerified: 2 });
  assert.throws(() => assertSiteSharedAssetsMapping(
    valid.replace('ServerAlias www.driftdwells.com driftdwells.com', 'ServerAlias driftdwells.com'),
    sharedAssets
  ), /missing or ambiguous/);
  assert.throws(() => assertSiteSharedAssetsMapping(
    valid.replace('ServerName www.driftdwells.com', 'ServerName driftdwells.com'),
    sharedAssets
  ), /Expected exactly two/);
  assert.throws(() => prepareSiteVhostConfig(
    valid.replace('ServerAlias www.driftdwells.com driftdwells.com', 'ServerAlias driftdwells.com'),
    { originalRoot: root, releasePointer: pointer, sharedAssets }
  ), /Unexpected Drift & Dwells virtual host identity/);
});

function fixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-vhost-migration-'));
  const configDir = path.join(tmp, 'etc', 'httpd', 'users', 'illoc');
  const documentRoot = path.join(tmp, 'domains', 'driftdwells.com', 'public_html');
  const fixtureSharedAssets = path.join(tmp, 'shared', 'assets');
  const releasesRoot = path.join(tmp, 'releases', 'frontend');
  const pointer = path.join(tmp, 'releases', 'current');
  const stateRoot = path.join(tmp, 'private', 'vhost-migration');
  const siteConfig = path.join(configDir, 'httpd.conf');
  const customConfig = path.join(configDir, 'domains', 'driftdwells.com.cust_httpd');
  const apacheConfig = path.join(tmp, 'etc', 'httpd', 'httpd.conf');
  fs.mkdirSync(path.dirname(customConfig), { recursive: true });
  fs.mkdirSync(documentRoot, { recursive: true });
  fs.mkdirSync(fixtureSharedAssets, { recursive: true });
  fs.chmodSync(fixtureSharedAssets, 0o755);
  fs.mkdirSync(releasesRoot, { recursive: true });
  fs.mkdirSync(path.dirname(pointer), { recursive: true });
  fs.mkdirSync(path.dirname(stateRoot), { recursive: true });
  fs.mkdirSync(path.join(documentRoot, 'uploads', 'year', 'month'), { recursive: true });
  fs.mkdirSync(path.join(documentRoot, 'test'), { recursive: true });
  fs.mkdirSync(path.join(documentRoot, 'legal'), { recursive: true });
  fs.mkdirSync(path.join(documentRoot, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(documentRoot, 'assets', 'retained.js'), 'first migration shared asset');
  fs.writeFileSync(path.join(documentRoot, 'index.html'), 'original-index');
  fs.writeFileSync(path.join(documentRoot, '.htaccess'), 'deny from all');
  fs.writeFileSync(path.join(documentRoot, 'uploads', 'year', 'month', 'customer.dat'), 'customer-upload');
  fs.writeFileSync(path.join(documentRoot, 'test', 'index.html'), 'test-site');
  fs.writeFileSync(path.join(documentRoot, 'legal', 'terms.html'), 'legal');
  fs.writeFileSync(path.join(documentRoot, 'unrelated.txt'), 'unrelated');
  const customSource = fs.readFileSync(new URL('./fixtures/directadmin/cust_httpd.conf', import.meta.url), 'utf8')
    .replaceAll(root, documentRoot);
  const testRoot = path.join(documentRoot, 'test');
  const unrelated = `<VirtualHost *:80>\nServerName other.example\nDocumentRoot "${tmp}/other"\n</VirtualHost>`;
  const render = () => renderAccountConfig(fs.readFileSync(customConfig, 'utf8'), {
    root: documentRoot, testRoot, unrelated
  });
  fs.writeFileSync(customConfig, customSource);
  const siteConfigContents = render();
  fs.writeFileSync(siteConfig, siteConfigContents);
  fs.writeFileSync(apacheConfig, 'Include users/site.conf\n');
  const assetBytes = fs.readFileSync(path.join(documentRoot, 'assets', 'retained.js'));
  const assets = [{
    path: 'assets/retained.js', size: assetBytes.length,
    sha256: crypto.createHash('sha256').update(assetBytes).digest('hex')
  }];
  return {
    tmp, documentRoot, sharedAssets: fixtureSharedAssets, releasesRoot, pointer,
    stateRoot, siteConfig, customConfig, customSource, render, apacheConfig, siteConfigContents, assets
  };
}

function removeFixture(root) {
  if (!fs.existsSync(root)) return;
  function makeWritable(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        makeWritable(file);
        fs.chmodSync(file, 0o700);
      } else if (entry.isFile()) {
        fs.chmodSync(file, 0o600);
      }
    }
    fs.chmodSync(dir, 0o700);
  }
  makeWritable(root);
  fs.rmSync(root, { recursive: true, force: true });
}

function commandRunner({ failHttpdAt = null, failRewriteOnce = false, siteConfig, render } = {}) {
  const commands = [];
  let httpdCalls = 0;
  let rewriteFailures = failRewriteOnce ? 1 : 0;
  const run = (command, args) => {
    commands.push({ command, args });
    if (command === '/usr/bin/cp') {
      const result = spawnSync(command, args, { encoding: 'utf8' });
      return { status: result.status, stderr: result.stderr };
    }
    if (command === '/usr/local/directadmin/directadmin') {
      assert.deepEqual(args, ['taskq', '--run=action=rewrite&value=httpd&user=illoc']);
      if (rewriteFailures) {
        rewriteFailures--;
        return { status: 1, stderr: 'fixture rewrite failure' };
      }
      fs.writeFileSync(siteConfig, render());
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command === '/usr/sbin/httpd' && args.includes('DUMP_INCLUDES')) {
      return { status: 0, stdout: siteConfig || '', stderr: '' };
    }
    if (command === '/usr/sbin/httpd' && ++httpdCalls === failHttpdAt) {
      return { status: 1, stderr: 'fixture syntax failure' };
    }
    return { status: 0, stderr: '' };
  };
  return { run, commands };
}

function migrationArgs(f, probe, run) {
  return {
    siteConfig: f.siteConfig,
    customConfig: f.customConfig,
    directadmin: '/usr/local/directadmin/directadmin',
    directadminUser: 'illoc',
    apacheConfig: f.apacheConfig,
    documentRoot: f.documentRoot,
    sharedAssets: f.sharedAssets,
    releasesRoot: f.releasesRoot,
    pointer: f.pointer,
    stateRoot: f.stateRoot,
    httpd: '/usr/sbin/httpd',
    copyCommand: '/usr/bin/cp',
    confirmWebrootQuiesced: true,
    confirmDirectAdminAccount: true,
    confirmSharedAssetsPolicy: true,
    assets: f.assets,
    preflightProbe: async () => ({ ok: true }),
    probe,
    verifyAssetServing: async ({ sharedAssets, assets, siteConfig, siteConfigSha256, mapping }) => ({
      ok: sharedAssets === f.sharedAssets && JSON.stringify(assets) === JSON.stringify(f.assets) &&
        siteConfig === f.siteConfig && digest(siteConfig) === siteConfigSha256 &&
        mapping.vhostsVerified === 2
    }),
    run
  };
}

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('plan is read-only and accounts for every webroot file including uploads and unrelated paths', t => {
  const f = fixture();
  t.after(() => removeFixture(f.tmp));
  const before = digest(f.siteConfig);
  const plan = planSiteVhostMigration({
    siteConfig: f.siteConfig, apacheConfig: f.apacheConfig, documentRoot: f.documentRoot,
    customConfig: f.customConfig, directadminUser: 'illoc',
    sharedAssets: f.sharedAssets, assets: f.assets,
    releasesRoot: f.releasesRoot, pointer: f.pointer, stateRoot: f.stateRoot
  });
  assert.equal(plan.status, 'plan-only');
  assert.equal(plan.files, 7);
  assert.equal(plan.sharedAssetsVerified, 1);
  assert.equal(fs.existsSync(f.stateRoot), false);
  assert.equal(fs.existsSync(f.pointer), false);
  assert.equal(digest(f.siteConfig), before);
  assert.equal(fs.readFileSync(path.join(f.documentRoot, 'uploads/year/month/customer.dat'), 'utf8'), 'customer-upload');
  assert.equal(fs.existsSync(path.join(f.sharedAssets, 'retained.js')), false);
});

test('CLI plan uses explicit fixture paths and apply is opt-in', t => {
  const f = fixture();
  t.after(() => removeFixture(f.tmp));
  const flags = [
    '--site-config', f.siteConfig, '--apache-config', f.apacheConfig,
    '--custom-config', f.customConfig, '--directadmin-user', 'illoc',
    '--document-root', f.documentRoot, '--release-root', f.releasesRoot,
    '--shared-assets', f.sharedAssets,
    '--pointer', f.pointer, '--state-dir', f.stateRoot
  ];
  const assetsManifest = path.join(f.tmp, 'assets.json');
  fs.writeFileSync(assetsManifest, JSON.stringify(f.assets));
  flags.push('--assets-manifest', assetsManifest);
  const plan = spawnSync(process.execPath, [cli, 'plan', ...flags], { encoding: 'utf8' });
  assert.equal(plan.status, 0, plan.stderr);
  assert.equal(JSON.parse(plan.stdout).status, 'plan-only');
  const apply = spawnSync(process.execPath, [cli, 'apply', ...flags], { encoding: 'utf8' });
  assert.equal(apply.status, 1);
  assert.match(apply.stderr, /requires the explicit --apply flag/);
  assert.equal(fs.existsSync(f.stateRoot), false);
  assert.equal(fs.existsSync(f.pointer), false);
});

test('migration snapshots the complete webroot, changes only the site vhosts and can roll back', async t => {
  const f = fixture();
  t.after(() => removeFixture(f.tmp));
  const { run, commands } = commandRunner({ siteConfig: f.siteConfig, render: f.render });
  let servedAssetCount = 0;
  const args = migrationArgs(f, async ({ verificationPath, verificationToken }) => {
    assert.match(verificationPath, /^\/vhost-migration-[0-9a-f-]+-probe\.txt$/);
    assert.match(verificationToken, /^[a-f0-9]{64}$/);
    return { ok: true, pointerVerified: true };
  }, run);
  args.verifyAssetServing = async request => {
    assert.equal(request.sharedAssets, f.sharedAssets);
    assert.deepEqual(request.assets, f.assets);
    servedAssetCount = request.assets.length;
    return { ok: true };
  };
  const result = await migrateSiteVhost(args);
  assert.equal(result.status, 'active');
  assert.equal(result.sharedAssetsVerified, 1);
  assert.equal(servedAssetCount, 1);
  const journal = JSON.parse(fs.readFileSync(path.join(f.stateRoot, 'vhost-migration.json'), 'utf8'));
  assert.equal(journal.status, 'active');
  assert.equal(fs.readlinkSync(f.pointer), result.documentRoot);
  assert.equal(fs.readFileSync(path.join(result.documentRoot, 'uploads/year/month/customer.dat'), 'utf8'), 'customer-upload');
  assert.equal(fs.readFileSync(path.join(result.documentRoot, 'test/index.html'), 'utf8'), 'test-site');
  assert.equal(fs.readFileSync(path.join(result.documentRoot, 'unrelated.txt'), 'utf8'), 'unrelated');
  assert.equal(fs.readFileSync(path.join(f.sharedAssets, 'retained.js'), 'utf8'), 'first migration shared asset');
  assert.equal(fs.statSync(path.join(f.sharedAssets, 'retained.js')).mode & 0o222, 0);
  assert.equal(fs.existsSync(path.join(result.documentRoot, 'assets/retained.js')), true);
  assert.equal(fs.readFileSync(path.join(f.documentRoot, 'index.html'), 'utf8'), 'original-index');
  assert.equal(fs.readFileSync(path.join(f.documentRoot, 'uploads/year/month/customer.dat'), 'utf8'), 'customer-upload');
  const migratedConfig = fs.readFileSync(f.siteConfig, 'utf8');
  const baselineBlocks = [...f.siteConfigContents.matchAll(/<VirtualHost\b[^>]*>[\s\S]*?<\/VirtualHost>/g)].map(match => match[0]);
  const migratedBlocks = [...migratedConfig.matchAll(/<VirtualHost\b[^>]*>[\s\S]*?<\/VirtualHost>/g)].map(match => match[0]);
  assert.deepEqual(migratedBlocks.slice(2), baselineBlocks.slice(2));
  assert.match(fs.readFileSync(f.customConfig, 'utf8'), /\|\*if !SUB\|\n\|\?DOCROOT=/);
  run('/usr/local/directadmin/directadmin', ['taskq', '--run=action=rewrite&value=httpd&user=illoc']);
  assert.equal(fs.readFileSync(f.siteConfig, 'utf8'), migratedConfig);
  assert.equal((migratedConfig.match(new RegExp(`DocumentRoot "${f.pointer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g')) || []).length, 2);
  assert.match(migratedConfig, /test\.driftdwells\.com/);
  assert.equal((migratedConfig.match(/ProxyPass \/uploads /g) || []).length, 4);
  assert.equal((migratedConfig.match(/Alias \/assets\//g) || []).length, 2);
  assert.equal(migratedConfig.match(/Alias \/assets\/[^\n]+/g).every(line => line.includes(f.sharedAssets)), true);
  assert.ok(commands.some(item => item.command === '/usr/sbin/httpd' && item.args.includes('DUMP_INCLUDES')));
  assert.ok(commands.some(item => item.command === '/usr/local/directadmin/directadmin' &&
    item.args.join(' ') === 'taskq --run=action=rewrite&value=httpd&user=illoc'));
  assert.equal((fs.statSync(path.join(f.stateRoot, 'backup', 'webroot')).mode & 0o222), 0);
  assert.equal((fs.statSync(path.join(f.stateRoot, 'backup', 'generated-site.conf')).mode & 0o222), 0);
  assert.equal((fs.statSync(path.join(f.stateRoot, 'backup', 'persistent-cust_httpd.conf')).mode & 0o222), 0);

  const rollback = recoverSiteVhostMigration({ stateRoot: f.stateRoot, run, rollback: true });
  assert.equal(rollback.status, 'rolled-back');
  assert.equal(fs.readFileSync(f.siteConfig, 'utf8'), f.siteConfigContents);
  assert.equal(fs.readFileSync(f.customConfig, 'utf8'), f.customSource);
  assert.equal(fs.existsSync(f.pointer), false);
  assert.equal(fs.readFileSync(path.join(f.documentRoot, 'index.html'), 'utf8'), 'original-index');
  assert.equal(fs.readFileSync(path.join(f.documentRoot, 'uploads/year/month/customer.dat'), 'utf8'), 'customer-upload');
  assert.equal(fs.readFileSync(path.join(f.sharedAssets, 'retained.js'), 'utf8'), 'first migration shared asset');
});

test('recovery refuses a concurrently edited persistent customization', async t => {
  const f = fixture();
  t.after(() => removeFixture(f.tmp));
  const { run } = commandRunner({ siteConfig: f.siteConfig, render: f.render });
  await migrateSiteVhost(migrationArgs(f, async () => ({ ok: true, pointerVerified: true }), run));
  fs.appendFileSync(f.customConfig, '\n# independent operator change\n');
  assert.throws(() => recoverSiteVhostMigration({ stateRoot: f.stateRoot, run, rollback: true }),
    /Persistent DirectAdmin config|persistent DirectAdmin config/);
  assert.match(fs.readFileSync(f.customConfig, 'utf8'), /independent operator change/);
  assert.equal(fs.existsSync(f.pointer), true);
});

test('syntax-test failure restores the original config and leaves the document root intact', async t => {
  const f = fixture();
  t.after(() => removeFixture(f.tmp));
  const { run, commands } = commandRunner({ failHttpdAt: 2, siteConfig: f.siteConfig, render: f.render });
  await assert.rejects(migrateSiteVhost(migrationArgs(f, async () => ({ ok: true }), run)), /Apache syntax test failed/);
  assert.equal(fs.readFileSync(f.siteConfig, 'utf8'), f.siteConfigContents);
  assert.equal(fs.existsSync(f.pointer), false);
  assert.equal(fs.readFileSync(path.join(f.documentRoot, 'uploads/year/month/customer.dat'), 'utf8'), 'customer-upload');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.stateRoot, 'vhost-migration.json'), 'utf8')).status, 'recovered');
  assert.equal(commands.filter(item => item.command === '/usr/sbin/httpd' && !item.args.includes('DUMP_INCLUDES')).length, 3);
});

test('baseline syntax or HTTP failure blocks before creating state or touching the site config', async t => {
  for (const failSyntax of [true, false]) {
    const f = fixture();
    t.after(() => removeFixture(f.tmp));
    const { run } = commandRunner({ failHttpdAt: failSyntax ? 1 : null, siteConfig: f.siteConfig, render: f.render });
    const args = migrationArgs(f, async () => ({ ok: true }), run);
    if (!failSyntax) args.preflightProbe = async () => ({ ok: false });
    await assert.rejects(migrateSiteVhost(args), failSyntax ? /Baseline Apache syntax test failed/ : /Baseline live HTTP probes/);
    assert.equal(fs.readFileSync(f.siteConfig, 'utf8'), f.siteConfigContents);
    assert.equal(fs.existsSync(f.pointer), false);
    assert.equal(fs.existsSync(f.stateRoot), false);
  }
});

test('shared-assets policy confirmation and serving verification callback are mandatory', async t => {
  for (const omitCallback of [true, false]) {
    const f = fixture();
    t.after(() => removeFixture(f.tmp));
    const { run } = commandRunner({ siteConfig: f.siteConfig, render: f.render });
    const args = migrationArgs(f, async () => ({ ok: true, pointerVerified: true }), run);
    if (omitCallback) delete args.verifyAssetServing;
    else args.confirmSharedAssetsPolicy = false;
    await assert.rejects(migrateSiteVhost(args), omitCallback
      ? /shared-assets HTTP and vhost verification callback/
      : /append-only, exclusively controlled/);
    assert.equal(fs.existsSync(f.stateRoot), false);
    assert.equal(fs.existsSync(f.pointer), false);
  }
});

test('regeneration and live-probe failures both restore the prior vhost', async t => {
  for (const [failure, expected] of [
    [{ failRewriteOnce: true }, /Account-scoped DirectAdmin HTTP vhost regeneration failed/],
    [{}, /Live HTTP probe did not verify both site routes/],
    [{ wrongMarker: true }, /Live HTTP probe did not verify both site routes/]
  ]) {
    const f = fixture();
    t.after(() => removeFixture(f.tmp));
    const { run } = commandRunner({ ...failure, siteConfig: f.siteConfig, render: f.render });
    const probe = failure.failRewriteOnce
      ? async () => ({ ok: true, pointerVerified: true })
      : failure.wrongMarker
        ? async () => ({ ok: true, pointerVerified: false })
        : async () => ({ ok: false });
    await assert.rejects(migrateSiteVhost(migrationArgs(f, probe, run)), expected);
    assert.equal(fs.readFileSync(f.siteConfig, 'utf8'), f.siteConfigContents);
    assert.equal(fs.existsSync(f.pointer), false);
    assert.equal(fs.readFileSync(path.join(f.documentRoot, 'index.html'), 'utf8'), 'original-index');
  }
});

test('shared-assets serving callback failure restores generated config and leaves the store intact', async t => {
  const f = fixture();
  t.after(() => removeFixture(f.tmp));
  const { run } = commandRunner({ siteConfig: f.siteConfig, render: f.render });
  const args = migrationArgs(f, async () => ({ ok: true, pointerVerified: true }), run);
  args.verifyAssetServing = async ({ sharedAssets, assets }) => {
    assert.equal(sharedAssets, f.sharedAssets);
    assert.deepEqual(assets, f.assets);
    return { ok: false };
  };
  await assert.rejects(migrateSiteVhost(args), /Shared-assets vhost and HTTP verification/);
  assert.equal(fs.readFileSync(f.siteConfig, 'utf8'), f.siteConfigContents);
  assert.equal(fs.existsSync(f.pointer), false);
  assert.equal(fs.readFileSync(path.join(f.sharedAssets, 'retained.js'), 'utf8'), 'first migration shared asset');
  assert.equal(fs.statSync(path.join(f.sharedAssets, 'retained.js')).mode & 0o222, 0);
});

test('interrupted active migration is recoverable and altered backups fail closed', async t => {
  const f = fixture();
  t.after(() => removeFixture(f.tmp));
  const { run } = commandRunner({ siteConfig: f.siteConfig, render: f.render });
  await migrateSiteVhost(migrationArgs(f, async () => ({ ok: true, pointerVerified: true }), run));
  const journalPath = path.join(f.stateRoot, 'vhost-migration.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  journal.status = 'config-installed';
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  const backupFile = path.join(f.stateRoot, 'backup', 'webroot', 'index.html');
  fs.chmodSync(backupFile, 0o644);
  fs.writeFileSync(backupFile, 'tampered-backup');
  fs.chmodSync(backupFile, 0o444);
  assert.throws(() => recoverSiteVhostMigration({ stateRoot: f.stateRoot, run }), /integrity check failed/);
  assert.equal(fs.readFileSync(f.siteConfig, 'utf8').includes(f.pointer), true);
  assert.equal(fs.readFileSync(path.join(f.documentRoot, 'index.html'), 'utf8'), 'original-index');
});

test('recovery removes only journal-owned config and probe transaction temporaries', async t => {
  const f = fixture();
  t.after(() => removeFixture(f.tmp));
  const { run } = commandRunner({ siteConfig: f.siteConfig, render: f.render });
  let token;
  await migrateSiteVhost(migrationArgs(f, async info => {
    token = info.verificationToken;
    return { ok: true, pointerVerified: true };
  }, run));
  const journalPath = path.join(f.stateRoot, 'vhost-migration.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  journal.status = 'config-installed';
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  const configTempPath = journal.persistentConfigs[0].tempPath;
  fs.writeFileSync(configTempPath, 'incomplete atomic config write', { mode: 0o600 });
  const releaseMode = fs.statSync(journal.release).mode & 0o7777;
  fs.chmodSync(journal.release, releaseMode | 0o200);
  fs.writeFileSync(journal.probePath, token, { mode: 0o444 });
  fs.chmodSync(journal.release, releaseMode);
  const result = recoverSiteVhostMigration({ stateRoot: f.stateRoot, run });
  assert.equal(result.status, 'recovered');
  assert.equal(fs.existsSync(configTempPath), false);
  assert.equal(fs.existsSync(journal.probePath), false);
  assert.equal(fs.readFileSync(f.siteConfig, 'utf8'), f.siteConfigContents);
  assert.equal(fs.existsSync(f.pointer), false);
});

test('migration refuses symlinks and nonempty state directories without overwriting them', async t => {
  const f = fixture();
  t.after(() => removeFixture(f.tmp));
  fs.symlinkSync(path.join(f.tmp, 'outside'), path.join(f.documentRoot, 'linked'));
  assert.throws(() => planSiteVhostMigration({
    siteConfig: f.siteConfig, apacheConfig: f.apacheConfig, documentRoot: f.documentRoot,
    customConfig: f.customConfig, directadminUser: 'illoc',
    sharedAssets: f.sharedAssets, assets: f.assets,
    releasesRoot: f.releasesRoot, pointer: f.pointer, stateRoot: f.stateRoot
  }), /symlink/);
  fs.unlinkSync(path.join(f.documentRoot, 'linked'));
  fs.mkdirSync(f.stateRoot);
  fs.writeFileSync(path.join(f.stateRoot, 'unrelated'), 'do not overwrite');
  const { run } = commandRunner({ siteConfig: f.siteConfig, render: f.render });
  await assert.rejects(migrateSiteVhost(migrationArgs(f, async () => ({ ok: true }), run)), /State directory must be new/);
  assert.equal(fs.readFileSync(path.join(f.stateRoot, 'unrelated'), 'utf8'), 'do not overwrite');
});

test('conflicting shared-assets mapping blocks before migration state is created', t => {
  const f = fixture();
  t.after(() => removeFixture(f.tmp));
  const conflictingAlias = f.siteConfigContents.replace('ServerName www.driftdwells.com',
    `Alias /assets/ "${f.sharedAssets}-wrong/"\nServerName www.driftdwells.com`);
  fs.writeFileSync(f.siteConfig, conflictingAlias);
  assert.throws(() => planSiteVhostMigration({
    siteConfig: f.siteConfig, apacheConfig: f.apacheConfig, documentRoot: f.documentRoot,
    customConfig: f.customConfig, directadminUser: 'illoc',
    sharedAssets: f.sharedAssets, assets: f.assets,
    releasesRoot: f.releasesRoot, pointer: f.pointer, stateRoot: f.stateRoot
  }), /shared-assets Apache mapping/);
  assert.equal(fs.existsSync(f.pointer), false);
  assert.equal(fs.existsSync(f.stateRoot), false);
});

test('invalid shared assets fail closed before creating migration state', t => {
  const f = fixture();
  t.after(() => removeFixture(f.tmp));
  const args = {
    siteConfig: f.siteConfig, apacheConfig: f.apacheConfig, documentRoot: f.documentRoot,
    customConfig: f.customConfig, directadminUser: 'illoc',
    sharedAssets: f.sharedAssets, assets: [{ ...f.assets[0], sha256: '0'.repeat(64) }],
    releasesRoot: f.releasesRoot, pointer: f.pointer, stateRoot: f.stateRoot
  };
  assert.throws(() => planSiteVhostMigration(args), /manifest does not match document-root asset/);
  assert.equal(fs.existsSync(f.stateRoot), false);
  assert.equal(fs.existsSync(f.pointer), false);
});

test('only the authorized DirectAdmin account can be planned', t => {
  const f = fixture();
  t.after(() => removeFixture(f.tmp));
  assert.throws(() => planSiteVhostMigration({
    siteConfig: f.siteConfig, customConfig: f.customConfig, directadminUser: 'another-user',
    apacheConfig: f.apacheConfig, documentRoot: f.documentRoot, sharedAssets: f.sharedAssets,
    assets: f.assets, releasesRoot: f.releasesRoot, pointer: f.pointer, stateRoot: f.stateRoot
  }), /only.*illoc/i);
  assert.equal(fs.existsSync(f.stateRoot), false);
  assert.equal(fs.readFileSync(f.customConfig, 'utf8'), f.customSource);
});

test('rejects a customization path from another account or domain before any write', t => {
  const f = fixture();
  t.after(() => removeFixture(f.tmp));
  for (const customConfig of [
    path.join(f.tmp, 'etc/httpd/users/other/domains/driftdwells.com.cust_httpd'),
    path.join(path.dirname(f.customConfig), 'other.example.cust_httpd')
  ]) {
    assert.throws(() => planSiteVhostMigration({
      siteConfig: f.siteConfig, customConfig, directadminUser: 'illoc', apacheConfig: f.apacheConfig,
      documentRoot: f.documentRoot, sharedAssets: f.sharedAssets, assets: f.assets,
      releasesRoot: f.releasesRoot, pointer: f.pointer, stateRoot: f.stateRoot
    }), /must identify the illoc account/);
  }
  assert.equal(fs.existsSync(f.stateRoot), false);
});
