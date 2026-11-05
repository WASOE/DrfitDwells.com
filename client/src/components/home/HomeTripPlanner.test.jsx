import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { BookingSearchProvider } from '../../context/BookingSearchContext';
import i18n from '../../i18n/i18n';
import '../../i18n/ns/home';
import HomeTripPlanner from './HomeTripPlanner';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderPlanner() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <BookingSearchProvider>
        <Routes>
          <Route path="*" element={<><HomeTripPlanner /><LocationProbe /></>} />
        </Routes>
      </BookingSearchProvider>
    </MemoryRouter>
  );
}

async function answer(label) {
  fireEvent.click(screen.getByRole('button', { name: label }));
  fireEvent.click(screen.getByRole('button', { name: /continue|see my match|напред|вижте предложението/i }));
}

describe('HomeTripPlanner', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
  });

  it('recommends The Cabin and links into the stay booking page', async () => {
    renderPlanner();
    await answer('Just me');
    await answer('Proper time offline');
    await answer('No guest Wi-Fi, please');
    await answer('A weekend (2 nights)');

    const planner = screen.getByTestId('home-planner');
    expect(within(planner).getByRole('heading', { name: 'The Cabin' })).toBeInTheDocument();
    expect(within(planner).getAllByText(/wood-fired hot tub/i).length).toBeGreaterThan(0);
    expect(within(planner).getByRole('link', { name: /explore your stay/i })).toHaveAttribute('href', '/stays/the-cabin');
    expect(planner.textContent).not.toMatch(/helicopter|boat/i);
  });

  it('sends a large group to the whole-Valley booking page', async () => {
    renderPlanner();
    await answer('A group of 7 to 18');
    await answer('Being together as a group');
    await answer("I don't mind");
    await answer('Three nights');

    fireEvent.click(within(screen.getByTestId('home-planner')).getByRole('button', { name: 'Check dates' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/retreats/the-valley');
  });
});
