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
import OpsSidebarBrand from './OpsSidebarBrand';

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
      <ul id={id} className="ops-sidebar-children">
        {group.items.map((item) => {
          const active = isItemActive(selection, item);
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                aria-current={active ? 'page' : undefined}
                onClick={onNavigate}
                className={`ops-sidebar-link${active ? ' ops-sidebar-link--active' : ''}`}
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
        className={[
          'ops-sidebar-group-btn',
          collapsed ? 'ops-sidebar-group-btn--collapsed' : 'ops-sidebar-group-btn--expanded',
          isActiveGroup || collapsedActive ? 'ops-sidebar-group-btn--active' : ''
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label={group.label}
        aria-expanded={collapsed ? flyoutOpen : expandedOpen}
        aria-controls={collapsed ? flyoutId : panelId}
        onClick={() => handleGroupButton(group)}
      >
        <Icon
          className="ops-sidebar-group-btn__icon"
          aria-hidden="true"
          strokeWidth={isActiveGroup ? 2.25 : 1.75}
        />
        {collapsed ? null : (
          <>
            <span className="ops-sidebar-group-btn__label">{group.label}</span>
            <ChevronDown
              className={`ops-sidebar-group-btn__chevron${expandedOpen ? ' ops-sidebar-group-btn__chevron--open' : ''}`}
              aria-hidden="true"
            />
          </>
        )}
      </button>
    );

    return (
      <div key={group.id} className="ops-sidebar-group" data-ops-group={group.id} data-active={isActiveGroup ? 'true' : undefined}>
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
            className="ops-sidebar-flyout"
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
            <p className="ops-sidebar-flyout__label">{group.label}</p>
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
      className={`ops-sidebar${collapsed ? ' ops-sidebar--collapsed' : ' ops-sidebar--expanded'}`}
    >
      <OpsSidebarBrand collapsed={collapsed} />
      <nav aria-label="Ops sections" className="ops-sidebar__nav">
        <div className="ops-sidebar__groups">{mainGroups.map(renderGroup)}</div>
        {adminGroup ? (
          <div className="ops-sidebar__admin" data-testid="ops-sidebar-admin">
            {renderGroup(adminGroup)}
          </div>
        ) : null}
      </nav>
    </aside>
  );
}

export { GROUP_ICONS };
