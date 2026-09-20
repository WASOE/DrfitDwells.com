import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { RULES, scanDirectory } = require('../../scripts/check-ops-design.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPS_ROOT = path.resolve(__dirname);

let tmpDir = null;

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe('ops design guard', () => {
  it('passes the current Ops design island', () => {
    const result = scanDirectory(OPS_ROOT);
    expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
    expect(result.scanned.length).toBeGreaterThan(0);
  });

  it('detects raw hex, Playfair, browser confirm, and arbitrary Tailwind', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-design-guard-'));
    fs.writeFileSync(path.join(tmpDir, 'hex.jsx'), 'export const bad = { color: "#123456" };\n');
    fs.writeFileSync(
      path.join(tmpDir, 'type.jsx'),
      'export function Type() { return <p className="font-serif">Playfair Display</p>; }\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'dialog.jsx'),
      'export function ask() { return window.confirm("Delete stay?"); }\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'tailwind.jsx'),
      'export function Box() { return <div className="p-[13px] rounded-[7px] text-[#123456] z-[9999]" />; }\n'
    );

    const result = scanDirectory(tmpDir, { ignoreTests: false });
    const rules = result.violations.map((item) => item.rule);

    expect(rules).toContain(RULES.HEX);
    expect(rules).toContain(RULES.TYPE);
    expect(rules).toContain(RULES.DIALOG);
    expect(rules).toContain(RULES.ARBITRARY);
    expect(result.violations.some((item) => item.file === 'hex.jsx' && item.line === 1)).toBe(true);
    expect(result.violations.some((item) => item.file === 'dialog.jsx' && item.message.includes('window.confirm'))).toBe(
      true
    );
  });
});
