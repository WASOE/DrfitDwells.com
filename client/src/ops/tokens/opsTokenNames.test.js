import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OPS_COLOR_TOKEN_NAMES,
  OPS_DARK_COLOR_VALUES,
  OPS_FORBIDDEN_STRUCTURAL_GREEN_HEX,
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
    expect(darkTokens['--ops-accent-fg']).toBe('#1D1D1F');
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

  it('keeps structural foundation neutral (no sage/green chrome)', () => {
    const structural = [
      '--ops-canvas',
      '--ops-sidebar',
      '--ops-topbar',
      '--ops-surface',
      '--ops-surface-subtle',
      '--ops-surface-elevated',
      '--ops-border',
      '--ops-border-strong',
      '--ops-border-control',
      '--ops-text',
      '--ops-text-secondary',
      '--ops-text-muted',
      '--ops-text-disabled',
      '--ops-accent',
      '--ops-accent-hover',
      '--ops-accent-soft',
      '--ops-accent-border',
      '--ops-accent-fg',
      '--ops-focus',
      '--ops-scrim'
    ];
    for (const name of structural) {
      const light = lightTokens[name].toUpperCase();
      const dark = darkTokens[name].toUpperCase();
      for (const banned of OPS_FORBIDDEN_STRUCTURAL_GREEN_HEX) {
        expect(light, `${name} light`).not.toBe(banned.toUpperCase());
        expect(dark, `${name} dark`).not.toBe(banned.toUpperCase());
      }
    }
    expect(lightTokens['--ops-canvas']).toBe('#F5F5F7');
    expect(darkTokens['--ops-canvas']).toBe('#171717');
    expect(lightTokens['--ops-accent']).toBe('#2C2C2E');
    expect(darkTokens['--ops-accent']).toBe('#F5F5F7');
    expect(lightTokens['--ops-focus']).toBe('#0071E3');
    expect(darkTokens['--ops-focus']).toBe('#0A84FF');
  });

  it('preserves semantic success/warning/danger/info greens and ambers', () => {
    expect(lightTokens['--ops-success']).toBe('#1F7A4D');
    expect(darkTokens['--ops-success']).toBe('#5AC58A');
    expect(lightTokens['--ops-warning']).toBe('#9A5B00');
    expect(darkTokens['--ops-warning']).toBe('#E5A94F');
    expect(lightTokens['--ops-danger']).toBe('#B42318');
    expect(darkTokens['--ops-danger']).toBe('#F27A72');
    expect(lightTokens['--ops-info']).toBe('#175CD3');
    expect(darkTokens['--ops-info']).toBe('#6FA9FF');
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

  it('defines work-windows spatial span tokens for light and dark appearances', () => {
    const required = [
      '--ops-work-free',
      '--ops-work-free-soft',
      '--ops-work-free-border',
      '--ops-work-turnaround',
      '--ops-work-turnaround-soft',
      '--ops-work-turnaround-border',
      '--ops-work-occupied',
      '--ops-work-occupied-soft',
      '--ops-work-occupied-border',
      '--ops-work-blocked',
      '--ops-work-blocked-soft',
      '--ops-work-blocked-border',
      '--ops-work-today',
      '--ops-work-today-fg'
    ];
    for (const name of required) {
      const re = new RegExp(`${name}\\s*:`);
      expect(OPS_CSS.match(new RegExp(re, 'g'))?.length || 0, name).toBeGreaterThanOrEqual(2);
    }
  });

  it('paints light and dark canvas on Ops roots', () => {
    expect(OPS_CSS).toMatch(
      /\.ops-root\[data-ops-appearance="light"\][\s\S]*?background-color:\s*var\(--ops-canvas\)/
    );
    expect(OPS_CSS).toMatch(
      /\.ops-root\[data-ops-appearance="light"\][\s\S]*?color-scheme:\s*light/
    );
    expect(OPS_CSS).toMatch(
      /\.ops-root\[data-ops-appearance="dark"\][\s\S]*?background-color:\s*var\(--ops-canvas\)/
    );
    expect(OPS_CSS).toMatch(
      /\.ops-root\[data-ops-appearance="dark"\][\s\S]*?color-scheme:\s*dark/
    );
    const unthemedRoot = OPS_CSS.match(/^\.ops-root\s*\{[\s\S]*?\}/m);
    expect(unthemedRoot?.[0] || '').not.toMatch(/color-scheme/);
    expect(unthemedRoot?.[0] || '').not.toMatch(/background-color:\s*var\(--ops-canvas\)/);
  });
});
