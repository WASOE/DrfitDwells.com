import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OpsReviews from './OpsReviews.jsx';
import { OpsSessionProvider } from '../../context/OpsSessionContext';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    reviews: vi.fn(),
    review: vi.fn(),
    cabins: vi.fn()
  },
  opsWriteAPI: {
    updateReviewStatus: vi.fn(),
    updateReview: vi.fn(),
    createReview: vi.fn(),
    deleteReview: vi.fn()
  }
}));

import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

const CABINS = {
  items: [
    { kind: 'single_cabin', cabinId: 'cabin-1', name: 'Stone House', location: 'Rhodope' },
    { kind: 'single_cabin', cabinId: 'cabin-2', name: 'Valley Lux', location: 'Valley' },
    { kind: 'multi_unit_type', cabinTypeId: 'type-1', name: 'A-frame type' }
  ]
};

const ITEMS = [
  {
    reviewId: 'rev-approved',
    reviewerDisplay: 'Elena Petrova With A Very Long Reviewer Name',
    cabinName: 'Stone House',
    source: 'airbnb',
    createdAtSource: '2026-09-01T12:00:00.000Z',
    textExcerpt:
      'Wonderful stay with mountain views and a quiet evening by the fire. Would return again for another long weekend.',
    rating: 5,
    status: 'approved'
  },
  {
    reviewId: 'rev-pending',
    reviewerDisplay: 'Pending Guest',
    cabinName: 'Valley Lux',
    source: 'manual',
    createdAtSource: '2026-09-10T09:00:00.000Z',
    textExcerpt: 'Pending review text awaiting moderation.',
    rating: 4,
    status: 'pending'
  },
  {
    reviewId: 'rev-hidden',
    reviewerDisplay: 'Hidden Guest',
    cabinName: 'Stone House',
    source: 'import',
    createdAtSource: '2026-08-20T18:00:00.000Z',
    textExcerpt: 'Hidden review content.',
    rating: 2,
    status: 'hidden'
  }
];

function listPayload(overrides = {}) {
  return {
    items: ITEMS,
    pagination: { page: 1, limit: 50, total: ITEMS.length },
    moderationSummary: { approved: 12, pending: 3, hidden: 2 },
    ...overrides
  };
}

