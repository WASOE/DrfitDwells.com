import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const clientDir = path.resolve(__dirname, '..');
const clientSrc = path.join(clientDir, 'src');
const repoRoot = path.resolve(clientDir, '..');
const uploadsRoot = path.join(repoRoot, 'uploads');

/**
 * Extract /uploads/... paths from file content.
 * Handles: '...', "...", and url(/uploads/...)
 */
function extractPathsFromContent(content) {
  const paths = new Set();
  // Single-quoted strings containing /uploads/
  let m;
  const singleRe = /'(\/uploads\/[^']*)'/g;
  while ((m = singleRe.exec(content)) !== null) {
    paths.add(m[1]);
  }
  // Double-quoted strings containing /uploads/
  const doubleRe = /"(\/uploads\/[^"]*)"/g;
  while ((m = doubleRe.exec(content)) !== null) {
    paths.add(m[1]);
  }
  // url("/uploads/...") or url('/uploads/...')
  const urlQuotedRe = /url\(\s*['"](\/uploads\/[^'"]*)['"]\s*\)/g;
  while ((m = urlQuotedRe.exec(content)) !== null) {
    paths.add(m[1]);
  }
  // url(/uploads/... ) unquoted — path may contain ) e.g. "(6).jpeg"
  const urlUnquotedRe = /url\(\s*(\/uploads\/.+?\.(?:jpeg|jpg|png|gif|avif|webp|pdf))\s*\)/g;
  while ((m = urlUnquotedRe.exec(content)) !== null) {
    paths.add(m[1]);
  }
  return paths;
}

/**
 * Normalize path for filesystem: strip leading slash, decode %20 etc.
 */
function normalizePath(p) {
  const rel = p.replace(/^\/+/, '');
  try {
    return decodeURIComponent(rel);
  } catch {
    return rel;
  }
}

function* walkJsFiles(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkJsFiles(full);
    } else if (/\.(js|jsx|ts|tsx)$/.test(e.name)) {
      yield full;
    }
  }
}

function collectPathsFromConfig(config, out) {
  if (!config || typeof config !== 'object') return;
  if (typeof config === 'string' && config.startsWith('/uploads/')) {
    out.add(config);
    return;
  }
  for (const value of Object.values(config)) {
    collectPathsFromConfig(value, out);
  }
}

async function main() {
  if (!fs.existsSync(uploadsRoot)) {
    console.error(
      `[validate-media-assets] Expected uploads directory at: ${uploadsRoot}\n` +
      'Create the uploads folder and place media there.'
    );
    process.exit(1);
  }

  // path (normalized) -> Set of source file paths (relative to repo)
  const pathToSources = new Map();

  // 1. Scan all client/src/**/*.{js,jsx,ts,tsx}
  for (const absPath of walkJsFiles(clientSrc)) {
    const content = fs.readFileSync(absPath, 'utf8');
    const paths = extractPathsFromContent(content);
    const relFile = path.relative(repoRoot, absPath);
    for (const p of paths) {
      const norm = normalizePath(p);
      if (!pathToSources.has(norm)) {
        pathToSources.set(norm, new Set());
      }
      pathToSources.get(norm).add(relFile);
    }
  }

  // 2. Add paths from mediaConfig.js
  const configPath = path.join(clientSrc, 'config', 'mediaConfig.js');
  if (fs.existsSync(configPath)) {
    const { CABIN_MEDIA, VALLEY_MEDIA } = await import(
      path.join(clientSrc, 'config', 'mediaConfig.js')
    );
    const configPaths = new Set();
    collectPathsFromConfig({ CABIN_MEDIA, VALLEY_MEDIA }, configPaths);
    const relFile = path.relative(repoRoot, configPath);
    for (const p of configPaths) {
      const norm = normalizePath(p);
      if (!pathToSources.has(norm)) {
        pathToSources.set(norm, new Set());
      }
      pathToSources.get(norm).add(relFile);
    }
  }

  // 3. Check every path against filesystem (allow basePath + extension, e.g. SKy-view-Aframe + .jpg)
  const extTry = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.pdf'];
  const exists = (normPath) => {
    const full = path.join(repoRoot, normPath);
    if (fs.existsSync(full)) return true;
    if (path.extname(normPath)) return false; // already has extension
    for (const ext of extTry) {
      if (fs.existsSync(full + ext)) return true;
    }
    return false;
  };
  const missing = [];
  for (const [normPath, sources] of pathToSources) {
    if (!exists(normPath)) {
      missing.push({ path: normPath, sources: Array.from(sources).sort() });
    }
  }

  if (missing.length > 0) {
    console.error('[validate-media-assets] Missing referenced assets (path + source files):\n');
    for (const { path: rel, sources } of missing.sort((a, b) => a.path.localeCompare(b.path))) {
      console.error(`  ${rel}`);
      sources.forEach((s) => console.error(`    <- ${s}`));
      console.error('');
    }
    console.error('Do not rename or move files in uploads/. Code must match existing filenames.');
    process.exit(1);
  }

  console.log('[validate-media-assets] All referenced /uploads/ assets exist on disk.');
}

main();
