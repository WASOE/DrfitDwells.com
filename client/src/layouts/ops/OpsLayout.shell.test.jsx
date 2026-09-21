import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import OpsLayout from '../OpsLayout';
import { OPS_MOBILE_TABS, OPS_MORE_GROUPS } from './opsNavConfig';
import { OPS_SIDEBAR_STORAGE_KEY } from './opsSidebarState';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    session: vi.fn(),
    health: vi.fn()
  },
  getOpsPushHealth: vi.fn(() => Promise.resolve({ data: { data: {} } })),
  sendOpsPushTestNotification: vi.fn()
}));

vi.mock('../../hooks/useOpsNotifications', () => ({
  useOpsNotifications: () => ({
    enabled: true,
    unreadCount: 0,
    notifications: [],
    listLoading: false,
    listError: null,
    markAllBusy: false,
    refreshInbox: () => {},
    markOneRead: () => {},
    markAllRead: () => {}
  })
}));

vi.mock('../../hooks/useOpsPushNotifications', () => ({
  useOpsPushNotifications: () => ({
    status: 'unsupported',
    loading: false,
    busy: false,
    readiness: 'unsupported',
    errorMessage: null,
    subscribe: () => {},
    unsubscribe: () => {}
  })
}));

import { opsReadAPI } from '../../services/opsApi';

const healthyHealth = {
  dependencies: {
    stripeWebhookLastSeenAt: '2026-01-01T00:00:00.000Z',
    syncLastSeenByCabinChannel: []
  }
};

const adminSession = {
  authenticated: true,
  actorId: 'admin-1',
  role: 'admin',
  modules: ['*'],
  actions: ['ops.users.manage', 'ops.cleaning.view', 'ops.cleaning.settings_read'],
  defaultRoute: '/ops',
  locale: 'en'
};

const cleanerSession = {
  authenticated: true,
  actorId: 'cl-1',
  role: 'cleaner',
  modules: ['cleaning'],
  actions: ['ops.cleaning.view'],
  defaultRoute: '/ops/cleaning',
  locale: 'en'
};

function stubMatchMedia() {
  window.matchMedia = vi.fn(() => ({
    matches: false,
    media: '(prefers-color-scheme: dark)',
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {}
  }));
}

function setViewport(width) {
  window.innerWidth = width;
  window.dispatchEvent(new Event('resize'));
}

