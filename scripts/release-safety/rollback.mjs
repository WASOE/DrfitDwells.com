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

export function snapshotFrontendShell(webroot, snapshotDir) {
  const root = path.resolve(webroot);
  const dest = path.resolve(snapshotDir);
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
    files: copied
  }, null, 2)}\n`);
  return { snapshotDir: dest, files: copied };
}

export function restoreFrontendShell(webroot, snapshotDir) {
  const root = path.resolve(webroot);
  const source = path.resolve(snapshotDir);
  const restored = [];
  for (const name of SHELL_FILES) {
    const file = path.join(source, name);
    if (!fs.existsSync(file)) continue;
    fs.copyFileSync(file, path.join(root, name));
    restored.push(name);
  }
  if (!restored.includes('index.html') || !restored.includes('.htaccess')) {
    throw new Error('Snapshot is missing index.html or .htaccess; rollback refused.');
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
