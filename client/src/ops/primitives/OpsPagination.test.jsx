import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpsPagination from './OpsPagination';

afterEach(() => {
  cleanup();
});

const source = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'OpsPagination.jsx'), 'utf8');
const css = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'opsPrimitives.css'), 'utf8');

describe('OpsPagination', () => {
  it('renders Previous, Next, and page context as native buttons', () => {
    render(<OpsPagination page={2} totalPages={5} onPageChange={() => {}} />);
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: 'Next' })).toHaveAttribute('type', 'button');
    expect(screen.getByText('Page 2 of 5')).toBeInTheDocument();
  });

  it('disables Previous on the first page and Next on the last page', () => {
    const { rerender } = render(<OpsPagination page={1} totalPages={4} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();

    rerender(<OpsPagination page={4} totalPages={4} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Previous' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('calls onPageChange with the adjacent page', () => {
    const onPageChange = vi.fn();
    render(<OpsPagination page={3} totalPages={6} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange.mock.calls).toEqual([[2], [4]]);
  });

  it('does not emit callbacks when disabled or loading', () => {
    const onPageChange = vi.fn();
    const { rerender } = render(
      <OpsPagination page={2} totalPages={5} disabled onPageChange={onPageChange} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).not.toHaveBeenCalled();

    rerender(<OpsPagination page={2} totalPages={5} loading onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).not.toHaveBeenCalled();
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveAttribute('aria-busy', 'true');
  });

  it('has no URL or data-source coupling and uses coarse 44px control architecture', () => {
    expect(source).not.toMatch(/react-router|useSearchParams|opsReadAPI|giftVoucher/i);
    expect(css).toMatch(/\.ops-pagination\s*\{/);
    expect(css).toMatch(/@media \(pointer:\s*coarse\)[\s\S]*\.ops-button[\s\S]*min-height:\s*var\(--ops-control-h-touch\)/);
    expect(source).not.toMatch(/100vw/);
  });
});
