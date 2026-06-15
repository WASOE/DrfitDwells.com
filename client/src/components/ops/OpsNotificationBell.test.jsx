import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import OpsNotificationBell from './OpsNotificationBell';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn()
}));

vi.mock('../../hooks/useOpsNotifications', () => ({
  useOpsNotifications: () => ({
    enabled: true,
    unreadCount: 12,
    notifications: [],
    listLoading: false,
    listError: '',
    markAllBusy: false,
    refreshInbox: vi.fn(),
    markOneRead: vi.fn(),
    markAllRead: vi.fn()
  })
}));

describe('OpsNotificationBell', () => {
  it('renders unread badge capped at 9+', () => {
    render(<OpsNotificationBell actorId="507f1f77bcf86cd799439011" />);
    expect(screen.getByTestId('ops-notification-badge').textContent).toBe('9+');
  });
});
