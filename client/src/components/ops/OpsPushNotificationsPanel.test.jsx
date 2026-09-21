import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import OpsPushNotificationsPanel from './OpsPushNotificationsPanel';

vi.mock('../../context/OpsPushNotificationsContext', () => ({
  useOpsPushNotificationsContext: vi.fn()
}));

vi.mock('../../services/opsApi', () => ({
  sendOpsPushTestNotification: vi.fn()
}));

import { useOpsPushNotificationsContext } from '../../context/OpsPushNotificationsContext';
import { sendOpsPushTestNotification } from '../../services/opsApi';

function mockPush(overrides = {}) {
  useOpsPushNotificationsContext.mockReturnValue({
    loading: false,
    busy: false,
    readiness: 'subscribed',
    errorMessage: '',
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    isAdmin: true,
    health: {
      pushEnabled: true,
      scheduledEnabled: true,
      workerEnabled: true,
      worker: { running: true },
      subscriptions: { active: 2 },
      scheduledJobs: { failed: 0 }
    },
    healthError: '',
    attention: null,
    ...overrides
  });
}

describe('OpsPushNotificationsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPush();
  });

  it('shows admin test button when subscribed', () => {
    render(<OpsPushNotificationsPanel />);
    expect(screen.getByTestId('ops-push-send-test')).toBeTruthy();
    expect(screen.getByTestId('ops-push-disable')).toBeTruthy();
    cleanup();
  });

  it('hides admin test button and health for non-admin users', () => {
    mockPush({ isAdmin: false, health: null });
    render(<OpsPushNotificationsPanel />);
    expect(screen.queryByTestId('ops-push-send-test')).toBeNull();
    expect(screen.queryByTestId('ops-push-health')).toBeNull();
    expect(screen.getByTestId('ops-push-disable')).toBeTruthy();
    cleanup();
  });

  it('shows admin push health summary', async () => {
    render(<OpsPushNotificationsPanel />);
    const health = await screen.findByTestId('ops-push-health');
    expect(health.textContent).toContain('Push configured: yes');
    expect(health.textContent).toContain('Active subs: 2');
    expect(screen.getByText('Configured')).toBeTruthy();
    expect(screen.getByText('Active devices')).toBeTruthy();
    cleanup();
  });

  it('calls test endpoint and shows success feedback', async () => {
    sendOpsPushTestNotification.mockResolvedValue({
      data: {
        success: true,
        data: {
          notificationsCreated: 1,
          pushAccepted: 1
        }
      }
    });

    render(<OpsPushNotificationsPanel />);
    fireEvent.click(screen.getByTestId('ops-push-send-test'));

    expect(sendOpsPushTestNotification).toHaveBeenCalledTimes(1);
    const feedback = await screen.findByTestId('ops-push-test-feedback');
    expect(feedback.textContent).toContain('Test notification sent');
    cleanup();
  });

  it('shows enable action when ready to subscribe', () => {
    mockPush({ readiness: 'ready_to_subscribe', health: null, isAdmin: false });
    render(<OpsPushNotificationsPanel />);
    expect(screen.getByTestId('ops-push-enable')).toBeTruthy();
    expect(screen.queryByTestId('ops-push-disable')).toBeNull();
    cleanup();
  });
});
