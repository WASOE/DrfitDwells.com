import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ValleyHeroStayList from './ValleyHeroStayList';

vi.mock('../../i18n/ns/valley', () => ({}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn()
  };
});

vi.mock('../../hooks/useValleyHeroStayItems', () => ({
  default: vi.fn()
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => {
      const map = {
        'hero.selector.label': 'Pick your stay',
        'hero.selector.checkAvailability': 'Check availability'
      };
      return map[key] || key;
    },
    i18n: { language: 'en' }
  })
}));

import useValleyHeroStayItems from '../../hooks/useValleyHeroStayItems';

const baseUnit = (slug, overrides = {}) => ({
  id: slug,
  kind: 'unit',
  slug,
  titleKey: `hero.selector.stays.${slug}.title`,
  fitKey: `hero.selector.stays.${slug}.fit`,
  title: slug,
  fit: 'fit line',
  sleeps: 'Sleeps 2',
  fromPrice: 'From €60/night',
  cover: { url: `/covers/${slug}.jpg`, alt: slug },
  bookingTo: { pathname: `/stays/${slug}`, hash: '#booking' },
  ...overrides
});

const fullData = {
  units: [
    baseUnit('a-frame'),
    baseUnit('lux-cabin', { fromPrice: 'From €85/night' }),
    baseUnit('stone-house', { fromPrice: 'From €25/night', sleeps: 'Sleeps 6' })
  ],
  buyout: {
    id: 'buyout',
    kind: 'buyout',
    titleKey: 'hero.selector.buyout.title',
    title: 'The whole Valley',
    bookingTo: { pathname: '/retreats/the-valley' },
    fromPriceNightly: 355,
    minNights: 2,
    totalSleeps: 12,
    fromPriceLabel: 'from €355/night, 2-night minimum'
  },
  listings: { status: 'loaded', error: null },
  covers: { status: 'loaded', error: null },
  buyoutInventory: { status: 'loaded', error: null }
};

function renderList(data = fullData) {
  useValleyHeroStayItems.mockReturnValue(data);
  return render(
    <MemoryRouter>
      <ValleyHeroStayList />
    </MemoryRouter>
  );
}

describe('ValleyHeroStayList', () => {
  beforeEach(() => {
    vi.mocked(useValleyHeroStayItems).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders label, three unit rows, and promoted buyout row with full data', () => {
    renderList();

    expect(screen.getByText('Pick your stay')).toBeInTheDocument();
    expect(screen.getByText('a-frame')).toBeInTheDocument();
    expect(screen.getByText('lux-cabin')).toBeInTheDocument();
    expect(screen.getByText('stone-house')).toBeInTheDocument();
    expect(screen.getByText('The whole Valley')).toBeInTheDocument();
    expect(screen.getByText('from €355/night, 2-night minimum')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Check availability' })).toHaveLength(3);
    const buyoutLink = screen.getByRole('link', { href: '/retreats/the-valley' });
    expect(buyoutLink).toHaveTextContent('The whole Valley');
  });

  it('shows four skeleton rows while loading', () => {
    renderList({
      ...fullData,
      listings: { status: 'loading', error: null },
      buyoutInventory: { status: 'loading', error: null }
    });

    expect(screen.getByTestId('valley-hero-stay-list-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('a-frame')).not.toBeInTheDocument();
  });

  it('renders buyout row without price when inventory is degraded', () => {
    renderList({
      ...fullData,
      buyout: {
        ...fullData.buyout,
        fromPriceNightly: null,
        minNights: null,
        totalSleeps: null,
        fromPriceLabel: null
      },
      buyoutInventory: { status: 'error', error: 'inventory unavailable' }
    });

    expect(screen.getByText('The whole Valley')).toBeInTheDocument();
    expect(screen.queryByText('from €355/night, 2-night minimum')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { href: '/retreats/the-valley' })).toBeInTheDocument();
  });

  it('renders unit rows without price when listing price is missing', () => {
    renderList({
      ...fullData,
      units: fullData.units.map((unit, index) =>
        index === 2 ? { ...unit, fromPrice: null } : unit
      )
    });

    expect(screen.getByText('stone-house')).toBeInTheDocument();
    expect(screen.getByText('Sleeps 6')).toBeInTheDocument();
    expect(screen.queryByText('From €25/night')).not.toBeInTheDocument();
  });

  it('renders unit rows when covers are missing', () => {
    renderList({
      ...fullData,
      units: fullData.units.map((unit) => ({ ...unit, cover: null })),
      covers: { status: 'error', error: 'covers failed' }
    });

    expect(screen.getByText('a-frame')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Check availability' })).toHaveLength(3);
  });
});
