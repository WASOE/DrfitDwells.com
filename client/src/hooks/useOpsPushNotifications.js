import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteOpsPushSubscription,
  getMyOpsPushSubscriptions,
  getOpsPushConfig,
  registerOpsPushSubscription
} from '../services/opsApi';
import {
  findActiveServerSubscription,
  hasActivePushSubscription,
  isIosDevice,
  isPushApiSupported,
  isStandalonePwa,
  isValidOpsUserActorId,
  resolveOpsPushReadiness
} from '../utils/opsPushReadiness';
import { pushSubscriptionToPayload, urlBase64ToUint8Array } from '../utils/opsPushVapid';

export function useOpsPushNotifications(actorId) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [pushEnabled, setPushEnabled] = useState(false);
  const [vapidPublicKey, setVapidPublicKey] = useState(null);
  const [serverSubs, setServerSubs] = useState([]);
  const [browserEndpoint, setBrowserEndpoint] = useState(null);
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );

  const supported = isPushApiSupported();
  const hasOpsUserId = isValidOpsUserActorId(actorId);
  const needsInstall = supported && isIosDevice() && !isStandalonePwa();
  const hasActiveSubscription = hasActivePushSubscription(serverSubs, browserEndpoint);

  const readiness = useMemo(
    () =>
      resolveOpsPushReadiness({
        supported,
        needsInstall,
        permission,
        pushEnabled,
        hasOpsUserId,
        hasActiveSubscription,
        error: errorMessage || null
      }),
    [supported, needsInstall, permission, pushEnabled, hasOpsUserId, hasActiveSubscription, errorMessage]
  );

  const refreshBrowserSubscription = useCallback(async () => {
    if (!supported || !('serviceWorker' in navigator)) {
      setBrowserEndpoint(null);
      return null;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const endpoint = subscription?.endpoint || null;
      setBrowserEndpoint(endpoint);
      return subscription;
    } catch {
      setBrowserEndpoint(null);
      return null;
    }
  }, [supported]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      if (typeof Notification !== 'undefined') {
        setPermission(Notification.permission);
      }

      const configResp = await getOpsPushConfig();
      const config = configResp?.data?.data || {};
      setPushEnabled(Boolean(config.pushEnabled));
      setVapidPublicKey(config.vapidPublicKey || null);

      if (hasOpsUserId) {
        const mineResp = await getMyOpsPushSubscriptions();
        setServerSubs(mineResp?.data?.data?.subscriptions || []);
      } else {
        setServerSubs([]);
      }

      await refreshBrowserSubscription();
    } catch (err) {
      setErrorMessage(err?.response?.data?.message || err?.message || 'Failed to load push settings.');
    } finally {
      setLoading(false);
    }
  }, [hasOpsUserId, refreshBrowserSubscription]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const subscribe = useCallback(async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setErrorMessage('');
    try {
      if (!supported) {
        throw new Error('Push notifications are not supported in this browser.');
      }
      if (!hasOpsUserId) {
        throw new Error('Push subscriptions require an OPS user account.');
      }
      if (!pushEnabled || !vapidPublicKey) {
        throw new Error('Push is not configured on the server.');
      }
      if (needsInstall) {
        throw new Error('Install the OPS app to Home Screen before enabling notifications.');
      }

      const nextPermission =
        Notification.permission === 'default'
          ? await Notification.requestPermission()
          : Notification.permission;
      setPermission(nextPermission);
      if (nextPermission !== 'granted') {
        throw new Error('Notification permission was not granted.');
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
        });
      }

      await registerOpsPushSubscription(pushSubscriptionToPayload(subscription));
      await refresh();
    } catch (err) {
      setErrorMessage(err?.response?.data?.message || err?.message || 'Failed to enable push notifications.');
    } finally {
      setBusy(false);
    }
  }, [busy, supported, hasOpsUserId, pushEnabled, vapidPublicKey, needsInstall, refresh]);

  const unsubscribe = useCallback(async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setErrorMessage('');
    try {
      if (!supported) {
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const endpoint = subscription?.endpoint || browserEndpoint;
      const matchingRow = findActiveServerSubscription(serverSubs, endpoint);

      if (subscription) {
        await subscription.unsubscribe();
      }
      if (matchingRow?.id) {
        await deleteOpsPushSubscription(matchingRow.id);
      }
      await refresh();
    } catch (err) {
      setErrorMessage(err?.response?.data?.message || err?.message || 'Failed to turn off push notifications.');
    } finally {
      setBusy(false);
    }
  }, [busy, supported, browserEndpoint, serverSubs, refresh]);

  return {
    loading,
    busy,
    readiness,
    errorMessage,
    subscribe,
    unsubscribe,
    refresh
  };
}
