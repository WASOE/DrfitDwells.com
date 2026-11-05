/**
 * Frontend shell rollback. Restores index.html, sw.js, .htaccess and the
 * release manifest from a snapshot. Hashed assets and uploads are left in place.
 * This never restarts the API and refuses the production webroot.
 */
import fs from 'node:fs';
import path from 'node:path';

const SHELL_FILES = ['index.html', 'sw.js', '.htaccess', 'release-manifest.json'];

export function assertRollbackAllowed(webroot, env = process.env) {
  const resolved = path.resolve(webroot);
  const production = resolved.includes(`${path.sep}domains${path.sep}driftdwells.com${path.sep}`);
  if (production && env.CONFIRM_FRONTEND_ROLLBACK !== '1') {
    throw new Error(`Refusing production webroot without CONFIRM_FRONTEND_ROLLBACK=1: ${resolved}`);
  }
  return resolved;
}

export function assertSnapshotOutsideWebroot(webroot, snapshotDir) {
  const root = path.resolve(webroot);
  const dest = path.resolve(snapshotDir);
  if (dest === root || dest.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Release snapshots must not be stored inside the public document root: ${dest}`);
  }
  return dest;
}

export function resolveSnapshotDir(webroot, releaseSha) {
  const safe = String(releaseSha || '');
  if (!/^[a-f0-9]{40,64}$/i.test(safe)) {
    throw new Error('Snapshot directory requires the full release SHA.');
  }
  const dest = path.resolve(path.resolve(webroot), '..', 'private-release-snapshots', safe);
  return assertSnapshotOutsideWebroot(webroot, dest);
}

export function snapshotFrontendShell(webroot, snapshotDir) {
  const root = path.resolve(webroot);
  const dest = assertSnapshotOutsideWebroot(root, snapshotDir);
  fs.mkdirSync(dest, { recursive: true });
  const copied = [];
  for (const name of SHELL_FILES) {
    const source = path.join(root, name);
    if (!fs.existsSync(source)) continue;
    fs.copyFileSync(source, path.join(dest, name));
    copied.push(name);
  }
  fs.writeFileSync(path.join(dest, 'snapshot.json'), `${JSON.stringify({
    createdAt: new Date().toISOString(),
    webroot: root,
    files: copied
  }, null, 2)}\n`);
  return { snapshotDir: dest, files: copied };
}

export function restoreFrontendShell(webroot, snapshotDir) {
  const root = path.resolve(webroot);
  const source = path.resolve(snapshotDir);
  const metaPath = path.join(source, 'snapshot.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error('Snapshot metadata is missing; rollback refused.');
  }
  const copied = JSON.parse(fs.readFileSync(metaPath, 'utf8')).files || [];
  const restored = [];
  for (const name of SHELL_FILES) {
    const file = path.join(source, name);
    const dest = path.join(root, name);
    if (copied.includes(name) && fs.existsSync(file)) {
      fs.copyFileSync(file, dest);
      restored.push(name);
    } else if (!copied.includes(name) && fs.existsSync(dest)) {
      fs.unlinkSync(dest);
      restored.push(`removed:${name}`);
    }
  }
  return { restored };
}

export function criticalRouteFailures(responses) {
  return responses.filter((response) => {
    const pathName = response.finalPath || '';
    const brokeSearch = response.id === 'search' && pathName !== '/search';
    const brokeCheckout = response.id === 'checkout' && pathName !== '/checkout';
    const bouncedHome = response.errors?.some((error) => error.includes('homepage'));
    return brokeSearch || brokeCheckout || bouncedHome || response.ok === false;
  });
}
