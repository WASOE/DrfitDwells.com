export function isPushApiSupported(env = typeof window !== 'undefined' ? window : null) {
  if (!env || !env.navigator) {
    return false;
  }
  return (
    'serviceWorker' in env.navigator &&
    'PushManager' in env &&
    'Notification' in env
  );
}

export function isIosDevice(env = typeof window !== 'undefined' ? window : null) {
  if (!env || !env.navigator) {
    return false;
  }
  const ua = env.navigator.userAgent || '';
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (env.navigator.platform === 'MacIntel' && env.navigator.maxTouchPoints > 1)
  );
}

export function isStandalonePwa(env = typeof window !== 'undefined' ? window : null) {
  if (!env) {
    return false;
  }
  const standaloneMedia = env.matchMedia?.('(display-mode: standalone)')?.matches;
  return Boolean(standaloneMedia || env.navigator?.standalone === true);
}

export function isValidOpsUserActorId(actorId) {
  return /^[a-f0-9]{24}$/i.test(String(actorId || ''));
}

export function findActiveServerSubscription(serverSubs = [], browserEndpoint = null) {
  if (!browserEndpoint) {
    return null;
  }
  return (
    serverSubs.find(
      (row) => row.endpoint === browserEndpoint && row.invalidatedAt == null
    ) || null
  );
}

export function hasActivePushSubscription(serverSubs = [], browserEndpoint = null) {
  return Boolean(findActiveServerSubscription(serverSubs, browserEndpoint));
}

/**
 * @returns {'unsupported'|'needs_install'|'permission_denied'|'push_not_configured'|'ready_to_subscribe'|'subscribed'|'error'|'ops_user_required'}
 */
export function resolveOpsPushReadiness({
  supported,
  needsInstall,
  permission,
  pushEnabled,
  hasOpsUserId,
  hasActiveSubscription,
  error = null
}) {
  if (error) {
    return 'error';
  }
  if (!supported) {
    return 'unsupported';
  }
  if (!hasOpsUserId) {
    return 'ops_user_required';
  }
  if (!pushEnabled) {
    return 'push_not_configured';
  }
  if (needsInstall) {
    return 'needs_install';
  }
  if (permission === 'denied') {
    return 'permission_denied';
  }
  if (hasActiveSubscription) {
    return 'subscribed';
  }
  return 'ready_to_subscribe';
}

export function pushHealthLabel(pushHealth) {
  const activeCount = pushHealth?.activeCount || 0;
  const invalidatedCount = pushHealth?.invalidatedCount || 0;
  if (activeCount > 0) {
    return 'Ready';
  }
  if (activeCount === 0 && invalidatedCount > 0) {
    return 'Expired';
  }
  return 'None';
}

export function formatPushLastSuccess(value) {
  if (!value) {
    return '—';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
