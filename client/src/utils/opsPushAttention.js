/**
 * Decide whether Dashboard should show a compact push attention banner.
 * Healthy subscribed + healthy admin worker state → null (no strip).
 */

/**
 * @param {{
 *   loading?: boolean,
 *   readiness?: string,
 *   health?: object|null,
 *   isAdmin?: boolean
 * }} input
 * @returns {{ key: string, message: string, action: 'enable'|'open_bell'|null }|null}
 */
export function resolveOpsPushAttention({ loading, readiness, health, isAdmin } = {}) {
  if (loading) {
    return null;
  }

  switch (readiness) {
    case 'ready_to_subscribe':
      return {
        key: 'device_disabled',
        message: 'Push notifications are disabled on this device.',
        action: 'enable'
      };
    case 'permission_denied':
      return {
        key: 'permission_denied',
        message: 'Notifications are blocked for this site. Enable them in browser settings.',
        action: null
      };
    case 'needs_install':
      return {
        key: 'needs_install',
        message: 'Add Drift & Dwells to Home Screen, then enable notifications from the bell.',
        action: 'open_bell'
      };
    case 'push_not_configured':
      return {
        key: 'not_configured',
        message: 'Push notifications are not configured on the server.',
        action: 'open_bell'
      };
    case 'error':
      return {
        key: 'error',
        message: 'Push setup failed on this device. Check notifications.',
        action: 'open_bell'
      };
    case 'unsupported':
    case 'ops_user_required':
      return null;
    default:
      break;
  }

  if (!isAdmin || !health) {
    return null;
  }

  const failed = Number(health.scheduledJobs?.failed) || 0;
  if (failed > 0) {
    return {
      key: 'failed_jobs',
      message: `Push notification jobs failed (${failed}). Check notifications.`,
      action: 'open_bell'
    };
  }

  if (health.workerEnabled && !health.worker?.running) {
    return {
      key: 'worker_down',
      message: 'Push notification worker is unavailable. Check notifications.',
      action: 'open_bell'
    };
  }

  if (health.pushEnabled === false) {
    return {
      key: 'server_disabled',
      message: 'Push notifications are not configured on the server.',
      action: 'open_bell'
    };
  }

  return null;
}

export function formatPushWorkerLabel(health) {
  if (!health?.workerEnabled) {
    return 'Off';
  }
  return health.worker?.running ? 'Yes' : 'No';
}

export function formatPushYesNo(value) {
  return value ? 'Yes' : 'No';
}
