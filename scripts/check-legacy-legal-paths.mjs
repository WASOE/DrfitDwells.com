import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const forbidden = [
  '/uploads/PDFs/drift-dwells-docs-v2/terms.pdf',
  '/uploads/PDFs/drift-dwells-docs-v2/cancellation-policy.pdf'
];

const allowedFiles = new Set([
  path.join(root, 'scripts', 'check-legacy-legal-paths.mjs'),
  path.join(root, 'server', 'server.js')
]);

const skipDirs = new Set([
  '.git',
  'node_modules',
  'client/node_modules',
  'server/node_modules',
  'client/dist',
  'uploads',
  'client/public/uploads'
]);

const scanExt = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.mjs', '.cjs', '.yml', '.yaml'
]);

const violations = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const rel = path.relative(root, fullPath).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      if (skipDirs.has(rel)) continue;
      walk(fullPath);
      continue;
    }
    if (!scanExt.has(path.extname(entry.name))) continue;
    if (allowedFiles.has(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf8');
    for (const needle of forbidden) {
      if (content.includes(needle)) {
        violations.push({ file: rel, needle });
      }
    }
  }
}

walk(root);

if (violations.length > 0) {
  console.error('Legacy legal PDF path references found:');
  for (const v of violations) {
    console.error(`- ${v.file}: ${v.needle}`);
  }
  process.exit(1);
}

console.log('No legacy legal PDF path references found.');
