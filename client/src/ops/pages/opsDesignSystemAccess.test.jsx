import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import OpsLayout from '../../layouts/OpsLayout';
import OpsDesignSystemPage from './OpsDesignSystemPage';

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
    items: [],
    unreadCount: 0,
    loading: false,
    markRead: () => {},
    markAllRead: () => {}
  })
}));

vi.mock('../../hooks/useOpsPushNotifications', () => ({
  useOpsPushNotifications: () => ({
    status: 'unsupported',
    subscribe: () => {},
    unsubscribe: () => {}
  })
}));

import { opsReadAPI } from '../../services/opsApi';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="ops-location">{location.pathname}</div>;
}

function renderOpsRoute(session) {
  opsReadAPI.session.mockResolvedValue({
    data: { success: true, data: session }
  });
  opsReadAPI.health.mockResolvedValue({ data: { data: {} } });
  localStorage.setItem('adminToken', 'test-token');

  return render(
    <MemoryRouter initialEntries={['/ops/design-system']}>
      <LocationProbe />
      <Routes>
        <Route element={<OpsLayout />}>
          <Route path="/ops/design-system" element={<OpsDesignSystemPage />} />
          <Route path="/ops" element={<div>Dashboard</div>} />
          <Route path="/ops/cleaning" element={<div>Cleaning</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

const adminSession = {
  authenticated: true,
  actorId: 'admin-1',
  role: 'admin',
  modules: ['*'],
  actions: ['ops.users.manage'],
  defaultRoute: '/ops',
  locale: 'en'
};

const operatorSession = {
  authenticated: true,
  actorId: 'op-1',
  role: 'operator',
  modules: ['dashboard', 'calendar', 'reservations', 'finance', 'property', 'guests_comms', 'operations', 'cleaning'],
  actions: [],
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

describe('Ops design-system route access', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('lets an admin stay on /ops/design-system', async () => {
    renderOpsRoute(adminSession);
    await waitFor(() => {
      expect(screen.getByTestId('ops-location')).toHaveTextContent('/ops/design-system');
      expect(screen.getByRole('heading', { name: 'Design system' })).toBeInTheDocument();
    });
  });

  it('sends an operator to the session defaultRoute', async () => {
    renderOpsRoute(operatorSession);
    await waitFor(() => {
      expect(screen.getByTestId('ops-location').textContent).toBe('/ops');
    });
    expect(screen.queryByRole('heading', { name: 'Design system' })).not.toBeInTheDocument();
  });

  it('sends a cleaner to the session defaultRoute', async () => {
    renderOpsRoute(cleanerSession);
    await waitFor(() => {
      expect(screen.getByTestId('ops-location').textContent).toBe('/ops/cleaning');
    });
    expect(screen.queryByRole('heading', { name: 'Design system' })).not.toBeInTheDocument();
  });
});
