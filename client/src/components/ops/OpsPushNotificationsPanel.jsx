import { useEffect, useState } from 'react';
import { useOpsPushNotifications } from '../../hooks/useOpsPushNotifications';
import { useOpsSession } from '../../context/OpsSessionContext';
import { getOpsPushHealth, sendOpsPushTestNotification } from '../../services/opsApi';

const READINESS_COPY = {
  unsupported: 'This browser does not support push notifications.',
  needs_install:
    'Add Drift & Dwells to Home Screen, open it from the icon, then enable notifications.',
  permission_denied: 'Notifications are blocked for this site. Enable them in browser settings to use OPS push.',
  push_not_configured: 'Push is not configured on the server yet.',
  ready_to_subscribe: 'Receive OPS alerts on this device when you are signed in.',
  subscribed: 'Push notifications are enabled on this device.',
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

function formatWorkerHealth(health) {
  if (!health?.workerEnabled) {
    return 'off';
  }
  return health.worker?.running ? 'yes' : 'no';
}

function OpsPushHealthSummary() {
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void getOpsPushHealth()
      .then((resp) => {
        if (cancelled) {
          return;
        }
        setHealth(resp?.data?.data || null);
        setHealthError('');
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setHealth(null);
        setHealthError('Could not load push health.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (healthError) {
    return (
      <p className="w-full text-[11px] text-gray-500" data-testid="ops-push-health">
        {healthError}
      </p>
    );
  }

  if (!health) {
    return null;
  }

  return (
    <p className="w-full text-[11px] text-gray-500 tabular-nums" data-testid="ops-push-health">
      Push configured: {health.pushEnabled ? 'yes' : 'no'} · Scheduled:{' '}
      {health.scheduledEnabled ? 'yes' : 'no'} · Worker: {formatWorkerHealth(health)} · Active subs:{' '}
      {health.subscriptions?.active ?? 0} · Failed jobs: {health.scheduledJobs?.failed ?? 0}
    </p>
  );
}

export default function OpsPushNotificationsPanel({ actorId }) {
  const session = useOpsSession();
  const { loading, busy, readiness, errorMessage, subscribe, unsubscribe } = useOpsPushNotifications(actorId);
  const [testBusy, setTestBusy] = useState(false);
  const [testFeedback, setTestFeedback] = useState('');

  const isAdmin = session?.role === 'admin';
  const showTestButton = isAdmin && readiness === 'subscribed';

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
    return null;
  }

  if (readiness === 'subscribed') {
    return (
      <div
        className="border-b border-gray-100 bg-gray-50/80"
        data-testid="ops-push-panel-subscribed"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-1.5 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p className="text-xs text-gray-600">{READINESS_COPY.subscribed}</p>
          <div className="flex flex-wrap items-center gap-2">
            {showTestButton ? (
              <button
                type="button"
                onClick={() => {
                  void handleSendTest();
                }}
                disabled={busy || testBusy}
                className="text-xs px-2 py-1 rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                data-testid="ops-push-send-test"
              >
                {testBusy ? 'Sending…' : 'Send test notification'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={unsubscribe}
              disabled={busy || testBusy}
              className="text-xs px-2 py-1 rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              data-testid="ops-push-disable"
            >
              {busy ? 'Turning off…' : 'Turn off'}
            </button>
          </div>
          {isAdmin ? <OpsPushHealthSummary /> : null}
          {testFeedback ? (
            <p className="w-full text-xs text-gray-600" data-testid="ops-push-test-feedback" role="status">
              {testFeedback}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  const showEnable = readiness === 'ready_to_subscribe' || readiness === 'error';

  return (
    <div className="border-b border-gray-200 bg-white" data-testid="ops-push-panel">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-gray-600 max-w-2xl">
          {READINESS_COPY[readiness] || READINESS_COPY.error}
          {errorMessage && readiness === 'error' ? ` ${errorMessage}` : ''}
        </p>
        {showEnable ? (
          <button
            type="button"
            onClick={subscribe}
            disabled={busy}
            className="shrink-0 text-xs px-3 py-1.5 rounded border border-[#81887A] bg-[#81887A] text-white hover:bg-[#707668] disabled:opacity-50"
            data-testid="ops-push-enable"
          >
            {busy ? 'Enabling…' : 'Enable notifications'}
          </button>
        ) : null}
        {isAdmin ? <OpsPushHealthSummary /> : null}
      </div>
    </div>
  );
}