function renderLayout(pathname, session, health = healthyHealth) {
  opsReadAPI.session.mockResolvedValue({ data: { success: true, data: session } });
  opsReadAPI.health.mockResolvedValue({ data: { data: health } });
  localStorage.setItem('adminToken', 'test-token');
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route element={<OpsLayout />}>
          <Route path="/ops" element={<div>Dashboard page</div>} />
          <Route path="/ops/cleaning" element={<div>Cleaning page</div>} />
          <Route path="/ops/insights" element={<div>Insights page</div>} />
          <Route path="/ops/conversion" element={<div>Conversion page</div>} />
          <Route path="/ops/design-system" element={<h1>Design system</h1>} />
          <Route path="/ops/reservations/:id" element={<div>Reservation detail</div>} />
          <Route path="*" element={<div>Other ops page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('OpsLayout desktop/mobile/cleaner shell', () => {
  beforeEach(() => {
    stubMatchMedia();
    localStorage.clear();
    setViewport(1280);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders the expanded desktop shell at 1280px without a permanent push strip', async () => {
    renderLayout('/ops/reservations/123', adminSession, {
      dependencies: {
        stripeWebhookLastSeenAt: null,
        syncLastSeenByCabinChannel: [{ lastSyncOutcome: 'warning' }]
      }
    });
    await waitFor(() => {
      expect(screen.getByTestId('ops-sidebar')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ops-sidebar')).toHaveAttribute('data-mode', 'expanded');
    expect(screen.getByTestId('ops-topbar')).toBeInTheDocument();
    expect(screen.getByTestId('ops-topbar-context')).toHaveTextContent('Reservations');
    expect(screen.getByTestId('ops-notification-bell')).toBeInTheDocument();
    expect(screen.getByTestId('ops-logout')).toBeInTheDocument();
    expect(screen.getByTestId('ops-degraded-banner')).toHaveTextContent('Degraded state');
    expect(screen.queryByTestId('ops-push-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ops-push-panel-subscribed')).not.toBeInTheDocument();
    expect(screen.getByTestId('ops-skip-link')).toHaveAttribute('href', '#ops-main');
    expect(screen.getByTestId('ops-main')).toHaveAttribute('id', 'ops-main');
    expect(screen.queryByTestId('ops-mobile-header')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Ops sections' }).closest('[data-testid="ops-sidebar"]')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('ops-notification-bell'));
    expect(await screen.findByTestId('ops-notification-push-section')).toBeInTheDocument();
    expect(screen.getByTestId('ops-push-panel')).toBeInTheDocument();
  });

  it('uses collapsed mode by default at 800px and expanded at 1024px', async () => {
    setViewport(800);
    renderLayout('/ops', adminSession);
    await waitFor(() => {
      expect(screen.getByTestId('ops-sidebar')).toHaveAttribute('data-mode', 'collapsed');
    });
    cleanup();
    setViewport(1024);
    renderLayout('/ops', adminSession);
    await waitFor(() => {
      expect(screen.getByTestId('ops-sidebar')).toHaveAttribute('data-mode', 'expanded');
    });
  });

  it('persists only the expand/collapse toggle, not a flyout', async () => {
    setViewport(800);
    renderLayout('/ops', adminSession);
    await waitFor(() => {
      expect(screen.getByTestId('ops-sidebar-toggle')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
    expect(screen.getByTestId('ops-sidebar-flyout')).toBeInTheDocument();
    expect(localStorage.getItem(OPS_SIDEBAR_STORAGE_KEY)).toBeNull();
    fireEvent.click(screen.getByTestId('ops-sidebar-toggle'));
    expect(localStorage.getItem(OPS_SIDEBAR_STORAGE_KEY)).toBe('expanded');
    expect(screen.getByTestId('ops-sidebar')).toHaveAttribute('data-mode', 'expanded');
  });

  it('keeps the five mobile tabs and More, and hides desktop chrome below 768', async () => {
    setViewport(375);
    renderLayout('/ops/insights', adminSession);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
    });
    expect(screen.queryByTestId('ops-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ops-topbar')).not.toBeInTheDocument();
    expect(screen.getByTestId('ops-mobile-header')).toHaveTextContent('Drift & Dwells');
    expect(OPS_MOBILE_TABS.map((tab) => tab.id)).toEqual(['home', 'calendar', 'guests', 'finance', 'more']);
    expect(screen.getByRole('link', { name: 'Finance' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
    expect(OPS_MORE_GROUPS.map((group) => group.id)).toEqual([
      'dashboard',
      'calendar',
      'guests',
      'finance',
      'property-partners',
      'operations'
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('link', { name: 'Historical performance' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Design system' })).not.toBeInTheDocument();
  });

  it('maps Conversion to the Finance mobile tab', async () => {
    setViewport(375);
    renderLayout('/ops/conversion', adminSession);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Finance' })).toHaveAttribute('aria-current', 'page');
    });
  });

  it('preserves the cleaner-only world', async () => {
    setViewport(1280);
    renderLayout('/ops/cleaning', cleanerSession);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Cleaning' })).toBeInTheDocument();
    });
    expect(screen.queryByTestId('ops-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ops-topbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('ops-degraded-banner')).not.toBeInTheDocument();
    expect(screen.getByText('Cleaning page')).toBeInTheDocument();
    expect(screen.getByTestId('ops-notification-bell')).toBeInTheDocument();
    expect(screen.getByTestId('ops-logout')).toBeInTheDocument();
    expect(localStorage.getItem(OPS_SIDEBAR_STORAGE_KEY)).toBeNull();
  });

  it('shows Design system as top-bar context without adding it to navigation', async () => {
    renderLayout('/ops/design-system', adminSession);
    await waitFor(() => {
      expect(screen.getByTestId('ops-topbar-context')).toHaveTextContent('Design system');
    });
    expect(screen.queryByRole('link', { name: 'Design system' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Design system' })).toBeInTheDocument();
  });

  it('keeps the skip link out of normal flow and targeting #ops-main', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'opsShell.css'), 'utf8');
    expect(css).toMatch(/\.ops-skip-link\s*\{[^}]*position:\s*fixed/);
    expect(css).toMatch(/\.ops-skip-link:focus-visible/);
    expect(css).not.toMatch(/focus:not-sr-only/);

    renderLayout('/ops', adminSession);
    await waitFor(() => {
      expect(screen.getByTestId('ops-skip-link')).toBeInTheDocument();
    });
    const skip = screen.getByTestId('ops-skip-link');
    expect(skip).toHaveAttribute('href', '#ops-main');
    expect(skip).toHaveClass('ops-skip-link');
    expect(skip.className).not.toMatch(/\bsr-only\b/);
    expect(skip.className).not.toMatch(/not-sr-only/);
    fireEvent.focus(skip);
    expect(skip).toHaveClass('ops-skip-link');
    expect(skip.className).not.toMatch(/not-sr-only/);
    expect(screen.getByTestId('ops-sidebar').getBoundingClientRect().top).toBe(0);
  });

  it('keeps the mobile bottom nav on the nav layer below overlays', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'OpsMobileTabBar.jsx'), 'utf8');
    expect(source).toMatch(/\bz-ops-nav\b/);
    expect(source).not.toMatch(/\bz-40\b/);
    expect(source).not.toMatch(/\bz-50\b/);
  });
});
