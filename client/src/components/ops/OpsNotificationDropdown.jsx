function formatWhen(createdAt) {
  if (!createdAt) {
    return '';
  }
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function truncateBody(body, max = 120) {
  const text = String(body || '').trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

export default function OpsNotificationDropdown({
  style,
  notifications,
  loading,
  error,
  unreadCount,
  markAllBusy,
  onMarkAllRead,
  onNotificationClick,
  onRetry
}) {
  return (
    <div
      style={style}
      className="ops-notification-dropdown fixed left-4 right-4 top-[var(--ops-notification-dropdown-top,3.5rem)] md:absolute md:inset-x-auto md:left-auto md:right-0 md:top-full md:mt-2 md:w-80 md:max-w-sm"
      data-testid="ops-notification-dropdown"
    >
      <div className="ops-notification-dropdown__header">
        <p className="ops-notification-dropdown__title">Notifications</p>
        <button
          type="button"
          onClick={onMarkAllRead}
          disabled={markAllBusy || unreadCount === 0}
          className="ops-notification-dropdown__action"
          data-testid="ops-notification-mark-all"
        >
          {markAllBusy ? 'Marking…' : 'Mark all read'}
        </button>
      </div>

      <div className="ops-notification-dropdown__body">
        {loading ? (
          <p className="ops-notification-dropdown__empty">Loading notifications…</p>
        ) : error ? (
          <div className="px-3 py-4">
            <p className="ops-notification-dropdown__error">{error}</p>
            <button type="button" onClick={onRetry} className="ops-notification-dropdown__action mt-2">
              Try again
            </button>
          </div>
        ) : notifications.length === 0 ? (
          <p className="ops-notification-dropdown__empty">No notifications yet</p>
        ) : (
          <ul className="ops-notification-dropdown__list">
            {notifications.map((notification) => {
              const unread = !notification.readAt;
              return (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => onNotificationClick(notification)}
                    className={`ops-notification-dropdown__row${unread ? ' ops-notification-dropdown__row--unread' : ''}`}
                    data-testid={`ops-notification-row-${notification.id}`}
                  >
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <p className="ops-notification-dropdown__row-title min-w-0 break-words">
                        {notification.title}
                      </p>
                      <span className="ops-notification-dropdown__row-when">
                        {formatWhen(notification.createdAt)}
                      </span>
                    </div>
                    <p className="ops-notification-dropdown__row-body min-w-0 break-words">
                      {truncateBody(notification.body)}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
