import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpsFilterBar from './OpsFilterBar';
import OpsSelect from './OpsSelect';
import OpsTextField from './OpsTextField';
import OpsButton from './OpsButton';

afterEach(() => {
  cleanup();
});

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'OpsFilterBar.jsx'), 'utf8');
const css = fs.readFileSync(path.join(here, 'opsPrimitives.css'), 'utf8');

describe('OpsFilterBar', () => {
  it('renders composed children without requiring footer', () => {
    render(
      <OpsFilterBar>
        <OpsSelect label="Status">
          <option value="">All</option>
          <option value="open">Open</option>
        </OpsSelect>
        <OpsTextField className="ops-filter-bar__search" label="Find" />
      </OpsFilterBar>
    );
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Find')).toBeInTheDocument();
    expect(document.querySelector('.ops-filter-bar__footer')).toBeNull();
  });

  it('renders an optional footer slot when supplied', () => {
    render(
      <OpsFilterBar footer={<OpsButton variant="quiet">Reset filters</OpsButton>}>
        <OpsTextField label="Find" />
      </OpsFilterBar>
    );
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeInTheDocument();
    expect(document.querySelector('.ops-filter-bar__footer')).toBeTruthy();
  });

  it('merges className onto the structural wrapper', () => {
    const { container } = render(
      <OpsFilterBar className="extra-slot">
        <span>Controls</span>
      </OpsFilterBar>
    );
    const root = container.querySelector('[data-ops-filter-bar]');
    expect(root).toHaveClass('ops-filter-bar');
    expect(root).toHaveClass('extra-slot');
  });

  it('supports a semantic form wrapper', () => {
    render(
      <OpsFilterBar as="form" aria-label="Filters">
        <OpsTextField label="Find" />
      </OpsFilterBar>
    );
    expect(screen.getByRole('form', { name: 'Filters' })).toHaveClass('ops-filter-bar');
  });

  it('is layout-only and does not force filter controls to compact height', () => {
    expect(source).not.toMatch(/opsBucket|reservationStatus|useSearchParams|opsReadAPI|paymentStatus/);
    expect(source).not.toMatch(/react-router/);
    expect(css).toMatch(/\.ops-filter-bar\s*\{/);
    expect(css).toMatch(/\.ops-filter-bar__search/);
    expect(css).not.toMatch(
      /@media \(pointer:\s*fine\)[\s\S]*\.ops-filter-bar[\s\S]*--ops-control-h-compact/
    );
    expect(css).toMatch(/\.ops-button--compact[\s\S]*height:\s*var\(--ops-control-h-compact\)/);
    expect(css).toMatch(
      /@media \(pointer:\s*coarse\)[\s\S]*\.ops-select[\s\S]*--ops-control-h-touch/
    );
  });
});