function renderReviews(initial = '/ops/reviews') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <OpsSessionProvider
        session={{
          authenticated: true,
          role: 'admin',
          modules: ['*'],
          actions: [],
          defaultRoute: '/ops',
          locale: 'en'
        }}
      >
        <Routes>
          <Route path="/ops/reviews" element={<OpsReviews />} />
        </Routes>
      </OpsSessionProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  opsReadAPI.reviews.mockResolvedValue({ data: { data: listPayload() } });
  opsReadAPI.cabins.mockResolvedValue({ data: { data: CABINS } });
  opsReadAPI.review.mockResolvedValue({
    data: {
      data: {
        review: {
          _id: 'rev-pending',
          rating: 4,
          text: 'Pending review text awaiting moderation.',
          reviewerName: 'Pending Guest',
          language: 'en',
          status: 'pending',
          pinned: false,
          locked: false,
          moderationNotes: '',
          source: 'manual',
          createdAtSource: '2026-09-10T09:00:00.000Z',
          cabinId: { name: 'Valley Lux', location: 'Valley' },
          ownerResponse: { text: '', respondedBy: 'Jose' }
        }
      }
    }
  });
  opsWriteAPI.updateReviewStatus.mockResolvedValue({ data: { success: true } });
  opsWriteAPI.updateReview.mockResolvedValue({ data: { success: true } });
  opsWriteAPI.createReview.mockResolvedValue({ data: { success: true } });
  opsWriteAPI.deleteReview.mockResolvedValue({ data: { success: true } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OpsReviews migration', () => {
  it('uses OpsPage wide and Reviews header without max-w-5xl card shell', async () => {
    renderReviews();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Reviews' })).toBeInTheDocument();
    });
    expect(document.querySelector('.ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
    expect(document.querySelector('.max-w-5xl')).toBeNull();
    expect(screen.getByRole('button', { name: 'Create review' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('loads reviews with default params and shows summary values', async () => {
    renderReviews();
    await waitFor(() => {
      expect(opsReadAPI.reviews).toHaveBeenCalledWith({ page: 1, limit: 50, sort: 'newest' });
    });
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Hidden').length).toBeGreaterThan(0);
    expect(screen.getByText('3 review(s)')).toBeInTheDocument();
  });

  it('renders populated rows with status, source, rating, and text', async () => {
    renderReviews();
    await waitFor(() => {
      expect(screen.getByTestId('review-row-rev-approved')).toBeInTheDocument();
    });
    const approved = screen.getByTestId('review-row-rev-approved');
    expect(within(approved).getByText(/Elena Petrova/)).toBeInTheDocument();
    expect(within(approved).getByText('Stone House')).toBeInTheDocument();
    expect(within(approved).getByText(/Source: Airbnb/)).toBeInTheDocument();
    expect(within(approved).getByText(/★ 5/)).toBeInTheDocument();
    expect(within(approved).getByText('Wonderful stay', { exact: false })).toBeInTheDocument();
    expect(within(approved).getByText('Approved')).toBeInTheDocument();
    expect(within(screen.getByTestId('review-row-rev-pending')).getByText('Pending')).toBeInTheDocument();
    expect(within(screen.getByTestId('review-row-rev-hidden')).getByText('Hidden')).toBeInTheDocument();
  });

  it('applies live status/cabin/source/sort filters with exact params', async () => {
    renderReviews();
    await waitFor(() => expect(opsReadAPI.cabins).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText('Status')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'pending' } });
    await waitFor(() => {
      expect(opsReadAPI.reviews).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending', sort: 'newest', page: 1, limit: 50 })
      );
    });

    fireEvent.change(screen.getByLabelText('Cabin'), { target: { value: 'cabin-1' } });
    await waitFor(() => {
      expect(opsReadAPI.reviews).toHaveBeenCalledWith(expect.objectContaining({ cabinId: 'cabin-1' }));
    });

    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'airbnb' } });
    await waitFor(() => {
      expect(opsReadAPI.reviews).toHaveBeenCalledWith(expect.objectContaining({ source: 'airbnb' }));
    });

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'rating' } });
    await waitFor(() => {
      expect(opsReadAPI.reviews).toHaveBeenCalledWith(expect.objectContaining({ sort: 'rating' }));
    });
  });

  it('submits search only on Search / Enter', async () => {
    renderReviews();
    await waitFor(() => expect(screen.getByLabelText('Search text')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Search text'), { target: { value: 'elena' } });
    expect(opsReadAPI.reviews).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      expect(opsReadAPI.reviews).toHaveBeenCalledWith(expect.objectContaining({ q: 'elena' }));
    });
  });

  it('shows empty state copy for filtered results', async () => {
    opsReadAPI.reviews.mockResolvedValue({
      data: { data: listPayload({ items: [], pagination: { page: 1, limit: 50, total: 0 } }) }
    });
    renderReviews();
    await waitFor(() => {
      expect(screen.getByText('No reviews for this filter.')).toBeInTheDocument();
    });
  });

  it('keeps header during loading and shows load error without fake summary', async () => {
    opsReadAPI.reviews.mockRejectedValue({ response: { data: { message: 'Reviews unavailable' } } });
    renderReviews();
    expect(screen.getByRole('heading', { name: 'Reviews' })).toBeInTheDocument();
    expect(await screen.findByText('Reviews unavailable')).toBeInTheDocument();
    expect(screen.queryByText('12')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-row-rev-approved')).not.toBeInTheDocument();
  });

  it('approves and hides via exact status PATCH then reloads', async () => {
    renderReviews();
    await waitFor(() => expect(screen.getByTestId('review-row-rev-pending')).toBeInTheDocument());
    const callsBefore = opsReadAPI.reviews.mock.calls.length;

    fireEvent.click(within(screen.getByTestId('review-row-rev-pending')).getByRole('button', { name: 'Approve' }));
    await waitFor(() => {
      expect(opsWriteAPI.updateReviewStatus).toHaveBeenCalledWith('rev-pending', 'approved');
    });
    await waitFor(() => {
      expect(opsReadAPI.reviews.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    fireEvent.click(within(screen.getByTestId('review-row-rev-approved')).getByRole('button', { name: 'Hide' }));
    await waitFor(() => {
      expect(opsWriteAPI.updateReviewStatus).toHaveBeenCalledWith('rev-approved', 'hidden');
    });
  });

  it('opens create modal, validates, and posts exact payload', async () => {
    renderReviews('/ops/reviews?create=1&cabinId=cabin-1');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create review' })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Review text *'), {
      target: { value: 'Brand new manual review.' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(opsWriteAPI.createReview).toHaveBeenCalledWith({
        cabinId: 'cabin-1',
        rating: 5,
        text: 'Brand new manual review.',
        reviewerName: 'Guest',
        language: 'en',
        status: 'approved',
        pinned: false,
        locked: false
      });
    });
  });

  it('opens edit flow, saves exact payload, and confirms delete without window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderReviews('/ops/reviews?reviewId=rev-pending');

    await waitFor(() => {
      expect(opsReadAPI.review).toHaveBeenCalledWith('rev-pending');
    });
    expect(await screen.findByRole('heading', { name: 'Edit review' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Pending review text awaiting moderation.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Review text'), {
      target: { value: 'Updated pending text' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(opsWriteAPI.updateReview).toHaveBeenCalledWith(
        'rev-pending',
        expect.objectContaining({
          rating: 4,
          text: 'Updated pending text',
          reviewerName: 'Pending Guest',
          language: 'en',
          status: 'pending',
          pinned: false,
          locked: false
        })
      );
    });

    // reopen for delete
    opsReadAPI.review.mockResolvedValueOnce({
      data: {
        data: {
          review: {
            _id: 'rev-pending',
            rating: 4,
            text: 'Updated pending text',
            reviewerName: 'Pending Guest',
            language: 'en',
            status: 'pending',
            pinned: false,
            locked: false,
            moderationNotes: '',
            source: 'manual',
            createdAtSource: '2026-09-10T09:00:00.000Z',
            cabinId: { name: 'Valley Lux', location: 'Valley' },
            ownerResponse: { text: '', respondedBy: 'Jose' }
          }
        }
      }
    });
    fireEvent.click(within(screen.getByTestId('review-row-rev-pending')).getByRole('button', { name: 'Edit' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/soft delete/i)).toBeInTheDocument();
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    await waitFor(() => {
      expect(opsWriteAPI.deleteReview).toHaveBeenCalledWith('rev-pending');
    });
    confirmSpy.mockRestore();
  });
});
