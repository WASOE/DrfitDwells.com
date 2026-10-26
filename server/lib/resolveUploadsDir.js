'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_SHARED_UPLOADS = '/home/illoc/shared/driftdwells-uploads';

function uploadsPathMissing(target) {
  try {
    fs.lstatSync(target);
    return false;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
}

function isRealDirectory(target) {
  try {
    const stat = fs.lstatSync(target);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Choose the directory Express serves at /uploads.
 * An explicit UPLOADS_DIR is used as-is, so development stays off the
 * production store. Otherwise an existing local directory is kept. A missing
 * local directory becomes a symlink to the production store when that store
 * exists, and a private directory otherwise.
 */
function resolveUploadsDir({
  localDir,
  envDir = process.env.UPLOADS_DIR,
  sharedDir = DEFAULT_SHARED_UPLOADS
} = {}) {
  if (!localDir) throw new Error('local uploads directory is required');
  if (envDir && String(envDir).trim()) {
    const configured = path.resolve(String(envDir));
    if (uploadsPathMissing(configured)) fs.mkdirSync(configured, { recursive: true });
    return configured;
  }
  if (!uploadsPathMissing(localDir)) return localDir;
  if (isRealDirectory(sharedDir)) {
    fs.symlinkSync(sharedDir, localDir);
    return localDir;
  }
  fs.mkdirSync(localDir, { recursive: true });
  return localDir;
}

module.exports = {
  DEFAULT_SHARED_UPLOADS,
  resolveUploadsDir
};
