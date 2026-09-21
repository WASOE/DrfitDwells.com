import { useState } from 'react';
import { useOpsPushNotificationsContext } from '../../context/OpsPushNotificationsContext';
import { sendOpsPushTestNotification } from '../../services/opsApi';
import { formatPushWorkerLabel, formatPushYesNo } from '../../utils/opsPushAttention';

const READINESS_COPY = {
  unsupported: 'This browser does not support push notifications.',
  needs_install:
    'Add Drift & Dwells to Home Screen, open it from the icon, then enable notifications.',
  permission_denied:
    'Notifications are blocked for this site. Enable them in browser settings to use OPS push.',
  push_not_configured: 'Push is not configured on the server yet.',
  ready_to_subscribe: 'Receive OPS alerts on this device when you are signed in.',
  subscribed: 'Enabled',
  error: 'Push setup failed. Try again or contact an admin.',
  ops_user_required: 'Push requires an OPS user account. Sign in with a cleaner, operator, or admin user.'
};

function formatTestFeedback(response, err) {
  if (err) {
    const status = err?.response?.status;
    const message = err?.response?.data?.message;
    if (status === 429) {
      return message || 'Test notification already sent this minute.';
    }
    if (status === 403) {
      return message || 'You do not have permission to send a test notification.';
    }
    return message || 'Could not send test notification.';
  }

  const data = response?.data?.data;
  if (response?.data?.success === false) {
    return response?.data?.message || 'Could not send test notification.';
  }
  if (data?.skipped) {
    return 'Push is not configured on the server.';
  }
  if ((data?.notificationsCreated || 0) > 0) {
    return 'Test notification sent. Check your device and the bell inbox.';
  }
  return 'Test notification request completed.';
}

function deviceStatusLabel(readiness) {
  if (readiness === 'subscribed') {
    return 'Enabled';
  }
  if (readiness === 'ready_to_subscribe') {
    return 'Disabled';
  }
  if (readiness === 'permission_denied') {
    return 'Blocked';
  }
  if (readiness === 'push_not_configured') {
    return 'Not configured';
  }
  if (readiness === 'needs_install') {
    return 'Needs install';
  }
  if (readiness === 'loading') {
    return '…';
  }
  return READINESS_COPY[readiness] || 'Unavailable';
}

/**
 * Compact push status/controls for the notification dropdown.
 * Does not render the legacy full-width layout strip.
 */
export default function OpsPushNotificationsPanel() {
  const {
    loading,
    busy,
    readiness,
    errorMessage,
    subscribe,
    unsubscribe,
    isAdmin,
    health,
    healthError
  } = useOpsPushNotificationsContext();
  const [testBusy, setTestBusy] = useState(false);
  const [testFeedback, setTestFeedback] = useState('');

  const showTestButton = isAdmin && readiness === 'subscribed';
  const showEnable = readiness === 'ready_to_subscribe' || readiness === 'error';
  const showDisable = readiness === 'subscribed';

  const handleSendTest = async () => {
    setTestBusy(true);
    setTestFeedback('');
    try {
      const response = await sendOpsPushTestNotification();
      setTestFeedback(formatTestFeedback(response, null));
    } catch (err) {
      setTestFeedback(formatTestFeedback(null, err));
    } finally {
      setTestBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="ops-push-dropdown" data-testid="ops-push-panel">
        <p className="ops-push-dropdown__title">Push notifications</p>
        <p className="ops-push-dropdown__meta">Loading…</p>
      </div>
    );
  }

  return (
    <div
      className="ops-push-dropdown"
      data-testid={readiness === 'subscribed' ? 'ops-push-panel-subscribed' : 'ops-push-panel'}
    >
      <p className="ops-push-dropdown__title">Push notifications</p>

      <dl className="ops-push-dropdown__grid">
        <div className="ops-push-dropdown__row">
          <dt>On this device</dt>
          <dd data-testid="ops-push-device-status">{deviceStatusLabel(readiness)}</dd>
        </div>
        {isAdmin ? (
          healthError ? (
            <div className="ops-push-dropdown__row ops-push-dropdown__row--wide">
              <dt>Health</dt>
              <dd data-testid="ops-push-health">{healthError}</dd>
            </div>
          ) : health ? (
            <>
              <div className="ops-push-dropdown__row">
                <dt>Configured</dt>
                <dd>{formatPushYesNo(health.pushEnabled)}</dd>
              </div>
              <div className="ops-push-dropdown__row">
                <dt>Scheduled</dt>
                <dd>{formatPushYesNo(health.scheduledEnabled)}</dd>
              </div>
              <div className="ops-push-dropdown__row">
                <dt>Worker</dt>
                <dd>{formatPushWorkerLabel(health)}</dd>
              </div>
              <div className="ops-push-dropdown__row">
                <dt>Active devices</dt>
                <dd>{health.subscriptions?.active ?? 0}</dd>
              </div>
              <div className="ops-push-dropdown__row">
                <dt>Failed jobs</dt>
                <dd>{health.scheduledJobs?.failed ?? 0}</dd>
              </div>
              <p className="ops-push-dropdown__sr-health" data-testid="ops-push-health">
                Push configured: {health.pushEnabled ? 'yes' : 'no'} · Scheduled:{' '}
                {health.scheduledEnabled ? 'yes' : 'no'} · Worker:{' '}
                {!health.workerEnabled ? 'off' : health.worker?.running ? 'yes' : 'no'} · Active
                subs: {health.subscriptions?.active ?? 0} · Failed jobs:{' '}
                {health.scheduledJobs?.failed ?? 0}
              </p>
            </>
          ) : null
        ) : null}
      </dl>

      {readiness !== 'subscribed' && readiness !== 'ready_to_subscribe' ? (
        <p className="ops-push-dropdown__hint">
          {READINESS_COPY[readiness] || READINESS_COPY.error}
          {errorMessage && readiness === 'error' ? ` ${errorMessage}` : ''}
        </p>
      ) : null}

      <div className="ops-push-dropdown__actions">
        {showEnable ? (
          <button
            type="button"
            onClick={subscribe}
            disabled={busy}
            className="ops-push-dropdown__button ops-push-dropdown__button--primary"
            data-testid="ops-push-enable"
          >
            {busy ? 'Enabling…' : 'Enable'}
          </button>
        ) : null}
        {showTestButton ? (
          <button
            type="button"
            onClick={() => {
              void handleSendTest();
            }}
            disabled={busy || testBusy}
            className="ops-push-dropdown__button"
            data-testid="ops-push-send-test"
          >
            {testBusy ? 'Sending…' : 'Send test'}
          </button>
        ) : null}
        {showDisable ? (
          <button
            type="button"
            onClick={unsubscribe}
            disabled={busy || testBusy}
            className="ops-push-dropdown__button"
            data-testid="ops-push-disable"
          >
            {busy ? 'Turning off…' : 'Turn off'}
          </button>
        ) : null}
      </div>

      {testFeedback ? (
        <p className="ops-push-dropdown__hint" data-testid="ops-push-test-feedback" role="status">
          {testFeedback}
        </p>
      ) : null}
    </div>
  );
}
