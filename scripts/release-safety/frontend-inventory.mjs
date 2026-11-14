import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function inventory(root) {
  const files = [];
  function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile()) files.push({ path: relative, size: fs.statSync(absolute).size, sha256: sha256(absolute) });
      else throw new Error(`Unsupported artifact entry: ${relative}`);
    }
  }
  if (!fs.lstatSync(root).isDirectory()) throw new Error('Artifact root must be a directory');
  walk(root);
  return files;
}

export function createInventory(root, commit, configuration) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('A full lowercase commit SHA is required');
  if (!['test', 'production'].includes(configuration)) throw new Error('Invalid build configuration');
  return { version: 1, commit, configuration, files: inventory(root) };
}

export function verifyInventory(root, expected) {
  if (!expected || expected.version !== 1 || !Array.isArray(expected.files)) {
    throw new Error('Invalid artifact inventory');
  }
  const actual = createInventory(root, expected.commit, expected.configuration);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Frontend artifact inventory mismatch');
  return actual;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operation, root, manifest, commit, configuration] = process.argv.slice(2);
  try {
    if (operation === 'create' && root && manifest && commit && configuration) {
      const result = createInventory(root, commit, configuration);
      fs.writeFileSync(manifest, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
      console.log(`Inventoried ${result.files.length} files for ${result.commit} (${result.configuration})`);
    } else if (operation === 'verify' && root && manifest && !commit && !configuration) {
      const result = verifyInventory(root, JSON.parse(fs.readFileSync(manifest, 'utf8')));
      console.log(`Verified ${result.files.length} files for ${result.commit} (${result.configuration})`);
    } else {
      throw new Error('Usage: frontend-inventory.mjs create <dist> <manifest> <commit> <test|production> | verify <dist> <manifest>');
    }
  } catch (error) {
    console.error(`[frontend-inventory] ${error.message}`);
    process.exitCode = 1;
  }
}
