import { Link, useLocation } from 'react-router-dom';
import { CalendarDays, Home, Menu, Users, Wallet } from 'lucide-react';
import { OPS_MOBILE_TABS, getActiveOpsMobileTabId } from './opsNavConfig';

const TAB_ICONS = {
  home: Home,
  calendar: CalendarDays,
  guests: Users,
  finance: Wallet,
  more: Menu
};

/**
 * Fixed bottom tab bar for OPS on screens below md (< 768px).
 * Active tab is derived from the router pathname (not local state).
 */
export default function OpsMobileTabBar({ onMoreClick, moreButtonRef, isMoreOpen = false }) {
  const { pathname } = useLocation();
  const activeTabId = getActiveOpsMobileTabId(pathname);

  return (
    <nav className="ops-mobile-tabbar z-ops-nav md:hidden" aria-label="Ops sections">
      <ul className="ops-mobile-tabbar__list">
        {OPS_MOBILE_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab.id];
          const isActive = activeTabId === tab.id;
          const content = (
            <>
              <Icon className="w-5 h-5" aria-hidden="true" strokeWidth={isActive ? 2.25 : 1.75} />
              <span>{tab.label}</span>
            </>
          );
          const linkClass = `ops-mobile-tabbar__link${isActive ? ' ops-mobile-tabbar__link--active' : ''}`;

          return (
            <li key={tab.id} className="ops-mobile-tabbar__item">
              {tab.to ? (
                <Link to={tab.to} className={linkClass} aria-current={isActive ? 'page' : undefined}>
                  {content}
                </Link>
              ) : (
                <button
                  ref={moreButtonRef}
                  type="button"
                  onClick={onMoreClick}
                  className={linkClass}
                  aria-current={isActive ? 'page' : undefined}
                  aria-haspopup="dialog"
                  aria-expanded={isMoreOpen}
                >
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
