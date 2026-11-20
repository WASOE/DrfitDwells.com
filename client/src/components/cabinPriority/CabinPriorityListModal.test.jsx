import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../hooks/useSiteLanguage', () => ({
  useSiteLanguage: () => ({ language: 'en' })
}));

import CabinPriorityListModal from './CabinPriorityListModal';

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderModal(props = {}) {
  return render(
    <MemoryRouter>
      <CabinPriorityListModal
        open
        onClose={() => {}}
        checkIn="2027-01-15"
        checkOut="2027-01-18"
        sourcePage="search"
        {...props}
      />
    </MemoryRouter>
  );
}

describe('Cabin priority list modal', () => {
  it('renders the approved copy and fields', () => {
    renderModal();
    expect(screen.getByRole('heading', { name: "Some places are worth waiting for." })).toBeTruthy();
    expect(screen.getByLabelText(/Email address/i)).toBeTruthy();
    expect(screen.getByLabelText(/Preferred month/i)).toBeTruthy();
    expect(screen.getByRole('checkbox')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Join the priority list' })).toBeTruthy();
  });

  it('rejects an invalid email without calling the API', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/Email address/i), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Join the priority list' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires consent', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/Email address/i), { target: { value: 'guest@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join the priority list' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts selected dates and shows success only after confirmation', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    renderModal();

    fireEvent.change(screen.getByLabelText(/Email address/i), { target: { value: 'guest@example.com' } });
    fireEvent.change(screen.getByLabelText(/Preferred month/i), { target: { value: 'january' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Join the priority list' }));

    expect(await screen.findByText(/You're on the list/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Explore The Valley' }).getAttribute('href')).toBe('/valley');
    expect(screen.getByRole('link', { name: 'Give a stay as a gift' }).getAttribute('href')).toBe('/gift-vouchers');

    const [, options] = fetchMock.mock.calls[0];
    const payload = JSON.parse(options.body);
    expect(payload.checkIn).toBe('2027-01-15');
    expect(payload.checkOut).toBe('2027-01-18');
    expect(payload.preferredMonth).toBe('january');
    expect(payload.consent).toBe(true);
    expect(payload.sourcePage).toBe('search');
  });

  it('shows an error and no success when the API fails', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, message: 'Could not save your request.' })
    });
    renderModal();

    fireEvent.change(screen.getByLabelText(/Email address/i), { target: { value: 'guest@example.com' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Join the priority list' }));

    expect(await screen.findByText('Could not save your request.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/You're on the list/i)).toBeNull());
  });
});
