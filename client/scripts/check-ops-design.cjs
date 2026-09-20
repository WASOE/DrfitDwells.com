/* eslint-env node */
'use strict';

/**
 * Ops design-language guard (P0E).
 * Scans client/src/ops plus explicit migrated production files in MIGRATED_OPS_FILES.
 * Does not scan the rest of client/src/pages/ops.
 *
 * ENFORCED NOW (narrow, deterministic):
 * - raw hex outside token sources
 * - Playfair Display / Tailwind font-serif|heading|script as styling
 * - window.confirm / alert / prompt and those globals as calls
 * - narrow arbitrary Tailwind visual values (px/rem extras, hex classes, z-[digits])
 * - overlay libraries / createPortal outside opsOverlay.js
 *
 * NOT ENFORCED HERE (documented, later):
 * - axe accessibility
 * - full legacy pages/ops tree
 * - every possible status map shape
 * - every position:fixed overlay
 * - env()/calc() arbitrary values (allowed; not a visual token substitute)
 */

const fs = require('fs');
const path = require('path');

const CLIENT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ROOT = path.resolve(__dirname, '../src/ops');

/** Production files migrated onto the Ops design language. Append per batch. */
const MIGRATED_OPS_FILES = [
  'src/pages/ops/OpsGiftVouchers.jsx',
  'src/pages/ops/OpsGiftVouchers.css',
  'src/pages/ops/OpsGiftVoucherDetail.jsx',
  'src/pages/ops/OpsGiftVoucherDetail.css',
  'src/pages/ops/OpsPromoCodes.jsx',
  'src/pages/ops/OpsPromoCodes.css'
];

const HEX_ALLOWLIST = new Set(['ops.css', 'tokens/opsTokenNames.js']);
const CREATE_PORTAL_ALLOWLIST = new Set(['primitives/opsOverlay.js']);

const SCAN_EXTENSIONS = new Set(['.js', '.jsx', '.css']);

const RULES = {
  HEX: 'ops-hex',
  TYPE: 'ops-typography',
  DIALOG: 'ops-browser-dialog',
  ARBITRARY: 'ops-arbitrary-tailwind',
  OVERLAY: 'ops-overlay'
};

function toPosix(rel) {
  return rel.split(path.sep).join('/');
}

function isTestFile(relPosix) {
  return /\.test\.(js|jsx)$/.test(relPosix);
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === 'coverage') continue;
      walk(full, files);
      continue;
    }
    if (SCAN_EXTENSIONS.has(path.extname(ent.name))) files.push(full);
  }
  return files;
}

function stripLineComment(line) {
  let inSingle = false;
  let inDouble = false;
  let inTick = false;
  for (let i = 0; i < line.length - 1; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === "'" && !inDouble && !inTick) inSingle = !inSingle;
    else if (ch === '"' && !inSingle && !inTick) inDouble = !inDouble;
    else if (ch === '`' && !inSingle && !inDouble) inTick = !inTick;
    else if (ch === '/' && next === '/' && !inSingle && !inDouble && !inTick) {
      if (line.slice(Math.max(0, i - 6), i).includes('://')) continue;
      return line.slice(0, i);
    }
  }
  return line;
}

function isCommentOnlyLine(trimmed) {
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*/')
  );
}

