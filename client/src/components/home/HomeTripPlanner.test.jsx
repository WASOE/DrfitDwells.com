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

function ModalProbe() {
  const { isModalOpen } = useBookingSearch();
  return <div data-testid="modal">{isModalOpen ? 'open' : 'closed'}</div>;
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
        <ModalProbe />
      </BookingSearchProvider>
    </MemoryRouter>
  );
}

const SHARE = 'Sharing is fine — bunks and sofa beds are OK';
const PAIRS = 'Private places — each couple or pair in their own cabin';
const OWN = 'Everyone in their own place';
const ONLY_NEEDED = 'Only the places we need';
const WHOLE_VALLEY = 'Yes, the whole Valley';

function renderPlanner(options) {
  return renderWithProviders(
    <Routes>
      <Route path="*" element={<HomeTripPlanner />} />
    </Routes>,
    options
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
    await answer('The two of us');
    await answer('Proper time offline');
    await answer('No guest Wi-Fi, please');
    await answer('A weekend (2 nights)');

    const planner = screen.getByTestId('home-planner');
    expect(within(planner).getByRole('heading', { name: 'The Cabin' })).toBeInTheDocument();
    expect(within(planner).getByText(/Exact party size for booking: 2 guests/i)).toBeInTheDocument();
    expect(within(planner).getByRole('link', { name: /explore your stay/i })).toHaveAttribute('href', '/stays/the-cabin');
  });

  it('keeps 6 comfortable guests, children and pets in the Stone House search', async () => {
    renderPlanner({ seed: { adults: 2, children: 1, babies: 0, pets: 1 } });

    await answer('6 guests');
    await answer(SHARE);
    await answer(ONLY_NEEDED);
    await answer('Being together as a group');
    await answer("I don't mind");
    await answer('Three nights');

    const planner = screen.getByTestId('home-planner');
    expect(within(planner).getByRole('heading', { name: 'The Valley · Stone House' })).toBeInTheDocument();
    fireEvent.click(within(planner).getByRole('button', { name: 'Check dates' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/search?checkIn=2026-11-12&checkOut=2026-11-14&adults=6&children=1&babies=0&pets=1'
    );
    expect(screen.getByTestId('guests')).toHaveTextContent('6:1:0:1');
  });

  it('only asks the short four questions for two guests and the group questions from three', async () => {
    renderPlanner();
    expect(screen.getByText(/Question 01 \/ 04/)).toBeInTheDocument();
    await answer('The two of us');
    expect(screen.getByText(/Question 02 \/ 04/)).toBeInTheDocument();
    cleanup();

    renderPlanner();
    expect(screen.getByText(/Question 01 \/ 04/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '7 guests' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText(/Question 02 \/ 06/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How would you like to sleep?' })).toBeInTheDocument();
  });

  it('gives 7 friends who share the Stone House plus an A-frame as an enquiry, not a buyout', async () => {
    renderPlanner({ seed: { adults: 2, children: 1, babies: 1, pets: 1 } });

    await answer('7 guests');
    await answer(SHARE);
    await answer(ONLY_NEEDED);
    await answer('Being together as a group');
    await answer("I don't mind");
    await answer('Three nights');

    const planner = screen.getByTestId('home-planner');
    expect(within(planner).getByRole('heading', { name: 'Stone House + 1 A-frame' })).toBeInTheDocument();
    expect(within(planner).queryByRole('heading', { name: 'The whole Valley' })).not.toBeInTheDocument();
    expect(within(planner).getByText(/Sleeping arrangement/)).toBeInTheDocument();
    expect(within(planner).getByText(/6 guests/)).toBeInTheDocument();
    expect(within(planner).getByText(/online checkout books one stay at a time/i)).toBeInTheDocument();
    expect(within(planner).getByText(/Exact party size for booking: 7 guests/i)).toBeInTheDocument();
    expect(within(planner).getByRole('link', { name: /explore your stay/i })).toHaveAttribute('href', '/valley');

    fireEvent.click(within(planner).getByRole('button', { name: 'Ask about these dates' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/retreats/the-valley?adults=7&children=1&babies=1&pets=1&checkIn=2026-11-12&checkOut=2026-11-14&planner=combination&units=stone:1,aframe:1'
    );
    expect(screen.getByTestId('guests')).toHaveTextContent('7:1:1:1');
  });

  it('gives 3 couples and 1 more guest four two-person A-frames', async () => {
    renderPlanner();
    await answer('7 guests');
    await answer(PAIRS);
    await answer(ONLY_NEEDED);
    await answer('Time together in private');
    await answer("I don't mind");
    await answer('A weekend (2 nights)');

    const planner = screen.getByTestId('home-planner');
    expect(within(planner).getByRole('heading', { name: '4 A-frames' })).toBeInTheDocument();
    expect(within(planner).queryByText(/Stone House/)).not.toBeInTheDocument();
    expect(within(planner).getByText(/Exact party size for booking: 7 guests/)).toBeInTheDocument();
  });

  it('gives 8 guests who want separate places enough two-person units', async () => {
    renderPlanner();
    await answer('8 guests');
    await answer(PAIRS);
    await answer(ONLY_NEEDED);
    await answer('Being outside');
    await answer('A connection nearby is useful');
    await answer('A weekend (2 nights)');

    const planner = screen.getByTestId('home-planner');
    expect(within(planner).getByRole('heading', { name: '4 A-frames' })).toBeInTheDocument();
    expect(within(planner).getByText(/Starlink is only in the Stone House/)).toBeInTheDocument();
  });

  it('sends an explicit whole-Valley request for 7 to the buyout quote with dates and guests', async () => {
    renderPlanner({ seed: { adults: 2, children: 2, babies: 0, pets: 0 } });

    await answer('7 guests');
    await answer(SHARE);
    await answer(WHOLE_VALLEY);
    await answer('Being together as a group');
    await answer("I don't mind");
    await answer('Three nights');

    const planner = screen.getByTestId('home-planner');
    expect(within(planner).getByRole('heading', { name: 'The whole Valley' })).toBeInTheDocument();
    fireEvent.click(within(planner).getByRole('button', { name: 'Check dates' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/retreats/the-valley?adults=7&children=2&babies=0&pets=0&checkIn=2026-11-12&checkOut=2026-11-14'
    );
    expect(screen.getByTestId('location')).not.toHaveTextContent('planner=combination');
  });

  it.each(['17', '18'])('goes straight to the whole Valley for %s guests without extra questions', async (count) => {
    renderPlanner({ seed: { adults: 2, children: 0, babies: 0, pets: 0 } });

    await answer(`${count} guests`);
    expect(screen.getByText(/Question 02 \/ 04/)).toBeInTheDocument();
    await answer('Being together as a group');
    await answer("I don't mind");
    await answer('Three nights');

    const planner = screen.getByTestId('home-planner');
    expect(within(planner).getByRole('heading', { name: 'The whole Valley' })).toBeInTheDocument();
    fireEvent.click(within(planner).getByRole('button', { name: 'Check dates' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/retreats/the-valley?adults=${count}&children=0&babies=0&pets=0&checkIn=2026-11-12&checkOut=2026-11-14`
    );
  });

  it('opens the booking calendar instead of inventing dates for a single stay', async () => {
    window.matchMedia = window.matchMedia || (() => ({ matches: false }));
    renderPlanner();

    await answer('6 guests');
    await answer(SHARE);
    await answer(ONLY_NEEDED);
    await answer('Being together as a group');
    await answer("I don't mind");
    await answer('Three nights');

    fireEvent.click(within(screen.getByTestId('home-planner')).getByRole('button', { name: 'Check dates' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
    expect(screen.getByTestId('modal')).toHaveTextContent('open');
  });

  it('sends a combination enquiry without inventing dates when none are chosen', async () => {
    renderPlanner();

    await answer('7 guests');
    await answer(SHARE);
    await answer(ONLY_NEEDED);
    await answer('Being together as a group');
    await answer("I don't mind");
    await answer('Three nights');

    fireEvent.click(within(screen.getByTestId('home-planner')).getByRole('button', { name: 'Ask about these dates' }));
    const location = screen.getByTestId('location').textContent;
    expect(location).toBe(
      '/retreats/the-valley?adults=7&children=0&babies=0&pets=0&planner=combination&units=stone:1,aframe:1'
    );
    expect(location).not.toContain('checkIn');
  });

  it('renders the group questions in Bulgarian', async () => {
    await i18n.changeLanguage('bg');
    renderPlanner();
    fireEvent.click(screen.getByRole('button', { name: '7 гости' }));
    fireEvent.click(screen.getByRole('button', { name: 'Напред' }));
    expect(screen.getByRole('heading', { name: 'Как искате да спите?' })).toBeInTheDocument();
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
