import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import OpsPushNotificationsPanel from './OpsPushNotificationsPanel';

vi.mock('../../hooks/useOpsPushNotifications', () => ({
  useOpsPushNotifications: vi.fn()
}));

vi.mock('../../context/OpsSessionContext', () => ({
  useOpsSession: vi.fn()
}));

vi.mock('../../services/opsApi', () => ({
  sendOpsPushTestNotification: vi.fn()
}));

import { useOpsPushNotifications } from '../../hooks/useOpsPushNotifications';
import { useOpsSession } from '../../context/OpsSessionContext';
import { sendOpsPushTestNotification } from '../../services/opsApi';

describe('OpsPushNotificationsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOpsSession.mockReturnValue({ role: 'admin' });
    useOpsPushNotifications.mockReturnValue({
      loading: false,
      busy: false,
      readiness: 'subscribed',
      errorMessage: '',
      subscribe: vi.fn(),
      unsubscribe: vi.fn()
    });
  });

  it('shows admin test button when subscribed', () => {
    render(<OpsPushNotificationsPanel actorId="507f1f77bcf86cd799439011" />);
    expect(screen.getByTestId('ops-push-send-test')).toBeTruthy();
    cleanup();
  });

  it('hides admin test button for non-admin users', () => {
    useOpsSession.mockReturnValue({ role: 'operator' });
    render(<OpsPushNotificationsPanel actorId="507f1f77bcf86cd799439011" />);
    expect(screen.queryByTestId('ops-push-send-test')).toBeNull();
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

    render(<OpsPushNotificationsPanel actorId="507f1f77bcf86cd799439011" />);
    fireEvent.click(screen.getByTestId('ops-push-send-test'));

    expect(sendOpsPushTestNotification).toHaveBeenCalledTimes(1);
    const feedback = await screen.findByTestId('ops-push-test-feedback');
    expect(feedback.textContent).toContain('Test notification sent');
    cleanup();
  });
});
