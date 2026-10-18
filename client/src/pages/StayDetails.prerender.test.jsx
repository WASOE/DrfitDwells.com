import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import en from '../i18n/locales/en/seo.json';
import bg from '../i18n/locales/bg/seo.json';
import registry from '../data/publicSeoRoutes.json';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), language: 'en' }));
vi.mock('../services/api', () => ({ stayAPI: { resolve: mocks.resolve } }));
vi.mock('../hooks/useSiteLanguage', () => ({ useSiteLanguage: () => ({ language: mocks.language }) }));
vi.mock('../i18n/ns/seo', () => ({}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key.split('.').reduce((value, part) => value?.[part], mocks.language === 'bg' ? bg : en)
  })
}));
vi.mock('../components/Seo', () => ({ default: ({ title, description }) => (
  <div data-testid="seo" data-title={title} data-description={description} />
) }));
vi.mock('./CabinDetails', () => ({ default: ({ cabinId, staySlug, loadingFallback }) => (
  <div data-testid="live-cabin" data-id={cabinId} data-slug={staySlug}>{loadingFallback}</div>
) }));
vi.mock('./AFrameDetails', () => ({ default: ({ staySlug, loadingFallback }) => (
  <div data-testid="live-type" data-slug={staySlug}>{loadingFallback}</div>
) }));
vi.mock('./NotFoundPage', () => ({ default: () => <h1>Not found</h1> }));
import StayDetails from './StayDetails';

function mount(slug) {
  return render(
    <MemoryRouter initialEntries={[`/stays/${slug}`]}>
      <Routes><Route path="/stays/:slug" element={<StayDetails />} /></Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mocks.resolve.mockReset();
  mocks.language = 'en';
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('deterministic public stay initial content', () => {
  for (const language of ['en', 'bg']) {
    for (const entry of registry.filter((route) => route.stayId)) {
      it(`${entry.path} has safe ${language} copy before any live data`, () => {
        mocks.language = language;
        mocks.resolve.mockReturnValue(new Promise(() => {}));
        const { container } = mount(entry.path.split('/').pop());
        const copy = (language === 'bg' ? bg : en).paidStaysBulgaria.stays[entry.stayId];
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(copy.title);
        expect(screen.getByText(copy.fitLine)).toBeInTheDocument();
        for (const fact of copy.facts) expect(screen.getByText(fact)).toBeInTheDocument();
        expect(screen.getByTestId('seo')).toHaveAttribute('data-description', copy.fitLine);
        expect(container.textContent).not.toMatch(/€|From .+night|От .+нощувка/);
        expect(mocks.resolve).toHaveBeenCalledWith(entry.path.split('/').pop());
      });
    }
  }

  it('reports live-data failure without losing public copy and retries the same resolver', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.resolve.mockRejectedValueOnce(new Error('Offline'));
    mocks.resolve.mockResolvedValueOnce({ data: { success: true, data: { kind: 'cabin', cabinId: 'public-id' } } });
    mount('the-cabin');
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(screen.getByRole('heading')).toHaveTextContent('The Cabin');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('live-cabin')).toHaveAttribute('data-id', 'public-id');
    expect(mocks.resolve).toHaveBeenCalledTimes(2);
  });

  it('keeps the existing multi-unit details path', async () => {
    mocks.resolve.mockResolvedValue({ data: { success: true, data: { kind: 'cabinType' } } });
    mount('a-frame');
    expect(await screen.findByTestId('live-type')).toHaveAttribute('data-slug', 'a-frame');
  });

  it('does not enumerate or invent static stays outside the registry', async () => {
    mocks.resolve.mockResolvedValue({ data: { success: false } });
    mount('unknown-stay');
    await waitFor(() => expect(screen.getByRole('heading')).toHaveTextContent('Not found'));
    expect(screen.queryByTestId('seo')).not.toBeInTheDocument();
  });
});