const HEX_RE = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const TYPE_FONT_RE = /Playfair\s+Display/;
const TYPE_CLASS_RE = /(?:^|[\s"'`])font-(?:serif|heading|script)(?:[\s"'`]|$)/;
const DIALOG_RES = [
  { re: /window\s*\.\s*confirm\s*\(/, name: 'window.confirm' },
  { re: /window\s*\.\s*alert\s*\(/, name: 'window.alert' },
  { re: /window\s*\.\s*prompt\s*\(/, name: 'window.prompt' },
  { re: /(?:^|[^\w.])confirm\s*\(/, name: 'confirm(' },
  { re: /(?:^|[^\w.])alert\s*\(/, name: 'alert(' },
  { re: /(?:^|[^\w.])prompt\s*\(/, name: 'prompt(' }
];
const ARBITRARY_RES = [
  {
    re: /(?:^|[\s"'`])(?:p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|inset|top|right|bottom|left|rounded(?:-[trbl]{1,2})?)-\[\d+(?:px|rem)\]/,
    name: 'arbitrary spacing/radius'
  },
  { re: /(?:^|[\s"'`])(?:text|bg|border|from|to|via)-\[#/, name: 'arbitrary hex color class' },
  { re: /(?:^|[\s"'`])z-\[[0-9]+\]/, name: 'arbitrary z-index' }
];
const OVERLAY_IMPORT_RES = [
  /from\s+['"]framer-motion['"]/,
  /from\s+['"]@radix-ui\//,
  /from\s+['"]@headlessui\//,
  /from\s+['"]@floating-ui\//,
  /require\(\s*['"]framer-motion['"]\s*\)/,
  /require\(\s*['"]@radix-ui\//
];

function scanFile(absPath, relPosix) {
  const violations = [];
  const raw = fs.readFileSync(absPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const hexAllowed = HEX_ALLOWLIST.has(relPosix);
  const portalAllowed = CREATE_PORTAL_ALLOWLIST.has(relPosix);

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const trimmed = line.trim();
    if (!trimmed || isCommentOnlyLine(trimmed)) return;
    const code = stripLineComment(line);

    if (!hexAllowed && HEX_RE.test(code)) {
      violations.push({
        file: relPosix,
        line: lineNo,
        rule: RULES.HEX,
        message: 'raw hex color outside token source (client/src/ops/ops.css)'
      });
    }

    if (TYPE_FONT_RE.test(code)) {
      violations.push({
        file: relPosix,
        line: lineNo,
        rule: RULES.TYPE,
        message: 'Playfair Display is forbidden in the Ops design island'
      });
    }

    if (TYPE_CLASS_RE.test(code) && relPosix !== 'ops.css') {
      violations.push({
        file: relPosix,
        line: lineNo,
        rule: RULES.TYPE,
        message: 'font-serif / font-heading / font-script styling is forbidden in new Ops UI'
      });
    }

    for (const dialog of DIALOG_RES) {
      if (dialog.re.test(code)) {
        violations.push({
          file: relPosix,
          line: lineNo,
          rule: RULES.DIALOG,
          message: `browser dialog ${dialog.name} is forbidden; use OpsConfirmDialog`
        });
      }
    }

    for (const arb of ARBITRARY_RES) {
      if (arb.re.test(code)) {
        violations.push({
          file: relPosix,
          line: lineNo,
          rule: RULES.ARBITRARY,
          message: `forbidden ${arb.name}`
        });
      }
    }

    if (!portalAllowed && /createPortal\s*\(/.test(code)) {
      violations.push({
        file: relPosix,
        line: lineNo,
        rule: RULES.OVERLAY,
        message: 'createPortal is limited to client/src/ops/primitives/opsOverlay.js'
      });
    }

    for (const overlayRe of OVERLAY_IMPORT_RES) {
      if (overlayRe.test(code)) {
        violations.push({
          file: relPosix,
          line: lineNo,
          rule: RULES.OVERLAY,
          message: 'overlay/animation libraries are forbidden in the Ops design island'
        });
      }
    }
  });

  return violations;
}

function scanDirectory(root = DEFAULT_ROOT, options = {}) {
  const ignoreTests = options.ignoreTests !== false;
  const files = walk(root);
  const violations = [];
  const scanned = [];

  for (const abs of files) {
    const relPosix = toPosix(path.relative(root, abs));
    if (ignoreTests && isTestFile(relPosix)) continue;
    scanned.push(relPosix);
    violations.push(...scanFile(abs, relPosix));
  }

  return { root, scanned, violations };
}

function scanMigratedOpsFiles(options = {}) {
  const ignoreTests = options.ignoreTests !== false;
  const scanned = [];
  const violations = [];

  for (const relPosix of MIGRATED_OPS_FILES) {
    if (ignoreTests && isTestFile(relPosix)) continue;
    scanned.push(relPosix);
    const absPath = path.join(CLIENT_ROOT, relPosix);
    if (!fs.existsSync(absPath)) {
      violations.push({
        file: relPosix,
        line: 0,
        rule: 'ops-migrated',
        message: 'listed migrated Ops file is missing'
      });
      continue;
    }
    violations.push(...scanFile(absPath, relPosix));
  }

  return { scanned, violations };
}

function scanOpsDesign(options = {}) {
  const island = scanDirectory(DEFAULT_ROOT, options);
  const migrated = scanMigratedOpsFiles(options);
  return {
    root: island.root,
    scanned: island.scanned.concat(migrated.scanned),
    violations: island.violations.concat(migrated.violations)
  };
}

function printReport({ root, scanned, violations }) {
  if (violations.length === 0) {
    console.log(
      JSON.stringify(
        {
          success: true,
          root,
          filesChecked: scanned.length,
          violations: 0
        },
        null,
        2
      )
    );
    return;
  }

  console.error(`OPS design guard failed (${violations.length})`);
  for (const item of violations) {
    console.error(`  ${item.file}:${item.line}  ${item.rule}  ${item.message}`);
  }
}

function main(argv = process.argv.slice(2)) {
  const rootFlag = argv.find((arg) => arg.startsWith('--root='));
  const includeTests = argv.includes('--include-tests');
  const result = rootFlag
    ? scanDirectory(path.resolve(rootFlag.slice('--root='.length)), { ignoreTests: !includeTests })
    : scanOpsDesign({ ignoreTests: !includeTests });
  printReport(result);
  process.exitCode = result.violations.length === 0 ? 0 : 1;
  return result;
}

if (require.main === module) {
  main();
}

module.exports = {
  RULES,
  HEX_ALLOWLIST,
  DEFAULT_ROOT,
  MIGRATED_OPS_FILES,
  scanDirectory,
  scanMigratedOpsFiles,
  scanOpsDesign,
  scanFile,
  main
};
