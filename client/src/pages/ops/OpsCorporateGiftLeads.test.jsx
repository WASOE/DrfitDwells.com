import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OpsCorporateGiftLeads from './OpsCorporateGiftLeads';

const mocks = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), update: vi.fn(), retry: vi.fn() }));
vi.mock('../../services/opsApi', () => ({ opsReadAPI: {
  corporateGiftLeads: mocks.list, corporateGiftLead: mocks.detail,
  updateCorporateGiftLead: mocks.update, retryCorporateGiftLead: mocks.retry
} }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function show(path) {
  render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/ops/corporate-gift-leads" element={<OpsCorporateGiftLeads />} />
    <Route path="/ops/corporate-gift-leads/:id" element={<OpsCorporateGiftLeads />} />
  </Routes></MemoryRouter>);
}

describe('corporate gift leads Ops', () => {
  it('lists submissions and filters by company and status', async () => {
    mocks.list.mockResolvedValue({ data: { data: { items: [{ _id: 'abc', company: 'Example', type: 'nomination', status: 'new', createdAt: '2026-01-01', email: { status: 'failed' }, notification: { status: 'sent' } }], page: 1, total: 1 } } });
    show('/ops/corporate-gift-leads');
    expect(await screen.findByRole('link', { name: /Example/ })).toHaveAttribute('href', '/ops/corporate-gift-leads/abc');
    expect(screen.getByText(/email failed/)).toBeInTheDocument();
    expect(screen.getByText(/needs contact research/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'researching' } });
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ status: 'researching' }));
  });

  it('shows nomination contact details and research status', async () => {
    mocks.detail.mockResolvedValue({ data: { data: { company: 'Example', type: 'nomination', hrContacts: ['HR Person'], hrEmails: ['hr@example.com'], companyWebsites: ['https://example.com/contact'], createdAt: '2026-01-01', status: 'new', notes: '', email: { status: 'sent' }, notification: { status: 'sent' } } } });
    show('/ops/corporate-gift-leads/abc');
    expect(await screen.findByText(/hr@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/HR Person/)).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/example.com\/contact/)).toBeInTheDocument();
    expect(screen.getByText(/HR email provided/)).toBeInTheDocument();
  });

  it('shows attribution and persists notes and status', async () => {
    mocks.detail.mockResolvedValue({ data: { data: { company: 'Example', type: 'hr', contactName: 'Ada', contactEmail: 'hr@example.com', createdAt: '2026-01-01', status: 'new', notes: '', attribution: { utmSource: 'newsletter' }, email: { status: 'failed', lastError: 'SMTP down' }, notification: { status: 'sent' } } } });
    mocks.update.mockResolvedValue({});
    show('/ops/corporate-gift-leads/abc');
    expect(await screen.findByText(/utmSource: newsletter/)).toBeInTheDocument();
    expect(screen.getByText(/SMTP down/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'researching' } });
    fireEvent.change(screen.getByLabelText('Internal notes'), { target: { value: 'Review next week' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('abc', { status: 'researching', notes: 'Review next week' }));
  });
});
