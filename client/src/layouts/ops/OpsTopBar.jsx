import { PanelLeft, PanelLeftClose } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import OpsNotificationBell from '../../components/ops/OpsNotificationBell';
import { getOpsSidebarSelection, isOpsAdminOnlyPath } from './opsNavConfig';
import { OPS_SIDEBAR_EXPANDED } from './opsSidebarState';
import OpsAppearanceControl from './OpsAppearanceControl';

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

function roleClass(role) {
  if (role === 'operator') return 'ops-topbar__role ops-topbar__role--operator';
  if (role === 'cleaner') return 'ops-topbar__role ops-topbar__role--cleaner';
  return 'ops-topbar__role';
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
    <header data-testid="ops-topbar" className="ops-topbar sticky top-0 z-ops-nav">
      <button
        type="button"
        className="ops-topbar__toggle"
        aria-label={toggleLabel}
        aria-expanded={expanded}
        aria-controls="ops-sidebar"
        onClick={onToggle}
        data-testid="ops-sidebar-toggle"
      >
        <ToggleIcon className="h-4 w-4" aria-hidden="true" />
      </button>
      {contextLabel ? (
        <p data-testid="ops-topbar-context" className="ops-topbar__context">
          {contextLabel}
        </p>
      ) : (
        <p data-testid="ops-topbar-context" className="ops-topbar__context ops-topbar__context--empty">
          {'\u00A0'}
        </p>
      )}
      <div data-testid="ops-topbar-search-slot" className="ops-topbar__search-slot" aria-hidden="true" />
      <div className="ops-topbar__actions">
        <OpsAppearanceControl />
        <OpsNotificationBell actorId={session?.actorId} />
        <div className={roleClass(session?.role)} title="Session role from login">
          {roleLabel(session?.role)}
        </div>
        <button type="button" onClick={onLogout} className="ops-topbar__logout" data-testid="ops-logout">
          Logout
        </button>
      </div>
    </header>
  );
}
