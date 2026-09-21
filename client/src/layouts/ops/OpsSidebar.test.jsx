import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import OpsSidebar, { GROUP_ICONS } from './OpsSidebar';
import { OPS_SIDEBAR_COLLAPSED, OPS_SIDEBAR_EXPANDED } from './opsSidebarState';

afterEach(() => {
  cleanup();
});

const fullAdminSession = {
  authenticated: true,
  role: 'admin',
  modules: ['*'],
  actions: ['ops.users.manage', 'ops.cleaning.view', 'ops.cleaning.settings_read']
};

function renderSidebar(pathname, session = fullAdminSession, mode = OPS_SIDEBAR_EXPANDED) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <OpsSessionProvider session={session}>
        <OpsSidebar mode={mode} />
      </OpsSessionProvider>
    </MemoryRouter>
  );
}

function groupOrder() {
  return [...document.querySelectorAll('[data-ops-group]')].map((el) => el.getAttribute('data-ops-group'));
}

describe('OpsSidebar grouping and permissions', () => {
  it('renders the eight locked groups in order when fully authorized', () => {
    renderSidebar('/ops');
    expect(groupOrder()).toEqual([
      'home',
      'calendar',
      'guests',
      'finance',
      'property',
      'cleaning',
      'insights',
      'admin'
    ]);
    expect(GROUP_ICONS.House).toBeTruthy();
    expect(GROUP_ICONS.ChartSpline).toBeTruthy();
    expect(screen.getByTestId('ops-sidebar-admin')).toBeInTheDocument();
    expect(screen.getByTestId('ops-sidebar-brand')).toBeInTheDocument();
    expect(screen.getByTestId('ops-sidebar-brand-wordmark')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manual' })).toBeInTheDocument();
  });

  it('hides inaccessible children and empty groups', () => {
    renderSidebar('/ops', {
      authenticated: true,
      modules: ['dashboard'],
      actions: []
    });
    expect(groupOrder()).toEqual(['home']);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Manual' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('ops-sidebar-admin')).not.toBeInTheDocument();
  });

  it('keeps mixed Guests permissions as Reservations-only', () => {
    renderSidebar('/ops/reservations', {
      authenticated: true,
      modules: ['reservations'],
      actions: []
    });
    expect(screen.getByRole('link', { name: 'Reservations' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Messaging' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Comms' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reviews' })).not.toBeInTheDocument();
  });

  it('preserves the Users action gate', () => {
    renderSidebar('/ops/readiness', {
      authenticated: true,
      role: 'admin',
      modules: ['*'],
      actions: []
    });
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Readiness' })).toBeInTheDocument();
  });

  it('preserves the Cleaning settings action gate', () => {
    renderSidebar('/ops/cleaning', {
      authenticated: true,
      modules: ['cleaning'],
      actions: ['ops.cleaning.view']
    });
    expect(screen.getByRole('link', { name: 'Cleaning' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Cleaning settings' })).not.toBeInTheDocument();
  });

  it('keeps Insights finance-backed and Manual operations-backed', () => {
    renderSidebar('/ops/insights', {
      authenticated: true,
      modules: ['finance'],
      actions: []
    });
    expect(screen.getByRole('link', { name: 'Insights' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quote recovery' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Manual' })).not.toBeInTheDocument();

    cleanup();
    renderSidebar('/ops/manual-review', {
      authenticated: true,
      modules: ['operations'],
      actions: []
    });
    expect(screen.getByRole('link', { name: 'Manual' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Insights' })).not.toBeInTheDocument();
  });
});

describe('OpsSidebar active matching', () => {
  const cases = [
    ['/ops', 'Dashboard', 'home'],
    ['/ops/manual-review', 'Manual', 'home'],
    ['/ops/calendar', 'Calendar', 'calendar'],
    ['/ops/calendar/work-windows', 'Work windows', 'calendar'],
    ['/ops/calendar/cabin-id', 'Calendar', 'calendar'],
    ['/ops/reservations', 'Reservations', 'guests'],
    ['/ops/reservations/123', 'Reservations', 'guests'],
    ['/ops/gift-vouchers/123', 'Gift vouchers', 'finance'],
    ['/ops/cabins/123', 'Cabins', 'property'],
    ['/ops/insights/performance', 'Historical performance', 'insights'],
    ['/ops/conversion/recovery', 'Quote recovery', 'insights'],
    ['/ops/settings/cleaning', 'Cleaning settings', 'cleaning']
  ];

  it.each(cases)('%s selects %s in %s', (pathname, label, groupId) => {
    renderSidebar(pathname);
    const current = screen.getByRole('link', { name: label });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(document.querySelector(`[data-ops-group="${groupId}"]`)).toHaveAttribute('data-active', 'true');
    expect(screen.getAllByRole('link', { current: 'page' })).toHaveLength(1);
  });

  it('does not select a nav item for /ops/design-system', () => {
    renderSidebar('/ops/design-system');
    expect(screen.queryByRole('link', { current: 'page' })).not.toBeInTheDocument();
    expect(document.querySelector('[data-ops-group][data-active="true"]')).toBeNull();
  });

  it('does not let Calendar steal Work windows or Insights steal Historical performance', () => {
    renderSidebar('/ops/calendar/work-windows');
    expect(screen.getByRole('link', { name: 'Work windows' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Calendar' })).not.toHaveAttribute('aria-current');

    cleanup();
    renderSidebar('/ops/insights/performance');
    expect(screen.getByRole('link', { name: 'Historical performance' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Insights' })).not.toHaveAttribute('aria-current');

    cleanup();
    renderSidebar('/ops/conversion/recovery');
    expect(screen.getByRole('link', { name: 'Quote recovery' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Conversion' })).not.toHaveAttribute('aria-current');
  });
});

describe('OpsSidebar expanded behavior', () => {
  it('opens the active group, marks the active child, and uses 240px expanded mode', () => {
    renderSidebar('/ops/reservations');
    expect(screen.getByTestId('ops-sidebar')).toHaveAttribute('data-mode', OPS_SIDEBAR_EXPANDED);
    expect(screen.getByTestId('ops-sidebar')).toHaveClass('ops-sidebar--expanded');
    expect(screen.getByRole('link', { name: 'Reservations' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Guests' })).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('[data-ops-group="guests"]')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('ops-sidebar-admin')).toBeInTheDocument();
  });

  it('opens another group when its header is clicked', () => {
    renderSidebar('/ops');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Property' }));
    expect(screen.getByRole('button', { name: 'Property' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Cabins' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
  });
});

describe('OpsSidebar collapsed flyout', () => {
  it('uses 56px collapsed mode with accessible icon controls and no persistent group labels', () => {
    renderSidebar('/ops', fullAdminSession, OPS_SIDEBAR_COLLAPSED);
    expect(screen.getByTestId('ops-sidebar')).toHaveAttribute('data-mode', OPS_SIDEBAR_COLLAPSED);
    expect(screen.getByTestId('ops-sidebar')).toHaveClass('ops-sidebar--collapsed');
    expect(screen.getByTestId('ops-sidebar-brand-mark')).toBeInTheDocument();
    expect(screen.queryByTestId('ops-sidebar-brand-wordmark')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Guests')).not.toBeInTheDocument();
    expect(document.querySelector('[data-ops-group="home"]')).toHaveAttribute('data-active', 'true');
  });

  it('shows an OpsTooltip on focus', () => {
    renderSidebar('/ops/calendar', fullAdminSession, OPS_SIDEBAR_COLLAPSED);
    fireEvent.focus(screen.getByRole('button', { name: 'Calendar' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Calendar');
  });

  it('opens a labelled flyout with child links, replaces it, and closes on Escape or navigation', () => {
    renderSidebar('/ops', fullAdminSession, OPS_SIDEBAR_COLLAPSED);
    const calendar = screen.getByRole('button', { name: 'Calendar' });
    fireEvent.click(calendar);
    expect(calendar).toHaveAttribute('aria-expanded', 'true');
    const flyout = screen.getByTestId('ops-sidebar-flyout');
    expect(flyout).toHaveTextContent('Calendar');
    expect(screen.getByRole('link', { name: 'Work windows' })).toBeInTheDocument();
    expect(document.querySelector('.ops-overlay')).toBeNull();
    expect(screen.getByRole('link', { name: 'Work windows' })).not.toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Finance' }));
    expect(screen.getByTestId('ops-sidebar-flyout')).toHaveAttribute('data-ops-flyout', 'finance');
    expect(screen.getByRole('link', { name: 'Gift vouchers' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Work windows' })).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('ops-sidebar-flyout')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Guests' }));
    fireEvent.click(screen.getByRole('link', { name: 'Reservations' }));
    expect(screen.queryByTestId('ops-sidebar-flyout')).not.toBeInTheDocument();
  });

  it('closes the flyout on Escape from the group trigger', () => {
    renderSidebar('/ops', fullAdminSession, OPS_SIDEBAR_COLLAPSED);
    const calendar = screen.getByRole('button', { name: 'Calendar' });
    fireEvent.click(calendar);
    expect(screen.getByTestId('ops-sidebar-flyout')).toBeInTheDocument();
    calendar.focus();
    fireEvent.keyDown(calendar, { key: 'Escape' });
    expect(screen.queryByTestId('ops-sidebar-flyout')).not.toBeInTheDocument();
    expect(calendar).toHaveFocus();
  });

  it('closes the flyout on Escape from a child link and restores the group trigger', () => {
    renderSidebar('/ops', fullAdminSession, OPS_SIDEBAR_COLLAPSED);
    fireEvent.click(screen.getByRole('button', { name: 'Admin' }));
    const users = screen.getByRole('link', { name: 'Users' });
    users.focus();
    expect(users).toHaveFocus();
    fireEvent.keyDown(users, { key: 'Escape' });
    expect(screen.queryByTestId('ops-sidebar-flyout')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Admin' })).toHaveFocus();
  });

  it('does nothing on Escape when no flyout is open', () => {
    renderSidebar('/ops', fullAdminSession, OPS_SIDEBAR_COLLAPSED);
    const home = screen.getByRole('button', { name: 'Home' });
    home.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('ops-sidebar-flyout')).not.toBeInTheDocument();
    expect(home).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Calendar' })).toBeInTheDocument();
  });

  it('keeps group tooltips available until a flyout opens, then suppresses them', () => {
    renderSidebar('/ops', fullAdminSession, OPS_SIDEBAR_COLLAPSED);
    const calendar = screen.getByRole('button', { name: 'Calendar' });
    fireEvent.focus(calendar);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Calendar');

    fireEvent.click(calendar);
    expect(screen.getByTestId('ops-sidebar-flyout')).toBeInTheDocument();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.focus(screen.getByRole('button', { name: 'Home' }));
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Home' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('ops-sidebar-flyout')).not.toBeInTheDocument();
    fireEvent.blur(screen.getByRole('button', { name: 'Calendar' }));
    fireEvent.focus(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Home');
  });

  it('marks the collapsed active group with both an indicator and a surface treatment', () => {
    renderSidebar('/ops/reservations', fullAdminSession, OPS_SIDEBAR_COLLAPSED);
    const guests = screen.getByRole('button', { name: 'Guests' });
    expect(document.querySelector('[data-ops-group="guests"]')).toHaveAttribute('data-active', 'true');
    expect(guests).toHaveClass('ops-sidebar-group-btn--active');
    expect(guests).toHaveClass('ops-sidebar-group-btn--collapsed');
    expect(screen.getByRole('button', { name: 'Calendar' })).not.toHaveClass('ops-sidebar-group-btn--active');
  });

  it('recalculates flyout position when the viewport resizes', () => {
    const originalInnerHeight = window.innerHeight;
    window.innerHeight = 1024;

    const rectFor = (top, height, left = 0, width = 56) => ({
      x: left,
      y: top,
      top,
      left,
      right: left + width,
      bottom: top + height,
      width,
      height,
      toJSON() {}
    });

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mockRect() {
      if (this.getAttribute?.('data-testid') === 'ops-sidebar-flyout') {
        return rectFor(0, 160, 56, 240);
      }
      if (this.classList?.contains('ops-sidebar-group-btn')) {
        return rectFor(540, 40, 0, 56);
      }
      return rectFor(0, 0);
    });
    const offsetDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        if (this.getAttribute?.('data-testid') === 'ops-sidebar-flyout') return 160;
        return 40;
      }
    });

    try {
      renderSidebar('/ops', fullAdminSession, OPS_SIDEBAR_COLLAPSED);
      fireEvent.click(screen.getByRole('button', { name: 'Admin' }));
      const flyout = screen.getByTestId('ops-sidebar-flyout');
      expect(flyout.style.top).toBe('540px');

      window.innerHeight = 600;
      fireEvent(window, new Event('resize'));
      expect(flyout.style.top).toBe('432px');
      expect(Number.parseFloat(flyout.style.top) + 160).toBeLessThanOrEqual(600);
    } finally {
      window.innerHeight = originalInnerHeight;
      HTMLElement.prototype.getBoundingClientRect.mockRestore();
      if (offsetDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetDescriptor);
      } else {
        delete HTMLElement.prototype.offsetHeight;
      }
    }
  });
});
