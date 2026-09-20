import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpsLayout, { OPS_MAIN_LEGACY_CLASSNAME, OPS_MAIN_OWNED_CLASSNAME } from '../OpsLayout';
import OpsPage from '../../ops/primitives/OpsPage';

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

const adminSession = {
  authenticated: true,
  actorId: 'admin-1',
  role: 'admin',
  modules: ['*'],
  actions: ['ops.users.manage', 'ops.cleaning.view', 'ops.cleaning.settings_read'],
  defaultRoute: '/ops',
  locale: 'en'
};

const healthyHealth = {
  dependencies: {
    stripeWebhookLastSeenAt: '2026-01-01T00:00:00.000Z',
    syncLastSeenByCabinChannel: []
  }
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

function LegacyPage() {
  const navigate = useNavigate();
  return (
    <div data-testid="legacy-page">
      <button type="button" onClick={() => navigate('/ops/migrated')}>
        Open migrated
      </button>
    </div>
  );
}

function MigratedPage() {
  const navigate = useNavigate();
  return (
    <OpsPage width="wide">
      <div data-testid="migrated-page">
        <button type="button" onClick={() => navigate('/ops')}>
          Open legacy
        </button>
      </div>
    </OpsPage>
  );
}

function FullPage() {
  return (
    <OpsPage width="full">
      <div data-testid="full-page">Spatial</div>
    </OpsPage>
  );
}

function renderShell(initialPath) {
  opsReadAPI.session.mockResolvedValue({ data: { success: true, data: adminSession } });
  opsReadAPI.health.mockResolvedValue({ data: { data: healthyHealth } });
  localStorage.setItem('adminToken', 'test-token');
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<OpsLayout />}>
          <Route path="/ops" element={<LegacyPage />} />
          <Route path="/ops/migrated" element={<MigratedPage />} />
          <Route path="/ops/full" element={<FullPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('OpsLayout page-width opt-in', () => {
  beforeEach(() => {
    stubMatchMedia();
    localStorage.clear();
    window.innerWidth = 1280;
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('keeps the exact legacy max-w-7xl main class on unmigrated pages', async () => {
    renderShell('/ops');
    await waitFor(() => {
      expect(screen.getByTestId('legacy-page')).toBeInTheDocument();
    });
    const main = screen.getByTestId('ops-main');
    expect(main).toHaveAttribute('data-ops-page-owns-width', 'false');
    expect(main).toHaveClass('max-w-7xl');
    expect(main.className).toBe(OPS_MAIN_LEGACY_CLASSNAME);
    expect(main).not.toHaveClass('ops-main--owned');
  });

  it('disables the legacy shell max-width while OpsPage is mounted', async () => {
    renderShell('/ops/migrated');
    await waitFor(() => {
      expect(screen.getByTestId('migrated-page')).toBeInTheDocument();
    });
    const main = screen.getByTestId('ops-main');
    expect(main).toHaveAttribute('data-ops-page-owns-width', 'true');
    expect(main.className).toBe(OPS_MAIN_OWNED_CLASSNAME);
    expect(main).not.toHaveClass('max-w-7xl');
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');
  });

  it('restores the legacy cap after OpsPage unmounts', async () => {
    const { unmount } = renderShell('/ops/migrated');
    await waitFor(() => {
      expect(screen.getByTestId('ops-main')).toHaveAttribute('data-ops-page-owns-width', 'true');
    });
    unmount();
    renderShell('/ops');
    await waitFor(() => {
      expect(screen.getByTestId('legacy-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ops-main').className).toBe(OPS_MAIN_LEGACY_CLASSNAME);
  });

  it('switches legacy → OpsPage → legacy without pathname width maps', async () => {
    renderShell('/ops');
    await waitFor(() => {
      expect(screen.getByTestId('legacy-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ops-main').className).toBe(OPS_MAIN_LEGACY_CLASSNAME);

    fireEvent.click(screen.getByRole('button', { name: 'Open migrated' }));
    await waitFor(() => {
      expect(screen.getByTestId('migrated-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ops-main').className).toBe(OPS_MAIN_OWNED_CLASSNAME);
    expect(screen.getByTestId('ops-page')).toHaveAttribute('data-ops-page-width', 'wide');

    fireEvent.click(screen.getByRole('button', { name: 'Open legacy' }));
    await waitFor(() => {
      expect(screen.getByTestId('legacy-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ops-main').className).toBe(OPS_MAIN_LEGACY_CLASSNAME);
    expect(screen.queryByTestId('ops-page')).not.toBeInTheDocument();
  });

  it('keeps full width inside the application main column', async () => {
    renderShell('/ops/full');
    await waitFor(() => {
      expect(screen.getByTestId('full-page')).toBeInTheDocument();
    });
    const main = screen.getByTestId('ops-main');
    const page = screen.getByTestId('ops-page');
    expect(main).toContainElement(page);
    expect(page).toHaveClass('ops-page--full');
    expect(page.className).not.toMatch(/100vw|w-screen/);
  });
});

describe('OpsLayout page-width source architecture', () => {
  it('does not hardcode route widths and keeps shell min-width 0', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const layoutSrc = fs.readFileSync(path.resolve(here, '../OpsLayout.jsx'), 'utf8');
    const shellCss = fs.readFileSync(path.resolve(here, 'opsShell.css'), 'utf8');
    expect(layoutSrc).toContain('useOpsPageOwnsWidth');
    expect(layoutSrc).toContain('OpsPageWidthProvider');
    expect(layoutSrc).not.toMatch(/\/ops\/[a-z-]+['"]\s*:\s*['"](?:narrow|default|wide|full)/);
    expect(layoutSrc).not.toMatch(/matchOpsNavItem\([^)]*width/);
    expect(shellCss).toMatch(/\.ops-shell-main\s*\{[^}]*min-width:\s*0/);
    expect(shellCss).toMatch(/minmax\(0,\s*1fr\)/);
    expect(OPS_MAIN_LEGACY_CLASSNAME).toContain('max-w-7xl');
    expect(OPS_MAIN_OWNED_CLASSNAME).toBe('ops-main ops-main--owned');
  });
});
