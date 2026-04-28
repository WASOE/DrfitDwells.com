import { copyFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientRoot = path.resolve(__dirname, '..');

const sourcePath = path.join(clientRoot, 'public', '.htaccess');
const targetPath = path.join(clientRoot, 'dist', '.htaccess');

async function ensureSourceExists() {
  await access(sourcePath, fsConstants.F_OK);
}

async function run() {
  await ensureSourceExists();
  await copyFile(sourcePath, targetPath);
  console.log(`[copy-htaccess] Copied ${sourcePath} -> ${targetPath}`);
}

run().catch((error) => {
  console.error('[copy-htaccess] Failed to copy .htaccess:', error);
  process.exit(1);
});
