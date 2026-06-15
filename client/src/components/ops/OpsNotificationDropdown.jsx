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
      className="absolute right-0 z-50 mt-2 w-[min(100vw-2rem,22rem)] max-w-sm rounded-lg border border-gray-200 bg-white shadow-lg"
      data-testid="ops-notification-dropdown"
    >
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
        <p className="text-sm font-semibold text-gray-900">Notifications</p>
        <button
          type="button"
          onClick={onMarkAllRead}
          disabled={markAllBusy || unreadCount === 0}
          className="text-xs px-2 py-1 rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          data-testid="ops-notification-mark-all"
        >
          {markAllBusy ? 'Marking…' : 'Mark all read'}
        </button>
      </div>

      <div className="max-h-[min(24rem,60vh)] overflow-y-auto">
        {loading ? (
          <p className="px-3 py-4 text-xs text-gray-500">Loading notifications…</p>
        ) : error ? (
          <div className="px-3 py-4">
            <p className="text-xs text-red-700">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 text-xs px-2 py-1 rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            >
              Try again
            </button>
          </div>
        ) : notifications.length === 0 ? (
          <p className="px-3 py-4 text-xs text-gray-500">No notifications yet</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {notifications.map((notification) => {
              const unread = !notification.readAt;
              return (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => onNotificationClick(notification)}
                    className={`w-full text-left px-3 py-3 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none ${
                      unread ? 'bg-amber-50/40' : ''
                    }`}
                    data-testid={`ops-notification-row-${notification.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={`text-sm leading-snug ${
                          unread ? 'font-semibold text-gray-900' : 'font-medium text-gray-800'
                        }`}
                      >
                        {notification.title}
                      </p>
                      <span className="shrink-0 text-[10px] text-gray-500 tabular-nums">
                        {formatWhen(notification.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-600 leading-relaxed">
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
