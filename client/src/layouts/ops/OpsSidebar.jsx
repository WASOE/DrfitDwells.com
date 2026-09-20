import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Building2,
  CalendarDays,
  ChartSpline,
  ChevronDown,
  CircleDollarSign,
  House,
  Settings,
  Sparkles,
  Users
} from 'lucide-react';
import OpsTooltip from '../../ops/primitives/OpsTooltip';
import { useOpsSession } from '../../context/OpsSessionContext';
import {
  filterOpsSidebarGroups,
  getOpsSidebarSelection
} from './opsNavConfig';
import { computeOpsSidebarFlyoutPosition } from './opsSidebarFlyoutPosition';
import { OPS_SIDEBAR_COLLAPSED, OPS_SIDEBAR_EXPANDED } from './opsSidebarState';

const GROUP_ICONS = {
  House,
  CalendarDays,
  Users,
  CircleDollarSign,
  Building2,
  Sparkles,
  ChartSpline,
  Settings
};

function isItemActive(selection, item) {
  return selection?.item?.to === item.to;
}

export default function OpsSidebar({ mode = OPS_SIDEBAR_EXPANDED }) {
  const session = useOpsSession();
  const { pathname } = useLocation();
  const groups = filterOpsSidebarGroups(session);
  const selection = getOpsSidebarSelection(pathname);
  const collapsed = mode === OPS_SIDEBAR_COLLAPSED;
  const [openGroupId, setOpenGroupId] = useState(selection?.groupId || null);
  const [flyoutGroupId, setFlyoutGroupId] = useState(null);
  const [flyoutBox, setFlyoutBox] = useState(null);
  const rootRef = useRef(null);
  const flyoutRef = useRef(null);
  const triggerRefs = useRef({});
  const reactId = useId();

  useEffect(() => {
    if (selection?.groupId) {
      setOpenGroupId(selection.groupId);
    }
  }, [pathname, selection?.groupId]);

  useEffect(() => {
    setFlyoutGroupId(null);
    setFlyoutBox(null);
  }, [pathname, collapsed]);

  useLayoutEffect(() => {
    if (!collapsed || !flyoutGroupId) {
      setFlyoutBox(null);
      return undefined;
    }

    function updatePosition() {
      const trigger = triggerRefs.current[flyoutGroupId];
      const flyout = flyoutRef.current;
      if (!trigger || !flyout) return;
      const triggerRect = trigger.getBoundingClientRect();
      const next = computeOpsSidebarFlyoutPosition({
        triggerTop: triggerRect.top,
        triggerRight: triggerRect.right,
        flyoutHeight: flyout.offsetHeight,
        viewportHeight: window.innerHeight
      });
      setFlyoutBox((current) => {
        if (
          current &&
          current.top === next.top &&
          current.left === next.left &&
          current.maxHeight === next.maxHeight
        ) {
          return current;
        }
        return next;
      });
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('resize', updatePosition);
    };
  }, [collapsed, flyoutGroupId]);

  useEffect(() => {
    if (!flyoutGroupId) return undefined;

    function onKeyDown(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      const trigger = triggerRefs.current[flyoutGroupId];
      setFlyoutGroupId(null);
      setFlyoutBox(null);
      trigger?.focus();
    }

    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setFlyoutGroupId(null);
        setFlyoutBox(null);
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [flyoutGroupId]);

  const mainGroups = groups.filter((group) => group.id !== 'admin');
  const adminGroup = groups.find((group) => group.id === 'admin') || null;

  function handleGroupButton(group) {
    if (collapsed) {
      setFlyoutGroupId((current) => (current === group.id ? null : group.id));
      return;
    }
    setOpenGroupId(group.id);
  }

  function renderChildLinks(group, options = {}) {
    const { onNavigate, id } = options;
    return (
      <ul id={id} className="flex flex-col py-1">
        {group.items.map((item) => {
          const active = isItemActive(selection, item);
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                aria-current={active ? 'page' : undefined}
                onClick={onNavigate}
                className={`relative flex items-center min-h-9 px-3 py-1.5 text-sm ${
                  active
                    ? 'bg-gray-100 text-gray-900 font-medium border-l-2 border-gray-900'
                    : 'text-gray-600 border-l-2 border-transparent hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  function renderGroup(group) {
    const Icon = GROUP_ICONS[group.icon] || House;
    const isActiveGroup = selection?.groupId === group.id;
    const panelId = `${reactId}-${group.id}-panel`;
    const flyoutId = `${reactId}-${group.id}-flyout`;
    const expandedOpen = !collapsed && openGroupId === group.id;
    const flyoutOpen = collapsed && flyoutGroupId === group.id;
    const collapsedActive = collapsed && isActiveGroup;

    const groupButton = (
      <button
        type="button"
        ref={(node) => {
          triggerRefs.current[group.id] = node;
        }}
        className={`ops-sidebar-group-btn flex items-center w-full text-left ${
          collapsed
            ? `justify-center h-10 ${
                collapsedActive
                  ? 'ops-sidebar-group-btn--active bg-gray-100 border-l-2 border-gray-900 text-gray-900'
                  : 'border-l-2 border-transparent text-gray-600 hover:bg-gray-50'
              }`
            : `gap-2 min-h-9 px-3 py-1.5 text-sm ${isActiveGroup ? 'text-gray-900 font-medium' : 'text-gray-700 hover:bg-gray-50'}`
        }`}
        aria-label={group.label}
        aria-expanded={collapsed ? flyoutOpen : expandedOpen}
        aria-controls={collapsed ? flyoutId : panelId}
        onClick={() => handleGroupButton(group)}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" strokeWidth={isActiveGroup ? 2.25 : 1.75} />
        {collapsed ? null : (
          <>
            <span className="flex-1 truncate">{group.label}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-gray-500 ${expandedOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </>
        )}
      </button>
    );

    return (
      <div key={group.id} className="relative" data-ops-group={group.id} data-active={isActiveGroup ? 'true' : undefined}>
        {collapsed ? (
          <OpsTooltip content={group.label} side="right" disabled={Boolean(flyoutGroupId)}>
            {groupButton}
          </OpsTooltip>
        ) : (
          groupButton
        )}
        {!collapsed && expandedOpen ? renderChildLinks(group, { id: panelId }) : null}
        {flyoutOpen ? (
          <div
            ref={flyoutRef}
            id={flyoutId}
            className="ops-sidebar-flyout rounded-r border border-l-0 border-gray-200 bg-white shadow-ops-overlay"
            data-testid="ops-sidebar-flyout"
            data-ops-flyout={group.id}
            style={
              flyoutBox
                ? {
                    top: flyoutBox.top,
                    left: flyoutBox.left,
                    maxHeight: flyoutBox.maxHeight
                  }
                : { visibility: 'hidden', top: 0, left: 0 }
            }
          >
            <p className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500">{group.label}</p>
            {renderChildLinks(group, {
              onNavigate: () => {
                setFlyoutGroupId(null);
                setFlyoutBox(null);
              }
            })}
          </div>
        ) : null}
      </div>
    );
  }

  if (groups.length === 0) {
    return null;
  }

  return (
    <aside
      ref={rootRef}
      id="ops-sidebar"
      data-testid="ops-sidebar"
      data-mode={collapsed ? OPS_SIDEBAR_COLLAPSED : OPS_SIDEBAR_EXPANDED}
      className={`ops-sidebar border-r border-gray-200 bg-white ${collapsed ? 'ops-sidebar--collapsed' : 'ops-sidebar--expanded'}`}
    >
      <nav aria-label="Ops sections" className="ops-sidebar__nav">
        <div className="ops-sidebar__groups py-2">{mainGroups.map(renderGroup)}</div>
        {adminGroup ? (
          <div className="ops-sidebar__admin border-t border-gray-200 py-2" data-testid="ops-sidebar-admin">
            {renderGroup(adminGroup)}
          </div>
        ) : null}
      </nav>
    </aside>
  );
}

export { GROUP_ICONS };
