import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OPS_COLOR_TOKEN_NAMES,
  OPS_DARK_COLOR_VALUES,
  OPS_LIGHT_COLOR_VALUES,
  OPS_SHARED_TOKEN_NAMES,
  OPS_SHARED_TOKEN_VALUES
} from './opsTokenNames.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPS_CSS = fs.readFileSync(path.resolve(__dirname, '../ops.css'), 'utf8');

function extractTokenBlock(css, marker) {
  const needle = `/* ${marker} */`;
  const start = css.indexOf(needle);
  if (start === -1) {
    throw new Error(`Missing token marker: ${marker}`);
  }
  const brace = css.indexOf('{', start);
  const end = css.indexOf('}', brace);
  return css.slice(brace + 1, end);
}

function parseTokenDeclarations(block) {
  const tokens = {};
  const re = /(--ops-[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let match;
  while ((match = re.exec(block))) {
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

const lightTokens = parseTokenDeclarations(extractTokenBlock(OPS_CSS, 'ops-tokens: light'));
const darkTokens = parseTokenDeclarations(extractTokenBlock(OPS_CSS, 'ops-tokens: dark'));
const sharedTokens = parseTokenDeclarations(extractTokenBlock(OPS_CSS, 'ops-tokens: shared'));

describe('Ops token completeness (P0A)', () => {
  it('lists the same color token names in JS, light CSS, and dark CSS', () => {
    expect(Object.keys(OPS_LIGHT_COLOR_VALUES)).toEqual(OPS_COLOR_TOKEN_NAMES);
    expect(Object.keys(OPS_DARK_COLOR_VALUES)).toEqual(OPS_COLOR_TOKEN_NAMES);
    expect(Object.keys(lightTokens).sort()).toEqual([...OPS_COLOR_TOKEN_NAMES].sort());
    expect(Object.keys(darkTokens).sort()).toEqual([...OPS_COLOR_TOKEN_NAMES].sort());
  });

  it('has no light-only or dark-only color tokens and includes --ops-accent-fg', () => {
    expect(OPS_COLOR_TOKEN_NAMES).toContain('--ops-accent-fg');
    const lightOnly = Object.keys(lightTokens).filter((name) => darkTokens[name] == null);
    const darkOnly = Object.keys(darkTokens).filter((name) => lightTokens[name] == null);
    expect(lightOnly).toEqual([]);
    expect(darkOnly).toEqual([]);
    expect(lightTokens['--ops-accent-fg']).toBe('#FFFFFF');
    expect(darkTokens['--ops-accent-fg']).toBe('#171A17');
  });

  it('matches locked light color values exactly', () => {
    for (const name of OPS_COLOR_TOKEN_NAMES) {
      expect(lightTokens[name], name).toBe(OPS_LIGHT_COLOR_VALUES[name]);
    }
  });

  it('matches locked dark color values exactly', () => {
    for (const name of OPS_COLOR_TOKEN_NAMES) {
      expect(darkTokens[name], name).toBe(OPS_DARK_COLOR_VALUES[name]);
    }
  });

  it('matches locked shared non-color token values exactly', () => {
    expect(Object.keys(sharedTokens).sort()).toEqual([...OPS_SHARED_TOKEN_NAMES].sort());
    for (const name of OPS_SHARED_TOKEN_NAMES) {
      expect(sharedTokens[name], name).toBe(OPS_SHARED_TOKEN_VALUES[name]);
    }
  });

  it('does not redefine --ops-control-h under pointer: coarse', () => {
    const coarse = OPS_CSS.match(/@media\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\}/);
    if (coarse) {
      expect(coarse[0]).not.toMatch(/--ops-control-h\s*:/);
    }
    expect(sharedTokens['--ops-control-h']).toBe('36px');
    expect(sharedTokens['--ops-control-h-touch']).toBe('44px');
  });

  it('does not invent hold/blocked semantic tokens', () => {
    expect(OPS_CSS).not.toMatch(/--ops-hold\b/);
    expect(OPS_CSS).not.toMatch(/--ops-blocked\b/);
  });

  it('defines calendar spatial category tokens for light and dark appearances', () => {
    const required = [
      '--ops-calendar-reservation',
      '--ops-calendar-reservation-soft',
      '--ops-calendar-reservation-border',
      '--ops-calendar-manual',
      '--ops-calendar-manual-soft',
      '--ops-calendar-manual-border',
      '--ops-calendar-maintenance',
      '--ops-calendar-maintenance-soft',
      '--ops-calendar-maintenance-border',
      '--ops-calendar-external',
      '--ops-calendar-external-soft',
      '--ops-calendar-external-border',
      '--ops-calendar-conflict',
      '--ops-calendar-warning'
    ];
    for (const name of required) {
      const re = new RegExp(`${name}\\s*:`);
      expect(OPS_CSS.match(new RegExp(re, 'g'))?.length || 0, name).toBeGreaterThanOrEqual(2);
    }
  });

  it('applies color-scheme only on themed surfaces', () => {
    expect(OPS_CSS).toMatch(
      /\.ops-root\[data-ops-themed="true"\]\[data-ops-appearance="dark"\][\s\S]*?color-scheme:\s*dark/
    );
    expect(OPS_CSS).toMatch(
      /\.ops-root\[data-ops-themed="true"\]\[data-ops-appearance="light"\][\s\S]*?color-scheme:\s*light/
    );
    const unthemedRoot = OPS_CSS.match(/^\.ops-root\s*\{[\s\S]*?\}/m);
    expect(unthemedRoot?.[0] || '').not.toMatch(/color-scheme/);
    expect(unthemedRoot?.[0] || '').not.toMatch(/background-color:\s*var\(--ops-canvas\)/);
  });
});
