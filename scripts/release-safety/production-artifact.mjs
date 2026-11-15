#!/usr/bin/env node
/**
 * Production frontend packaging only; never publishes or activates a release.
 * create <dist> <new-package-directory> <full-sha>
 * verify <package-directory> <new-dist-directory> <full-sha>
 * Both commands require VITE_STRIPE_PUBLISHABLE_KEY (the expected public live key).
 * Requires GNU tar and Python 3; extraction never accepts links or special files.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInventory, verifyInventory } from './frontend-inventory.mjs';
import { assessPaymentContractBundle } from '../lib/verifyPaymentContractBundle.mjs';

export const ARCHIVE = 'production-frontend.tar';
export const INVENTORY = 'frontend-inventory.json';
export const CHECKSUM = `${ARCHIVE}.sha256`;
export const PACKAGE_FILES = [ARCHIVE, INVENTORY, CHECKSUM, 'apache-evidence.json', 'browser-evidence.json'];
export const MAX_BYTES = 1024 * 1024 * 1024;

export function requireCommit(commit) {
  if (!/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('A full lowercase commit SHA is required');
}

export function requireProductionKey(key) {
  if (!/^pk_live_[A-Za-z0-9]+$/.test(key || '')) throw new Error('An explicit production Stripe publishable key is required');
}

export function sha256(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let size;
    while ((size = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, size));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

export function verifyProductionBuild(root, commit, key) {
  requireCommit(commit);
  requireProductionKey(key);
  const assessment = assessPaymentContractBundle(root, { env: {
    VITE_FRONTEND_RELEASE: commit,
    VITE_STRIPE_PUBLISHABLE_KEY: key,
    VITE_CHECKOUT_SESSION_V2: '1',
    VITE_FINALIZE_INTENT_PERSIST: '1',
    VITE_FINALIZE_INTENT_REQUIRED_FOR_PI: '1'
  } });
  if (!assessment.ok) throw new Error(`Production compiled contract rejected: ${assessment.errors.join('; ')}`);
  const inventory = createInventory(root, commit, 'production');
  const keys = new Set();
  for (const file of inventory.files.filter(file => /\.(js|html|json|map)$/.test(file.path))) {
    const source = fs.readFileSync(path.join(root, file.path), 'utf8');
    for (const match of source.matchAll(/pk_(?:live|test)_[A-Za-z0-9]+/g)) keys.add(match[0]);
  }
  if (keys.size !== 1 || !keys.has(key)) throw new Error('Compiled Stripe keys must contain only the expected production key');
  for (const required of ['index.html', '.htaccess', 'sw.js']) {
    if (!inventory.files.some(file => file.path === required)) throw new Error(`Incomplete frontend: ${required} missing`);
  }
  return inventory;
}

// Inspect the entire archive before writing anything. Do not let tar implement
// link, ownership, permissions, device or traversal semantics on the consumer.
const EXTRACT_TAR = `
import pathlib, sys, tarfile
archive, destination, limit = sys.argv[1], sys.argv[2], int(sys.argv[3])
with tarfile.open(archive, 'r:') as tar:
    members = []
    seen = set()
    total = 0
    for item in tar:
        members.append(item)
        if len(members) > 100000: raise ValueError('Archive entry limit exceeded')
        name = item.name
        if name.startswith('./'): name = name[2:]
        if name in ('', '.'):
            if not item.isdir(): raise ValueError('Invalid archive root')
            continue
        parts = name.rstrip('/').split('/')
        if name.startswith('/') or any(p in ('', '.', '..') for p in parts) or '\\\\' in name:
            raise ValueError('Unsafe archive path')
        clean = '/'.join(parts)
        if clean in seen: raise ValueError('Duplicate archive entry')
        seen.add(clean)
        if not (item.isfile() or item.isdir()): raise ValueError('Unsupported archive entry')
        total += item.size
        if total > limit: raise ValueError('Archive size limit exceeded')
    for item in members:
        name = item.name[2:] if item.name.startswith('./') else item.name
        if name in ('', '.'): continue
        target = pathlib.Path(destination).joinpath(name)
        if item.isdir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with tar.extractfile(item) as source, open(target, 'xb') as output:
                import shutil
                shutil.copyfileobj(source, output)
`;

export function verifyPackage(directory, destination, commit, key) {
  requireCommit(commit);
  requireProductionKey(key);
  if (fs.existsSync(destination)) throw new Error('Extraction destination must not exist');
  const archive = path.join(directory, ARCHIVE);
  const checksum = fs.readFileSync(path.join(directory, CHECKSUM), 'utf8');
  if (checksum !== `${sha256(archive)}  ${ARCHIVE}\n`) throw new Error('Production archive SHA256 mismatch');
  const inventory = JSON.parse(fs.readFileSync(path.join(directory, INVENTORY), 'utf8'));
  if (inventory.commit !== commit || inventory.configuration !== 'production') throw new Error('Production inventory commit/configuration mismatch');
  fs.mkdirSync(destination, { mode: 0o700 });
  try {
    execFileSync('python3', ['-c', EXTRACT_TAR, archive, destination, String(MAX_BYTES)], { stdio: 'pipe' });
    verifyInventory(destination, inventory);
    verifyProductionBuild(destination, commit, key);
    return inventory;
  } catch (error) {
    if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}

export function createPackage(root, directory, commit, key) {
  const inventory = verifyProductionBuild(root, commit, key);
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, INVENTORY), `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx' });
  execFileSync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
    '-C', root, '-cf', path.join(path.resolve(directory), ARCHIVE), '.']);
  // Detect source mutation while packaging; only the round-tripped bytes pass.
  const archive = path.join(directory, ARCHIVE);
  fs.writeFileSync(path.join(directory, CHECKSUM), `${sha256(archive)}  ${ARCHIVE}\n`, { flag: 'wx' });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, source, destination, commit, ...extra] = process.argv.slice(2);
  try {
    if (!source || !destination || extra.length || !['create', 'verify'].includes(command)) {
      throw new Error('Usage: production-artifact.mjs <create|verify> <source> <new-destination> <full-sha>; VITE_STRIPE_PUBLISHABLE_KEY required');
    }
    if (command === 'create') createPackage(source, destination, commit, process.env.VITE_STRIPE_PUBLISHABLE_KEY);
    else verifyPackage(source, destination, commit, process.env.VITE_STRIPE_PUBLISHABLE_KEY);
    console.log(`[production-artifact] ${command} passed for ${commit}`);
  } catch (error) {
    console.error(`[production-artifact] ${error.message}`);
    process.exitCode = 1;
  }
}
