import { PanelLeft, PanelLeftClose } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import OpsNotificationBell from '../../components/ops/OpsNotificationBell';
import { getOpsSidebarSelection, isOpsAdminOnlyPath } from './opsNavConfig';
import { OPS_SIDEBAR_EXPANDED } from './opsSidebarState';

export function getOpsTopBarContext(pathname) {
  if (isOpsAdminOnlyPath(pathname)) {
    return 'Design system';
  }
  return getOpsSidebarSelection(pathname)?.item?.label || '';
}

function roleLabel(role) {
  if (role === 'operator') return 'Operator';
  if (role === 'cleaner') return 'Cleaner';
  if (role === 'admin') return 'Admin';
  return 'User';
}

function roleBadgeClass(role) {
  if (role === 'operator') return 'text-sky-800 border-sky-200 bg-sky-50';
  if (role === 'cleaner') return 'text-emerald-800 border-emerald-200 bg-emerald-50';
  return 'text-amber-900 border-amber-200 bg-amber-50';
}

export default function OpsTopBar({
  mode = OPS_SIDEBAR_EXPANDED,
  session,
  onToggle,
  onLogout
}) {
  const { pathname } = useLocation();
  const expanded = mode === OPS_SIDEBAR_EXPANDED;
  const contextLabel = getOpsTopBarContext(pathname);
  const toggleLabel = expanded ? 'Collapse sidebar' : 'Expand sidebar';
  const ToggleIcon = expanded ? PanelLeftClose : PanelLeft;

  return (
    <header
      data-testid="ops-topbar"
      className="ops-topbar sticky top-0 z-ops-nav flex items-center gap-3 border-b border-gray-200 bg-white px-3"
    >
      <button
        type="button"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
        aria-label={toggleLabel}
        aria-expanded={expanded}
        aria-controls="ops-sidebar"
        onClick={onToggle}
        data-testid="ops-sidebar-toggle"
      >
        <ToggleIcon className="h-4 w-4" aria-hidden="true" />
      </button>
      {contextLabel ? (
        <p data-testid="ops-topbar-context" className="min-w-0 truncate text-sm text-gray-700">
          {contextLabel}
        </p>
      ) : (
        <p data-testid="ops-topbar-context" className="min-w-0 truncate text-sm text-gray-400">
          {'\u00A0'}
        </p>
      )}
      <div
        data-testid="ops-topbar-search-slot"
        className="min-w-0 flex-1"
        aria-hidden="true"
      />
      <div className="flex shrink-0 items-center gap-2">
        <OpsNotificationBell actorId={session?.actorId} />
        <div
          className={`text-xs px-2 py-1 rounded border tabular-nums ${roleBadgeClass(session?.role)}`}
          title="Session role from login"
        >
          {roleLabel(session?.role)}
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="text-xs px-2 py-1 rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
          data-testid="ops-logout"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
