import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import OpsNotificationDropdown from './OpsNotificationDropdown';

describe('OpsNotificationDropdown', () => {
  it('calls mark all read handler', () => {
    const onMarkAllRead = vi.fn();
    render(
      <OpsNotificationDropdown
        notifications={[]}
        loading={false}
        error=""
        unreadCount={2}
        markAllBusy={false}
        onMarkAllRead={onMarkAllRead}
        onNotificationClick={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('ops-notification-mark-all'));
    expect(onMarkAllRead).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('disables mark all when unread count is zero', () => {
    render(
      <OpsNotificationDropdown
        notifications={[]}
        loading={false}
        error=""
        unreadCount={0}
        markAllBusy={false}
        onMarkAllRead={vi.fn()}
        onNotificationClick={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    const button = screen.getByTestId('ops-notification-mark-all');
    expect(button.disabled).toBe(true);
    cleanup();
  });
});
