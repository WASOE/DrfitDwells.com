import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useOpsPushNotifications } from '../hooks/useOpsPushNotifications';
import { useOpsSession } from './OpsSessionContext';
import { getOpsPushHealth } from '../services/opsApi';
import { resolveOpsPushAttention } from '../utils/opsPushAttention';
import { isValidOpsUserActorId } from '../utils/opsPushReadiness';

const OpsPushNotificationsContext = createContext(null);

export function OpsPushNotificationsProvider({ actorId, children }) {
  const session = useOpsSession();
  const push = useOpsPushNotifications(actorId);
  const isAdmin = session?.role === 'admin';
  const canLoadAdminHealth = isAdmin && isValidOpsUserActorId(actorId);
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState('');

  useEffect(() => {
    if (!canLoadAdminHealth) {
      setHealth(null);
      setHealthError('');
      return undefined;
    }
    let cancelled = false;
    void getOpsPushHealth()
      .then((resp) => {
        if (cancelled) return;
        setHealth(resp?.data?.data || null);
        setHealthError('');
      })
      .catch(() => {
        if (cancelled) return;
        setHealth(null);
        setHealthError('Could not load push health.');
      });
    return () => {
      cancelled = true;
    };
  }, [canLoadAdminHealth, push.readiness, push.loading]);

  const attention = useMemo(
    () =>
      resolveOpsPushAttention({
        loading: push.loading,
        readiness: push.readiness,
        health,
        isAdmin
      }),
    [push.loading, push.readiness, health, isAdmin]
  );

  const value = useMemo(
    () => ({
      loading: push.loading,
      busy: push.busy,
      readiness: push.readiness,
      errorMessage: push.errorMessage,
      subscribe: push.subscribe,
      unsubscribe: push.unsubscribe,
      isAdmin,
      health,
      healthError,
      attention
    }),
    [
      push.loading,
      push.busy,
      push.readiness,
      push.errorMessage,
      push.subscribe,
      push.unsubscribe,
      isAdmin,
      health,
      healthError,
      attention
    ]
  );

  return (
    <OpsPushNotificationsContext.Provider value={value}>{children}</OpsPushNotificationsContext.Provider>
  );
}

export function useOpsPushNotificationsContext() {
  const value = useContext(OpsPushNotificationsContext);
  if (!value) {
    throw new Error('useOpsPushNotificationsContext must be used within OpsPushNotificationsProvider');
  }
  return value;
}

/** Optional consumer for surfaces that may render outside the provider in tests. */
export function useOptionalOpsPushNotificationsContext() {
  return useContext(OpsPushNotificationsContext);
}
