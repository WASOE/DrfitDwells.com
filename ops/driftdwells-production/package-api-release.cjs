#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function packageRelease(ref, output) {
  const git = args => execFileSync('git', args, { maxBuffer: 32 * 1024 * 1024 });
  const sha = git(['rev-parse', '--verify', `${ref}^{commit}`]).toString().trim();
  const paths = ['server', 'shared', 'ops', 'ecosystem.config.cjs'];
  const entries = git(['ls-tree', '-rz', sha, '--', ...paths]).toString().split('\0').filter(Boolean);
  const files = entries.map(entry => {
    const [header, filename] = entry.split('\t');
    const [mode, type, hash] = header.split(' ');
    if (type !== 'blob' || !['100644', '100755'].includes(mode)) {
      throw new Error('Release contains an unsupported non-file entry');
    }
    return { path: filename, hash, mode };
  });
  if (!files.some(file => file.path.startsWith('shared/'))) throw new Error('Missing shared runtime');
  const manifest = { sha, files };
  fs.mkdirSync(output, { recursive: true });
  const archive = path.resolve(output, `driftdwells-${sha}.tar.gz`);
  git(['archive', '--format=tar.gz', `--output=${archive}`, sha, '--', ...paths]);
  fs.writeFileSync(archive + '.manifest.json', JSON.stringify(manifest));
  return { sha, archive, manifest: archive + '.manifest.json', fileCount: files.length };
}

if (require.main === module) {
  try {
    const [ref, output] = process.argv.slice(2);
    if (!ref || !output || process.argv.length !== 4) throw new Error('Usage: package-api-release.cjs <commit> <output-directory>');
    console.log(JSON.stringify(packageRelease(ref, output)));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
module.exports = { packageRelease };
