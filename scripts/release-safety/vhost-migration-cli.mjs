#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DIRECTADMIN_REGENERATION_VERIFIED,
  assertSiteSharedAssetsMapping,
  migrateSiteVhost,
  planSiteVhostMigration,
  recoverSiteVhostMigration
} from './vhost-migration.mjs';

function usage() {
  return `Usage:
  vhost-migration-cli.mjs plan --site-config PATH --custom-config PATH --directadmin-user illoc --apache-config PATH --document-root PATH --shared-assets PATH --assets-manifest JSON --release-root PATH --pointer PATH --state-dir NEW_PATH
  vhost-migration-cli.mjs apply --apply --confirm-webroot-quiesced --confirm-account-scoped-regeneration --confirm-shared-assets-policy --site-config PATH --custom-config PATH --directadmin-user illoc --apache-config PATH --document-root PATH --shared-assets PATH --assets-manifest JSON --release-root PATH --pointer PATH --state-dir NEW_PATH --httpd PATH [--httpd-arg ARG] --directadmin PATH --copy-command PATH --probe-url HTTPS_URL --probe-url HTTPS_URL
  vhost-migration-cli.mjs recover --state-dir PATH
  vhost-migration-cli.mjs rollback --state-dir PATH

All host paths and commands are explicit. Planning is read-only. This migration accepts
only account illoc and regenerates it using taskq --run=action=rewrite&value=httpd&user=illoc;
it never writes the generated Apache site config. Apply/recovery are disabled until real
DirectAdmin taskq queue isolation and Apache reload side effects have been verified.
HTTPS probes for /search and /checkout on the same origin are required.`;
}

function parse(argv) {
  const [action, ...args] = argv;
  const options = { action, httpdArgs: [], probeUrls: [] };
  const valueOptions = new Map([
    ['--site-config', 'siteConfig'], ['--apache-config', 'apacheConfig'],
    ['--custom-config', 'customConfig'],
    ['--document-root', 'documentRoot'], ['--shared-assets', 'sharedAssets'], ['--release-root', 'releasesRoot'],
    ['--assets-manifest', 'assetsManifest'],
    ['--pointer', 'pointer'], ['--state-dir', 'stateRoot'], ['--httpd', 'httpd'],
    ['--directadmin', 'directadmin'], ['--directadmin-user', 'directadminUser'],
    ['--copy-command', 'copyCommand']
  ]);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--apply' || flag === '--confirm-webroot-quiesced' ||
        flag === '--confirm-account-scoped-regeneration' || flag === '--confirm-shared-assets-policy') {
      if (flag === '--apply') options.apply = true;
      else if (flag === '--confirm-webroot-quiesced') options.confirmWebrootQuiesced = true;
      else if (flag === '--confirm-account-scoped-regeneration') options.confirmDirectAdminAccount = true;
      else options.confirmSharedAssetsPolicy = true;
    } else if (flag === '--httpd-arg' || flag === '--probe-url') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
      const key = flag === '--httpd-arg' ? 'httpdArgs' : 'probeUrls';
      options[key].push(value);
    } else if (valueOptions.has(flag)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
      options[valueOptions.get(flag)] = value;
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (!['plan', 'apply', 'recover', 'rollback'].includes(action)) throw new Error(usage());
  return options;
}

