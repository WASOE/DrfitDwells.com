import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getOpsNotifications,
  getOpsNotificationsUnreadCount,
  markAllOpsNotificationsRead,
  markOpsNotificationRead
} from '../services/opsApi';
import { isValidOpsUserActorId } from '../utils/opsPushReadiness';

const POLL_MS = 60_000;
const LIST_LIMIT = 20;

export function useOpsNotifications(actorId) {
  const enabled = isValidOpsUserActorId(actorId);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [countLoading, setCountLoading] = useState(enabled);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [markAllBusy, setMarkAllBusy] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshUnreadCount = useCallback(async () => {
    if (!enabled) {
      setUnreadCount(0);
      setCountLoading(false);
      return;
    }

    setCountLoading(true);
    try {
      const resp = await getOpsNotificationsUnreadCount();
      if (!mountedRef.current) return;
      const count = Number(resp?.data?.data?.unreadCount);
      setUnreadCount(Number.isFinite(count) ? count : 0);
    } catch {
      if (!mountedRef.current) return;
      setUnreadCount(0);
    } finally {
      if (mountedRef.current) {
        setCountLoading(false);
      }
    }
  }, [enabled]);

  const refreshNotifications = useCallback(async () => {
    if (!enabled) {
      setNotifications([]);
      setListError('');
      return;
    }

    setListLoading(true);
    setListError('');
    try {
      const resp = await getOpsNotifications({ limit: LIST_LIMIT });
      if (!mountedRef.current) return;
      const rows = resp?.data?.data?.notifications;
      setNotifications(Array.isArray(rows) ? rows : []);
    } catch {
      if (!mountedRef.current) return;
      setNotifications([]);
      setListError('Could not load notifications. Try again.');
    } finally {
      if (mountedRef.current) {
        setListLoading(false);
      }
    }
  }, [enabled]);

  const refreshInbox = useCallback(async () => {
    await Promise.all([refreshUnreadCount(), refreshNotifications()]);
  }, [refreshUnreadCount, refreshNotifications]);

  useEffect(() => {
    if (!enabled) {
      setUnreadCount(0);
      setNotifications([]);
      setCountLoading(false);
      return undefined;
    }

    void refreshUnreadCount();

    const intervalId = window.setInterval(() => {
      void refreshUnreadCount();
    }, POLL_MS);

    const onFocus = () => {
      void refreshUnreadCount();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, refreshUnreadCount]);

  const markOneRead = useCallback(
    async (notificationId) => {
      if (!enabled || !notificationId) {
        return;
      }
      let wasUnread = false;
      setNotifications((prev) => {
        const row = prev.find((item) => item.id === notificationId);
        wasUnread = Boolean(row && !row.readAt);
        return prev;
      });
      try {
        await markOpsNotificationRead(notificationId);
        if (!mountedRef.current) return;
        setNotifications((prev) =>
          prev.map((row) =>
            row.id === notificationId ? { ...row, readAt: row.readAt || new Date().toISOString() } : row
          )
        );
        if (wasUnread) {
          setUnreadCount((prev) => Math.max(0, prev - 1));
        }
      } catch {
        await refreshInbox();
      }
    },
    [enabled, refreshInbox]
  );

  const markAllRead = useCallback(async () => {
    if (!enabled || unreadCount === 0) {
      return;
    }
    setMarkAllBusy(true);
    try {
      await markAllOpsNotificationsRead();
      if (!mountedRef.current) return;
      const nowIso = new Date().toISOString();
      setNotifications((prev) => prev.map((row) => ({ ...row, readAt: row.readAt || nowIso })));
      setUnreadCount(0);
    } catch {
      await refreshInbox();
    } finally {
      if (mountedRef.current) {
        setMarkAllBusy(false);
      }
    }
  }, [enabled, unreadCount, refreshInbox]);

  return {
    enabled,
    unreadCount,
    notifications,
    countLoading,
    listLoading,
    listError,
    markAllBusy,
    refreshUnreadCount,
    refreshNotifications,
    refreshInbox,
    markOneRead,
    markAllRead
  };
}
