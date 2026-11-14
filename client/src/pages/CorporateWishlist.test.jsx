import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CorporateWishlist from './CorporateWishlist';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../services/api', () => ({ default: { post: mocks.post } }));
vi.mock('../tracking/attribution', () => ({ getAttributionPayload: () => ({ utmSource: 'test' }) }));
vi.mock('../components/Seo', () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function show(path) {
  return render(<MemoryRouter initialEntries={[path]}><CorporateWishlist /></MemoryRouter>);
}

describe('corporate wishlist', () => {
  it('defaults to private nomination without employee identity and confirms only after save', async () => {
    let resolve;
    mocks.post.mockReturnValue(new Promise((done) => { resolve = done; }));
    show('/wishlist');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Dear HR, we have enough mugs.');
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Work email')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Example' } });
    fireEvent.change(screen.getByLabelText('Company website or contact URL'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByLabelText(/I understand this nomination/));
    fireEvent.click(screen.getByRole('button', { name: /Drop the hint/ }));
    expect(mocks.post).toHaveBeenCalledWith('/public/corporate-gift-leads', expect.objectContaining({ type: 'nomination', company: 'Example', consent: true }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    resolve({ data: { success: true } });
    expect(await screen.findByRole('status')).toHaveTextContent('private review');
    expect(mocks.post.mock.calls[0][1]).not.toHaveProperty('contactEmail');
  });

  it('opens Bulgarian HR mode from the link and submits a no-payment enquiry', async () => {
    mocks.post.mockResolvedValue({ data: { success: true } });
    show('/bg/wishlist?intent=hr');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Скъпи HR, имаме достатъчно чаши.');
    expect(screen.getByText(/не плащане или поръчка/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Име на компанията'), { target: { value: 'Пример' } });
    fireEvent.change(screen.getByLabelText('Вашето име'), { target: { value: 'Мария' } });
    fireEvent.change(screen.getByLabelText('Служебен имейл'), { target: { value: 'hr@example.com' } });
    fireEvent.click(screen.getByLabelText(/Съгласен\/съгласна/));
    fireEvent.click(screen.getByRole('button', { name: /Поискайте оферта/ }));
    await screen.findByRole('status');
    expect(mocks.post.mock.calls[0][1]).toMatchObject({ type: 'hr', contactEmail: 'hr@example.com' });
  });

  it('requires an HR email or website and accepts an HR email without employee identity', async () => {
    mocks.post.mockResolvedValue({});
    show('/wishlist');
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Example' } });
    fireEvent.click(screen.getByLabelText(/I understand this nomination/));
    fireEvent.click(screen.getByRole('button', { name: /Drop the hint/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Provide an HR email');
    expect(mocks.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('HR email address'), { target: { value: 'hr@example.com' } });
    fireEvent.change(screen.getByLabelText('HR contact name (optional)'), { target: { value: 'HR Person' } });
    fireEvent.click(screen.getByRole('button', { name: /Drop the hint/ }));
    await screen.findByRole('status');
    expect(mocks.post.mock.calls[0][1]).toMatchObject({ hrEmail: 'hr@example.com', hrContact: 'HR Person' });
    expect(mocks.post.mock.calls[0][1]).not.toHaveProperty('contactName');
  });

  it('rejects invalid contact data before sending', () => {
    show('/wishlist');
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Example' } });
    fireEvent.change(screen.getByLabelText('HR email address'), { target: { value: 'hr@example' } });
    fireEvent.submit(screen.getByRole('button', { name: /Drop the hint/ }).closest('form'));
    expect(screen.getByRole('alert')).toHaveTextContent('valid email');
    expect(mocks.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('HR email address'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Company website or contact URL'), { target: { value: 'ftp://example.com' } });
    fireEvent.submit(screen.getByRole('button', { name: /Drop the hint/ }).closest('form'));
    expect(screen.getByRole('alert')).toHaveTextContent('http or https');
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('switches modes without losing the company and requires new consent', () => {
    show('/wishlist');
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Example' } });
    fireEvent.click(screen.getByLabelText(/I understand this nomination/));
    fireEvent.click(screen.getByLabelText('Buying for a team?'));
    expect(screen.getByLabelText('Company name')).toHaveValue('Example');
    expect(screen.getByLabelText('Your name')).toBeRequired();
    expect(screen.getByLabelText(/I agree to be contacted/)).not.toBeChecked();
    fireEvent.click(screen.getByLabelText('Employee nomination'));
    expect(screen.queryByLabelText('Work email')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/I understand this nomination/)).not.toBeChecked();
  });

  it('shows failure without confirmation and preserves idempotency on retry', async () => {
    mocks.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({});
    show('/wishlist');
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Example' } });
    fireEvent.change(screen.getByLabelText('Company website or contact URL'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByLabelText(/I understand this nomination/));
    fireEvent.click(screen.getByRole('button', { name: /Drop the hint/ }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Drop the hint/ }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    expect(mocks.post.mock.calls[0][1].idempotencyKey).toBe(mocks.post.mock.calls[1][1].idempotencyKey);
  });

  it('uses a fresh request key when details change after a failure', async () => {
    mocks.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({});
    show('/wishlist');
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Example' } });
    fireEvent.change(screen.getByLabelText('Company website or contact URL'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByLabelText(/I understand this nomination/));
    fireEvent.click(screen.getByRole('button', { name: /Drop the hint/ }));
    await screen.findByRole('alert');
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Example Two' } });
    fireEvent.click(screen.getByRole('button', { name: /Drop the hint/ }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    expect(mocks.post.mock.calls[0][1].idempotencyKey).not.toBe(mocks.post.mock.calls[1][1].idempotencyKey);
  });
});
