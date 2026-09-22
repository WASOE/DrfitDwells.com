import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import OpsSurface, {
  OpsSurfaceDescription,
  OpsSurfaceHeader,
  OpsSurfaceTitle
} from './OpsSurface';

describe('OpsSurface', () => {
  it('composes canonical surface structure with feature classes', () => {
    render(
      <OpsSurface className="feature-surface" aria-labelledby="surface-title">
        <OpsSurfaceHeader className="feature-head">
          <OpsSurfaceTitle id="surface-title" className="feature-title">
            Payment summary
          </OpsSurfaceTitle>
        </OpsSurfaceHeader>
        <OpsSurfaceDescription>Read-only evidence.</OpsSurfaceDescription>
      </OpsSurface>
    );

    const title = screen.getByRole('heading', { name: 'Payment summary' });
    expect(title.classList.contains('ops-surface__title')).toBe(true);
    expect(title.classList.contains('feature-title')).toBe(true);
    expect(title.closest('section').classList.contains('ops-surface')).toBe(true);
    expect(title.closest('section').classList.contains('feature-surface')).toBe(true);
    expect(screen.getByText('Read-only evidence.').classList.contains('ops-surface__description')).toBe(true);
  });

  it('supports semantic variants and alternate elements', () => {
    const { container } = render(
      <OpsSurface as="div" variant="plain">
        Plain content
      </OpsSurface>
    );

    expect(container.firstChild.classList.contains('ops-surface')).toBe(true);
    expect(container.firstChild.classList.contains('ops-surface--plain')).toBe(true);
    expect(container.firstChild.tagName).toBe('DIV');
  });
});
