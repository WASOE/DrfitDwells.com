/**
 * Safe frontend deploy helpers — additive asset publish, protected paths, retention.
 *
 * Canonical production mode: server-local publication via WEBROOT.
 * Optional mode: remote rsync via REMOTE (for staging, CI, etc.).
 *
 * Stale asset pruning is NOT implemented in this release.
 * Old hashed assets accumulate intentionally until a separately audited prune job exists.
 */
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Protected paths
// ---------------------------------------------------------------------------

export const DEFAULT_PROTECTED_RELATIVE_PATHS = [
  'uploads',
  'release-manifest.json',
];

export const DEFAULT_PROTECTED_GLOBS = [
  'index.html.backup-*',
  '.htaccess.bk-*',
];

export function matchesProtectedGlob(name, glob) {
  if (glob.endsWith('*')) {
    return name.startsWith(glob.slice(0, -1));
  }
  return name === glob;
}

export function isProtectedPath(relativePath, options = {}) {
  const protectedPaths = options.protectedPaths ?? DEFAULT_PROTECTED_RELATIVE_PATHS;
  const protectedGlobs = options.protectedGlobs ?? DEFAULT_PROTECTED_GLOBS;
  const normalized = relativePath.replace(/\\/g, '/');

  for (const protectedPath of protectedPaths) {
    const p = protectedPath.replace(/\\/g, '/');
    if (normalized === p || normalized.startsWith(`${p}/`)) {
      return true;
    }
  }

  const baseName = path.posix.basename(normalized);
  return protectedGlobs.some((glob) => matchesProtectedGlob(baseName, glob));
}

