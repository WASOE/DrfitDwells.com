import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpsPage, { OPS_PAGE_MAX_WIDTHS, OPS_PAGE_WIDTHS, resolveOpsPageWidth } from './OpsPage';

afterEach(() => {
  cleanup();
});

const here = path.dirname(fileURLToPath(import.meta.url));
const primitivesCss = fs.readFileSync(path.resolve(here, 'opsPrimitives.css'), 'utf8');
const opsCss = fs.readFileSync(path.resolve(here, '../ops.css'), 'utf8');
const shellCss = fs.readFileSync(path.resolve(here, '../../layouts/ops/opsShell.css'), 'utf8');
const layoutSrc = fs.readFileSync(path.resolve(here, '../../layouts/OpsLayout.jsx'), 'utf8');

describe('resolveOpsPageWidth', () => {
  it('keeps the four locked widths and defaults invalid values', () => {
    expect(OPS_PAGE_WIDTHS).toEqual(['narrow', 'default', 'wide', 'full']);
    expect(resolveOpsPageWidth(undefined)).toBe('default');
    expect(resolveOpsPageWidth('narrow')).toBe('narrow');
    expect(resolveOpsPageWidth('default')).toBe('default');
    expect(resolveOpsPageWidth('wide')).toBe('wide');
    expect(resolveOpsPageWidth('full')).toBe('full');
    expect(resolveOpsPageWidth('huge')).toBe('default');
    expect(resolveOpsPageWidth('')).toBe('default');
  });
});

describe('OpsPage', () => {
  it('defaults to the default width and renders children', () => {
    render(
      <OpsPage>
        <p>Stay list</p>
      </OpsPage>
    );
    const page = screen.getByTestId('ops-page');
    expect(page).toHaveAttribute('data-ops-page-width', 'default');
    expect(page).toHaveClass('ops-page');
    expect(page).toHaveClass('ops-page--default');
    expect(screen.getByText('Stay list')).toBeInTheDocument();
  });

  it.each(OPS_PAGE_WIDTHS)('applies the %s width variant', (width) => {
    render(<OpsPage width={width}>Body</OpsPage>);
    const page = screen.getByTestId('ops-page');
    expect(page).toHaveAttribute('data-ops-page-width', width);
    expect(page).toHaveClass(`ops-page--${width}`);
  });

  it('falls back to default for an invalid width', () => {
    render(<OpsPage width="sidebar">Body</OpsPage>);
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'default');
    expect(screen.getByTestId('ops-page')).toHaveClass('ops-page--default');
  });

  it('keeps extra className from replacing canonical width classes', () => {
    render(
      <OpsPage width="wide" className="extra-slot ops-page--full max-w-none w-screen">
        Body
      </OpsPage>
    );
    const page = screen.getByTestId('ops-page');
    expect(page).toHaveClass('extra-slot');
    expect(page).toHaveClass('ops-page');
    expect(page).toHaveClass('ops-page--wide');
    expect(page).not.toHaveClass('ops-page--full');
    expect(page).not.toHaveClass('max-w-none');
    expect(page).not.toHaveClass('w-screen');
    expect(page).toHaveAttribute('data-ops-page-width', 'wide');
  });
});

describe('OpsPage CSS architecture', () => {
  it('uses locked 720 / 1040 / 1360 / none max-widths from tokens', () => {
    expect(opsCss).toMatch(/--ops-page-w-narrow:\s*720px/);
    expect(opsCss).toMatch(/--ops-page-w-default:\s*1040px/);
    expect(opsCss).toMatch(/--ops-page-w-wide:\s*1360px/);
    expect(OPS_PAGE_MAX_WIDTHS).toEqual({
      narrow: '720px',
      default: '1040px',
      wide: '1360px',
      full: 'none'
    });
    expect(primitivesCss).toMatch(/\.ops-page--narrow\s*\{[^}]*max-width:\s*var\(--ops-page-w-narrow\)/);
    expect(primitivesCss).toMatch(/\.ops-page--default\s*\{[^}]*max-width:\s*var\(--ops-page-w-default\)/);
    expect(primitivesCss).toMatch(/\.ops-page--wide\s*\{[^}]*max-width:\s*var\(--ops-page-w-wide\)/);
    expect(primitivesCss).toMatch(/\.ops-page--full\s*\{[^}]*max-width:\s*none/);
    expect(primitivesCss).not.toMatch(/100vw/);
    expect(primitivesCss).toMatch(/container-type:\s*inline-size/);
    expect(primitivesCss).toMatch(/container-name:\s*ops-page/);
    expect(shellCss).toMatch(/\.ops-shell-main\s*\{[^}]*min-width:\s*0/);
    expect(shellCss).toMatch(/\.ops-main--owned\s*\{[^}]*min-width:\s*0/);
    expect(shellCss).toMatch(/\.ops-main--owned\s*\{[^}]*max-width:\s*none/);
    expect(shellCss).not.toMatch(/100vw/);
    expect(layoutSrc).toContain('useOpsPageOwnsWidth');
    expect(layoutSrc).not.toMatch(/widthByPath|PAGE_WIDTH_BY_|pathname.*ops-page--/);
  });
});
