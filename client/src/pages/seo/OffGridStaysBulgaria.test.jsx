import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import OffGridStaysBulgaria from './OffGridStaysBulgaria';
import en from '../../i18n/locales/en/seo.json';
import bg from '../../i18n/locales/bg/seo.json';

const state = vi.hoisted(() => ({ language: 'en', slides: {} }));
vi.mock('../../hooks/useSiteLanguage', () => ({ useSiteLanguage: () => ({ language: state.language }) }));
vi.mock('../../hooks/usePaidTrafficListingSlides', () => ({ usePaidTrafficListingSlides: () => ({ slidesByStayId: state.slides }) }));
vi.mock('../../context/BookingSearchContext', () => ({ useBookingSearch: () => ({ openModal: vi.fn() }) }));
vi.mock('../../i18n/ns/seo', () => ({}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key) => key.split('.').reduce((value, part) => value[part], state.language === 'bg' ? bg : en)
}) }));

afterEach(() => { cleanup(); state.slides = {}; });

describe('single editorial accommodation discovery', () => {
  for (const language of ['en', 'bg']) {
    it(`preserves full stay information and all booking destinations in ${language}`, () => {
      state.language = language;
      const copy = (language === 'bg' ? bg : en).paidStaysBulgaria;
      const { container } = render(<MemoryRouter><HelmetProvider><OffGridStaysBulgaria /></HelmetProvider></MemoryRouter>);
      expect(container.querySelectorAll('#stays')).toHaveLength(1);
      expect(container.querySelectorAll('.ai-search-hero')).toHaveLength(1);
      const cards = [...container.querySelectorAll('.ai-search-stay')];
      expect(cards).toHaveLength(4);
      const routes = ['the-cabin', 'a-frame', 'lux-cabin', 'stone-house'];
      for (const [index, card] of cards.entries()) {
        const id = ['the-cabin', 'valley-a-frame', 'valley-lux-cabin', 'valley-stone-house'][index];
        expect(within(card).getByRole('heading', { level: 3 }).textContent).toBe(copy.stays[id].title);
        expect(within(card).getByText(copy.stays[id].fitLine)).not.toBeNull();
        expect(within(card).getByText(copy.selector.stays[id].price)).not.toBeNull();
        expect(within(card).getByRole('link', { name: copy.cta.checkAvailability }).getAttribute('href'))
          .toBe(`${language === 'bg' ? '/bg' : ''}/stays/${routes[index]}#booking`);
        expect(within(card).getByRole('img').getAttribute('src')).toMatch(/^\/uploads\//);
      }
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    });
  }

  it('continues to use a resolved listing cover and its descriptive alt', () => {
    state.language = 'en';
    state.slides = { 'the-cabin': [{ url: '/uploads/current-cabin.jpeg', alt: 'The Cabin beside the forest' }] };
    render(<MemoryRouter><HelmetProvider><OffGridStaysBulgaria /></HelmetProvider></MemoryRouter>);
    expect(screen.getByAltText('The Cabin beside the forest').getAttribute('src')).toBe('/uploads/current-cabin.jpeg');
  });

  it('keeps every Explore Each Stay fallback on the listing-media namespace', () => {
    state.language = 'en';
    render(<MemoryRouter><HelmetProvider><OffGridStaysBulgaria /></HelmetProvider></MemoryRouter>);
    const images = [...document.querySelectorAll('.ai-search-stay img')];
    expect(images).toHaveLength(4);
    expect(images.every((image) => image.src.includes('/uploads/'))).toBe(true);
    expect(images.some((image) => image.src.includes('/media/seo/'))).toBe(false);
  });
});
