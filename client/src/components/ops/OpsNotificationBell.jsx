import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOpsNotifications } from '../../hooks/useOpsNotifications';
import { resolveOpsNotificationNavigationUrl } from '../../utils/opsNotificationNavigation';
import OpsNotificationDropdown from './OpsNotificationDropdown';

function formatBadgeCount(count) {
  if (count > 9) {
    return '9+';
  }
  return String(count);
}

function BellIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
      />
    </svg>
  );
}

export default function OpsNotificationBell({ actorId }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState(undefined);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);

  const updateDropdownPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) {
      return;
    }
    const rect = button.getBoundingClientRect();
    setDropdownStyle({
      '--ops-notification-dropdown-top': `${rect.bottom + 8}px`
    });
  }, []);
  const {
    enabled,
    unreadCount,
    notifications,
    listLoading,
    listError,
    markAllBusy,
    refreshInbox,
    markOneRead,
    markAllRead
  } = useOpsNotifications(actorId);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }
    updateDropdownPosition();
    const onReposition = () => {
      updateDropdownPosition();
    };
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, updateDropdownPosition]);

  if (!enabled) {
    return null;
  }

  const handleToggle = async () => {
    const nextOpen = !open;
    if (nextOpen) {
      updateDropdownPosition();
    }
    setOpen(nextOpen);
    if (nextOpen) {
      await refreshInbox();
    }
  };

  const handleNotificationClick = async (notification) => {
    if (!notification?.id) {
      return;
    }
    await markOneRead(notification.id);
    const target = resolveOpsNotificationNavigationUrl(notification.url);
    setOpen(false);
    navigate(target);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          void handleToggle();
        }}
        className="relative inline-flex items-center justify-center h-8 w-8 rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
        aria-label="Notifications"
        aria-expanded={open}
        data-testid="ops-notification-bell"
      >
        <BellIcon />
        {unreadCount > 0 ? (
          <span
            className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-amber-600 text-white text-[10px] font-semibold leading-none flex items-center justify-center tabular-nums"
            data-testid="ops-notification-badge"
          >
            {formatBadgeCount(unreadCount)}
          </span>
        ) : null}
      </button>

      {open ? (
        <OpsNotificationDropdown
          style={dropdownStyle}
          notifications={notifications}
          loading={listLoading}
          error={listError}
          unreadCount={unreadCount}
          markAllBusy={markAllBusy}
          onMarkAllRead={() => {
            void markAllRead();
          }}
          onNotificationClick={(notification) => {
            void handleNotificationClick(notification);
          }}
          onRetry={() => {
            void refreshInbox();
          }}
        />
      ) : null}
    </div>
  );
}
