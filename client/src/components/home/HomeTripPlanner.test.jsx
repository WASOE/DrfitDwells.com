import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useEffect } from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { BookingSearchProvider, useBookingSearch } from '../../context/BookingSearchContext';
import i18n from '../../i18n/i18n';
import '../../i18n/ns/home';
import HomeTripPlanner from './HomeTripPlanner';
import HomeStayComparison from './HomeStayComparison';
import HomeFaq from './HomeFaq';
import { localizePath } from '../../utils/localizedRoutes';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function GuestProbe() {
  const { adults, children, babies, pets } = useBookingSearch();
  return (
    <div data-testid="guests">
      {adults}:{children}:{babies}:{pets}
    </div>
  );
}

function SeedBooking({
  adults = 2,
  childCount = 0,
  babies = 0,
  pets = 0,
  children,
}) {
  const { updateGuests, updateDates } = useBookingSearch();
  useEffect(() => {
    updateGuests({ adults, children: childCount, babies, pets });
    updateDates(new Date(2026, 10, 12), new Date(2026, 10, 14));
  }, [adults, babies, childCount, pets, updateDates, updateGuests]);
  return children;
}

function renderWithProviders(ui, { initialPath = '/', seed } = {}) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <BookingSearchProvider>
        {seed ? (
          <SeedBooking
            adults={seed.adults}
            childCount={seed.children}
            babies={seed.babies}
            pets={seed.pets}
          >
            {ui}
          </SeedBooking>
        ) : (
          ui
        )}
        <LocationProbe />
        <GuestProbe />
      </BookingSearchProvider>
    </MemoryRouter>
  );
}

async function answer(label) {
  fireEvent.click(screen.getByRole('button', { name: label }));
  fireEvent.click(screen.getByRole('button', { name: /continue|see my match|напред|вижте предложението/i }));
}

describe('HomeTripPlanner and booking handoffs', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
  });

  it('recommends The Cabin for an exact party of 2 and links into the stay page', async () => {
    renderWithProviders(
      <Routes>
        <Route path="*" element={<HomeTripPlanner />} />
      </Routes>
    );
    fireEvent.click(screen.getByRole('button', { name: 'The two of us' }));

    const planner = screen.getByTestId('home-planner');
    expect(within(planner).getByRole('heading', { name: 'The Cabin' })).toBeInTheDocument();
    expect(within(planner).getByRole('heading', { name: '1 A-frame' })).toBeInTheDocument();
    expect(within(planner).getByRole('heading', { name: 'Luxury Cabin' })).toBeInTheDocument();
    expect(within(planner).getByText(/From €100 \/ night/i)).toBeInTheDocument();
    expect(within(planner).getByText(/From €60 \/ night/i)).toBeInTheDocument();
  });

  it('keeps an exact party of 6 and children/pets when checking dates for Stone House', async () => {
    renderWithProviders(
      <Routes>
        <Route path="*" element={<HomeTripPlanner />} />
      </Routes>,
      { seed: { adults: 2, children: 1, babies: 0, pets: 1 } }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Family or friends' }));
    fireEvent.click(screen.getByRole('button', { name: '6 guests' }));
    fireEvent.click(within(screen.getByTestId('home-planner')).getAllByRole('button', { name: 'Check these dates' })[0]);
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/search?checkIn=2026-11-12&checkOut=2026-11-14&adults=6&children=1&babies=0&pets=1'
    );
    expect(screen.getByTestId('guests')).toHaveTextContent('6:1:0:1');
  });

  it('sends an exact group of 10 into the whole-Valley quote with dates and guests', async () => {
    renderWithProviders(
      <Routes>
        <Route path="*" element={<HomeTripPlanner />} />
      </Routes>,
      { seed: { adults: 2, children: 2, babies: 0, pets: 0 } }
    );

    fireEvent.click(screen.getByRole('button', { name: 'A group of 8+' }));
    fireEvent.click(screen.getByRole('button', { name: '10 guests' }));
    fireEvent.click(within(screen.getByTestId('home-planner')).getByRole('button', { name: 'Request a quote' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/retreats/the-valley?adults=10&children=2&babies=0&pets=0&checkIn=2026-11-12&checkOut=2026-11-14'
    );
  });

  it('offers previously missing exact counts including 9 and 17 for groups', async () => {
    renderWithProviders(
      <Routes>
        <Route path="*" element={<HomeTripPlanner />} />
      </Routes>
    );

    fireEvent.click(screen.getByRole('button', { name: 'A group of 8+' }));
    expect(screen.getByRole('button', { name: '9 guests' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '11 guests' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '17 guests' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '17 guests' }));
    expect(within(screen.getByTestId('home-planner')).getByRole('heading', { name: 'The whole Valley' })).toBeInTheDocument();
  });

  it('does not silently reduce a family search when Cabin check dates is used', async () => {
    renderWithProviders(
      <Routes>
        <Route path="*" element={<HomeStayComparison />} />
      </Routes>,
      { seed: { adults: 2, children: 2, babies: 0, pets: 1 } }
    );

    const notes = await screen.findAllByText(/Your search is for 4 guests/i);
    expect(notes.length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Check dates' })[0]);
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/search?checkIn=2026-11-12&checkOut=2026-11-14&adults=2&children=2&babies=0&pets=1'
    );
    expect(screen.getByTestId('guests')).toHaveTextContent('2:2:0:1');
  });

  it('keeps the Valley arrival guide on the working EN path for Bulgarian', async () => {
    await i18n.changeLanguage('bg');
    expect(localizePath('/guides/the-valley', 'bg')).toBe('/guides/the-valley');
    expect(localizePath('/guides/the-valley', 'en')).toBe('/guides/the-valley');
    expect(localizePath('/cabin/faq', 'bg')).toBe('/cabin/faq');

    renderWithProviders(<HomeFaq />, { initialPath: '/bg' });
    const valleyGuide = screen.getByRole('link', { name: /Как се стига до The Valley|Arrival guide for The Valley/i });
    expect(valleyGuide).toHaveAttribute('href', '/guides/the-valley');
  });
});
