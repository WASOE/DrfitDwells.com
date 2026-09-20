import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OpsTopBar, { getOpsTopBarContext } from './OpsTopBar';
import { OPS_SIDEBAR_COLLAPSED, OPS_SIDEBAR_EXPANDED } from './opsSidebarState';

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

afterEach(() => {
  cleanup();
});

const adminSession = {
  authenticated: true,
  actorId: 'admin-1',
  role: 'admin'
};

function renderTopBar(pathname, props = {}) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <OpsTopBar
        mode={OPS_SIDEBAR_EXPANDED}
        session={adminSession}
        onToggle={vi.fn()}
        onLogout={vi.fn()}
        {...props}
      />
    </MemoryRouter>
  );
}

describe('getOpsTopBarContext', () => {
  it('uses the active nav label, including detail routes and the hidden design-system page', () => {
    expect(getOpsTopBarContext('/ops')).toBe('Dashboard');
    expect(getOpsTopBarContext('/ops/manual-review')).toBe('Manual');
    expect(getOpsTopBarContext('/ops/calendar')).toBe('Calendar');
    expect(getOpsTopBarContext('/ops/calendar/work-windows')).toBe('Work windows');
    expect(getOpsTopBarContext('/ops/calendar/cabin-id')).toBe('Calendar');
    expect(getOpsTopBarContext('/ops/reservations')).toBe('Reservations');
    expect(getOpsTopBarContext('/ops/reservations/123')).toBe('Reservations');
    expect(getOpsTopBarContext('/ops/gift-vouchers/123')).toBe('Gift vouchers');
    expect(getOpsTopBarContext('/ops/cabins/123')).toBe('Cabins');
    expect(getOpsTopBarContext('/ops/insights/performance')).toBe('Historical performance');
    expect(getOpsTopBarContext('/ops/conversion/recovery')).toBe('Quote recovery');
    expect(getOpsTopBarContext('/ops/settings/cleaning')).toBe('Cleaning settings');
    expect(getOpsTopBarContext('/ops/design-system')).toBe('Design system');
  });
});

describe('OpsTopBar', () => {
  it('renders the 48px top bar with toggle, context, bell, role, and logout', () => {
    const onToggle = vi.fn();
    const onLogout = vi.fn();
    renderTopBar('/ops/reservations/123', { onToggle, onLogout });
    const bar = screen.getByTestId('ops-topbar');
    expect(bar).toHaveClass('ops-topbar');
    expect(bar.tagName).toBe('HEADER');
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByTestId('ops-topbar-context')).toHaveTextContent('Reservations');
    expect(screen.getByTestId('ops-topbar-search-slot')).toBeInTheDocument();
    expect(bar.querySelector('input')).toBeNull();
    expect(screen.getByTestId('ops-notification-bell')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByTestId('ops-logout')).toHaveTextContent('Logout');
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', 'ops-sidebar');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('ops-logout'));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('relabels the toggle when the sidebar is collapsed', () => {
    renderTopBar('/ops/insights/performance', { mode: OPS_SIDEBAR_COLLAPSED });
    const toggle = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('ops-topbar-context')).toHaveTextContent('Historical performance');
  });
});