function liveProbe(urls) {
  const expectedPaths = new Set(['/search', '/checkout']);
  const parsed = urls.map(value => new URL(value));
  if (parsed.length !== expectedPaths.size || parsed.some(url =>
    url.protocol !== 'https:' || !['www.driftdwells.com', 'driftdwells.com'].includes(url.hostname) ||
    Boolean(url.username || url.password || url.search || url.hash) || !expectedPaths.has(url.pathname)) ||
      new Set(parsed.map(url => url.origin)).size !== 1 || new Set(parsed.map(url => url.pathname)).size !== expectedPaths.size) {
    throw new Error('Exactly one HTTPS /search and /checkout probe on the same Drift & Dwells origin is required');
  }
  const routeProbe = async ({ verificationPath, verificationToken } = {}) => {
    for (const url of parsed) {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      if (response.status !== 200) return { ok: false, route: url.pathname, status: response.status };
      await response.body?.cancel();
    }
    if (typeof verificationPath !== 'string' || typeof verificationToken !== 'string') return { ok: true };
    const markerUrl = new URL(verificationPath, parsed[0].origin);
    const response = await fetch(markerUrl, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    if (response.status !== 200) return { ok: false, route: markerUrl.pathname, status: response.status };
    const marker = await response.text();
    return { ok: true, pointerVerified: marker === verificationToken };
  };
  const verifyAssetServing = async ({ sharedAssets, assets, siteConfig, siteConfigSha256 }) => {
    const configStat = fs.lstatSync(siteConfig);
    if (!configStat.isFile() || configStat.isSymbolicLink() || configStat.nlink !== 1 ||
        fs.realpathSync(siteConfig) !== siteConfig) {
      throw new Error('Apache site config is no longer a real regular file');
    }
    const config = fs.readFileSync(siteConfig);
    const configHash = crypto.createHash('sha256').update(config).digest('hex');
    if (configHash !== siteConfigSha256) throw new Error('Apache site config changed before asset verification');
    assertSiteSharedAssetsMapping(config.toString('utf8'), sharedAssets);
    for (const asset of assets) {
      const url = new URL(`/${asset.path}`, parsed[0].origin);
      url.searchParams.set('vhost-migration-check', crypto.randomBytes(12).toString('hex'));
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
        headers: {
          'Cache-Control': 'no-cache, no-store',
          Pragma: 'no-cache',
          'Accept-Encoding': 'identity'
        }
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        return { ok: false, asset: asset.path, status: response.status };
      }
      const encoding = response.headers.get('content-encoding');
      if (encoding && encoding !== 'identity') {
        await response.body?.cancel();
        return { ok: false, asset: asset.path, reason: 'encoded response' };
      }
      const digest = crypto.createHash('sha256');
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > asset.size) {
          await response.body?.cancel();
          return { ok: false, asset: asset.path, reason: 'size exceeded' };
        }
        digest.update(chunk);
      }
      if (size !== asset.size || digest.digest('hex') !== asset.sha256) {
        return { ok: false, asset: asset.path, reason: 'size or hash mismatch' };
      }
    }
    return { ok: true };
  };
  return { routeProbe, verifyAssetServing };
}

async function main(argv) {
  const options = parse(argv);
  if (options.action === 'recover' || options.action === 'rollback') {
    if (!DIRECTADMIN_REGENERATION_VERIFIED) {
      throw new Error('DirectAdmin recovery/rollback is disabled until real taskq regeneration, queue isolation, and Apache reload side effects are verified');
    }
    if (!options.stateRoot) throw new Error('--state-dir is required');
    return recoverSiteVhostMigration({
      stateRoot: options.stateRoot, rollback: options.action === 'rollback'
    });
  }
  if (options.action === 'apply') {
    if (!options.apply) throw new Error('Applying a vhost migration requires the explicit --apply flag');
    if (!DIRECTADMIN_REGENERATION_VERIFIED) {
      throw new Error('DirectAdmin apply is disabled until real taskq regeneration, queue isolation, and Apache reload side effects are verified');
    }
  }
  const required = [
    'siteConfig', 'customConfig', 'directadminUser',
    'apacheConfig', 'documentRoot', 'sharedAssets', 'assetsManifest', 'releasesRoot', 'pointer', 'stateRoot'
  ];
  for (const key of required) if (!options[key]) throw new Error(`Missing ${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`);
  let assets;
  try { assets = JSON.parse(fs.readFileSync(options.assetsManifest, 'utf8')); }
  catch (error) { throw new Error(`Unable to read shared-assets manifest: ${error.message}`);   }
  if (options.action === 'plan') return planSiteVhostMigration({ ...options, assets });
  if (!options.confirmWebrootQuiesced) {
    throw new Error('Applying a vhost migration requires --confirm-webroot-quiesced after verifying no webroot writers are active');
  }
  if (!options.confirmDirectAdminAccount) {
    throw new Error('Applying a vhost migration requires --confirm-account-scoped-regeneration after verifying the exact DirectAdmin account');
  }
  if (!options.confirmSharedAssetsPolicy) {
    throw new Error('Applying a vhost migration requires --confirm-shared-assets-policy after verifying exclusive append-only publisher ownership and Apache read-only access');
  }
  for (const key of ['httpd', 'directadmin', 'copyCommand']) {
    if (!options[key]) throw new Error(`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)} is required`);
  }
  const probes = liveProbe(options.probeUrls);
  return migrateSiteVhost({
    ...options,
    assets,
    preflightProbe: probes.routeProbe,
    probe: probes.routeProbe,
    verifyAssetServing: probes.verifyAssetServing
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--help' || process.argv[2] === '-h') {
      console.log(usage());
    } else {
      console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2));
    }
  } catch (error) {
    console.error(`[vhost-migration] ${error.message}`);
    process.exitCode = 1;
  }
}
