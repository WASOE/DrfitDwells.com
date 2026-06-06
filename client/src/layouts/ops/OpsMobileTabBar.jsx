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
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t border-gray-200 bg-white md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Ops sections"
    >
      <ul className="flex items-stretch">
        {OPS_MOBILE_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab.id];
          const isActive = activeTabId === tab.id;
          const tone = isActive ? 'text-sage' : 'text-gray-500';
          const content = (
            <>
              <Icon className="w-5 h-5" aria-hidden="true" strokeWidth={isActive ? 2.25 : 1.75} />
              <span className="text-[11px] font-medium leading-none">{tab.label}</span>
            </>
          );
          const sharedClasses = `flex w-full min-h-[44px] flex-col items-center justify-center gap-1 px-1 py-2 ${tone}`;

          return (
            <li key={tab.id} className="flex-1">
              {tab.to ? (
                <Link
                  to={tab.to}
                  className={`${sharedClasses} touch-manipulation`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {content}
                </Link>
              ) : (
                <button
                  ref={moreButtonRef}
                  type="button"
                  onClick={onMoreClick}
                  className={`${sharedClasses} appearance-none bg-transparent touch-manipulation`}
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
