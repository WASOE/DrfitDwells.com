import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import OpsDashboardPushAttention from './OpsDashboardPushAttention';

vi.mock('../../context/OpsPushNotificationsContext', () => ({
  useOptionalOpsPushNotificationsContext: vi.fn()
}));

import { useOptionalOpsPushNotificationsContext } from '../../context/OpsPushNotificationsContext';

describe('OpsDashboardPushAttention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing in healthy state', () => {
    useOptionalOpsPushNotificationsContext.mockReturnValue({
      attention: null,
      busy: false,
      subscribe: vi.fn()
    });
    const { container } = render(<OpsDashboardPushAttention />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('ops-dashboard-push-attention')).toBeNull();
  });

  it('renders a compact enable warning when device push is disabled', () => {
    const subscribe = vi.fn();
    useOptionalOpsPushNotificationsContext.mockReturnValue({
      attention: {
        key: 'device_disabled',
        message: 'Push notifications are disabled on this device.',
        action: 'enable'
      },
      busy: false,
      subscribe
    });
    render(<OpsDashboardPushAttention />);
    expect(screen.getByTestId('ops-dashboard-push-attention')).toBeTruthy();
    expect(screen.getByText('Push notifications are disabled on this device.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('ops-dashboard-push-enable'));
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('renders worker unavailable attention without enable control', () => {
    useOptionalOpsPushNotificationsContext.mockReturnValue({
      attention: {
        key: 'worker_down',
        message: 'Push notification worker is unavailable. Check notifications.',
        action: 'open_bell'
      },
      busy: false,
      subscribe: vi.fn()
    });
    render(<OpsDashboardPushAttention />);
    expect(screen.getByText(/worker is unavailable/i)).toBeTruthy();
    expect(screen.queryByTestId('ops-dashboard-push-enable')).toBeNull();
  });
});
