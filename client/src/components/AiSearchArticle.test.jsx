import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import AiSearchArticle from './AiSearchArticle';
import { editorial, contentSources, parseEditorial, editorialPhotos } from '../content/ai-search';

const state = vi.hoisted(() => ({ language: 'en', openModal: vi.fn() }));
vi.mock('../hooks/useSiteLanguage', () => ({ useSiteLanguage: () => ({ language: state.language }) }));
vi.mock('../context/BookingSearchContext', () => ({ useBookingSearch: () => ({ openModal: state.openModal }) }));

afterEach(() => { cleanup(); state.openModal.mockClear(); });

describe('approved AI Search copy integration', () => {
  for (const kind of Object.keys(editorial)) {
    for (const language of ['en', 'bg']) {
      it(`renders the complete ${kind}/${language} draft with localized CTAs and content-backed schemas`, () => {
        state.language = language;
        const copy = editorial[kind][language];
        const { container } = render(
          <MemoryRouter><HelmetProvider><AiSearchArticle kind={kind} /></HelmetProvider></MemoryRouter>
        );
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(copy.heading);
        expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(copy.blocks.filter((block) => block.type === 'h2').length);
        expect(container.textContent).not.toMatch(/CONTENT SOURCE|Internal link:|Вътрешна връзка:|existing contact form|съществуващата форма|CTA:/);
        const expectedPhotoCount = editorialPhotos[kind].length;
        expect(screen.getAllByRole('img')).toHaveLength(expectedPhotoCount);
        for (const image of screen.getAllByRole('img')) {
          expect(image.getAttribute('src')).toMatch(/^\/media\//);
          expect(image.getAttribute('alt').length).toBeGreaterThan(10);
          expect(Number(image.getAttribute('height'))).toBeGreaterThan(0);
        }
        for (const link of screen.getAllByRole('link')) {
          const target = link.getAttribute('href');
          if (target.startsWith('/')) {
            expect(target.endsWith('/')).toBe(true);
            expect(target.startsWith('/bg/')).toBe(language === 'bg');
          }
        }
        const schemas = [...container.querySelectorAll('script[type="application/ld+json"]')].map((node) => JSON.parse(node.textContent));
        expect(schemas.map((node) => node['@type'])).toEqual(['WebPage', 'BreadcrumbList']);
        expect(schemas[0].inLanguage).toBe(language);
        expect(schemas[0].about.every((node) => node['@id'].endsWith('/#lodging'))).toBe(true);
        expect(JSON.stringify(schemas)).not.toMatch(/"Event"|"Product"|"offers"|"aggregateRating"/);
        if (kind === 'corporate') {
          fireEvent.click(screen.getAllByRole('button')[0]);
          expect(state.openModal).toHaveBeenCalledOnce();
        }
        if (kind === 'detox') {
          expect(container.querySelector('a[href="https://www.nature.com/articles/s41598-025-90984-3"]')).not.toBeNull();
          expect(container.querySelector('a[href="https://doi.org/10.1016/j.ssaho.2025.101812"]')).not.toBeNull();
        }
        expect(contentSources[kind][language]).toContain(copy.heading);
      });
    }
  }
  it('rejects missing editorial metadata instead of rendering a fallback', () => {
    expect(() => parseEditorial('\n# Public heading')).toThrow(/missing SEO title/);
    expect(() => parseEditorial('no public heading')).toThrow(/public H1/);
  });
});