export function assertNoProtectedPathsDeleted(deletedRelativePaths, options = {}) {
  const blocked = deletedRelativePaths.filter((p) => isProtectedPath(p, options));
  if (blocked.length > 0) {
    throw new Error(`Refusing deploy plan that deletes protected paths: ${blocked.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// WEBROOT validation — refuse dangerous destinations
// ---------------------------------------------------------------------------

export function validateWebroot(webroot, { repoRoot, distDir } = {}) {
  if (!webroot || typeof webroot !== 'string') {
    return { valid: false, reason: 'WEBROOT is empty or unset.' };
  }

  const resolved = path.resolve(webroot);

  if (resolved === '/') {
    return { valid: false, reason: 'WEBROOT must not be /.' };
  }

  // Must be absolute
  if (!path.isAbsolute(resolved)) {
    return { valid: false, reason: 'WEBROOT must be an absolute path.' };
  }

  // Refuse repo root
  if (repoRoot && path.resolve(repoRoot) === resolved) {
    return { valid: false, reason: 'WEBROOT must not be the repository root.' };
  }

  // Refuse client/dist itself
  if (distDir && path.resolve(distDir) === resolved) {
    return { valid: false, reason: 'WEBROOT must not be client/dist itself.' };
  }

  // Refuse paths with less than 3 components (e.g. /home, /var) — too broad
  const parts = resolved.split(path.sep).filter(Boolean);
  if (parts.length < 3) {
    return { valid: false, reason: `WEBROOT path is too shallow (${resolved}). Supply an explicit deployment target.` };
  }

  return { valid: true, resolved };
}

// ---------------------------------------------------------------------------
// Asset helpers
// ---------------------------------------------------------------------------

export function listHashedAssets(assetsDir) {
  if (!fs.existsSync(assetsDir)) return [];
  return fs
    .readdirSync(assetsDir)
    .filter((name) => /\.(js|css|map|woff2?)$/i.test(name))
    .sort();
}

// ---------------------------------------------------------------------------
// Release manifest
// ---------------------------------------------------------------------------

export function readReleaseManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

export function mergeReleaseManifest(previous, next, assetFiles) {
  const previousAssets = Array.isArray(previous?.assetFiles)
    ? previous.assetFiles
    : Array.isArray(previous?.retainedAssetFiles)
      ? previous.retainedAssetFiles
      : [];

  return {
    ...next,
    assetFiles,
    retainedAssetFiles: [...new Set([...assetFiles, ...previousAssets])],
    previousRelease: previous?.frontendRelease || previous?.applicationCommit || null,
    deployStrategy: 'additive-no-delete'
  };
}

// ---------------------------------------------------------------------------
// Local WEBROOT publication phases (canonical production mode)
// ---------------------------------------------------------------------------

/**
 * Copy files from `srcDir` into `destDir`, creating directories as needed.
 * Returns the list of relative paths written.
 *
 * @param {string} srcDir
 * @param {string} destDir
 * @param {{ exclude?: string[], include?: string[], dryRun?: boolean }} options
 */
export function copyDirAdditive(srcDir, destDir, options = {}) {
  const { exclude = [], include = null, dryRun = false } = options;
  const written = [];

  if (!fs.existsSync(srcDir)) return written;

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name;

    if (exclude.includes(name)) continue;
    if (include && !include.includes(name)) continue;

    const srcPath = path.join(srcDir, name);
    const destPath = path.join(destDir, name);

    if (entry.isDirectory()) {
      const subWritten = copyDirAdditive(srcPath, destPath, { dryRun, exclude: [] });
      written.push(...subWritten.map((rel) => path.join(name, rel)));
    } else {
      if (!dryRun) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
      }
      written.push(name);
    }
  }

  return written;
}

/**
 * Build the ordered publication steps for local WEBROOT mode.
 *
 * Phase 1: assets (additive copy, never delete existing)
 * Phase 2: static files excluding assets/, index.html, sw.js, uploads/
 * Phase 3: index.html + sw.js last (switch the shell)
 * Phase 4: release-manifest.json
 */
export function executeLocalPublish({ distDir, webroot, dryRun = false }) {
  const dist = path.resolve(distDir);
  const root = path.resolve(webroot);
  const log = [];

  // Phase 1: assets — additive
  const assetsWritten = copyDirAdditive(
    path.join(dist, 'assets'),
    path.join(root, 'assets'),
    { dryRun }
  );
  log.push({ phase: 'assets-additive', files: assetsWritten.length, dryRun });

  // Phase 2: everything except assets, shell files, uploads, and protected items
  const staticExclude = ['assets', 'index.html', 'sw.js', 'uploads', 'release-manifest.json'];
  const staticWritten = copyDirAdditive(dist, root, {
    exclude: staticExclude,
    dryRun
  });
  log.push({ phase: 'static-without-shell', files: staticWritten.length, dryRun });

  // Phase 3: shell last
  const shellWritten = copyDirAdditive(dist, root, {
    include: ['index.html', 'sw.js'],
    dryRun
  });
  log.push({ phase: 'shell-last', files: shellWritten.length, dryRun });

  // Phase 4: manifest
  const manifestSrc = path.join(dist, 'release-manifest.json');
  if (fs.existsSync(manifestSrc)) {
    if (!dryRun) {
      fs.copyFileSync(manifestSrc, path.join(root, 'release-manifest.json'));
    }
    log.push({ phase: 'release-manifest', files: 1, dryRun });
  }

  return { log, assetsWritten, staticWritten, shellWritten };
}

// ---------------------------------------------------------------------------
// Remote rsync helpers (optional, not canonical production)
// ---------------------------------------------------------------------------

/**
 * Build rsync phases for remote deploy.
 * Phase 1: assets (additive, never --delete)
 * Phase 2: static files excluding shell + assets
 * Phase 3: index.html + sw.js last
 */
export function buildRemoteRsyncPhases({ distDir, remoteRoot }) {
  const dist = path.resolve(distDir);
  const remote = remoteRoot.replace(/\/$/, '');

  return [
    {
      name: 'assets-additive',
      source: path.join(dist, 'assets'),
      destination: `${remote}/assets`,
      delete: false,
      excludes: []
    },
    {
      name: 'static-without-shell',
      source: `${dist}/`,
      destination: `${remote}/`,
      delete: false,
      excludes: ['assets', 'index.html', 'sw.js', 'uploads']
    },
    {
      name: 'shell-last',
      source: dist,
      destination: remote,
      delete: false,
      includes: ['index.html', 'sw.js']
    }
  ];
}

export function buildRsyncCommand(phase, { dryRun = false } = {}) {
  const args = ['rsync', '-av'];
  if (dryRun) args.push('--dry-run');
  if (phase.delete) args.push('--delete');

  for (const exclude of phase.excludes || []) {
    args.push(`--exclude=${exclude}`);
  }

  if (phase.includes?.length) {
    for (const include of phase.includes) {
      args.push(`--include=${include}`);
    }
    args.push('--exclude=*');
  }

  const source = phase.source.endsWith('/') ? phase.source : `${phase.source}/`;
  args.push(source, phase.destination);
  return args.join(' ');
}
