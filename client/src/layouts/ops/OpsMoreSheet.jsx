import { useCallback, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Building2,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Gift,
  Home,
  LayoutDashboard,
  Mail,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Star,
  Tag,
  Users,
  Wallet,
  X
} from 'lucide-react';
import { OPS_MORE_GROUPS, filterOpsMoreGroups, isOpsHomePath } from './opsNavConfig';
import { useOpsSession } from '../../context/OpsSessionContext';

const ROW_ICONS = {
  '/ops': LayoutDashboard,
  '/ops/calendar': CalendarDays,
  '/ops/sync': RefreshCw,
  '/ops/reservations': Home,
  '/ops/messaging': MessageSquare,
  '/ops/communications': Mail,
  '/ops/reviews': Star,
  '/ops/payments': Wallet,
  '/ops/promo-codes': Tag,
  '/ops/gift-vouchers': Gift,
  '/ops/cabins': Building2,
  '/ops/creator-partners': Users,
  '/ops/manual-review': ClipboardList,
  '/ops/readiness': ShieldCheck
};

function isRowActive(pathname, to) {
  if (to === '/ops') {
    return isOpsHomePath(pathname);
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}

function getFocusableElements(container) {
  if (!container) return [];
  const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll(selector)).filter(
    (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true'
  );
}

/**
 * Mobile-only bottom sheet for OPS More navigation (< md).
 */
export default function OpsMoreSheet({ open, onClose, returnFocusRef }) {
  const { pathname } = useLocation();
  const session = useOpsSession();
  const groups = filterOpsMoreGroups(OPS_MORE_GROUPS, session);
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);

  const handleClose = useCallback(() => {
    onClose();
    requestAnimationFrame(() => {
      returnFocusRef?.current?.focus();
    });
  }, [onClose, returnFocusRef]);

  useEffect(() => {
    if (!open) return undefined;

    document.body.style.overflow = 'hidden';

    const focusTarget = closeButtonRef.current;
    const focusTimer = window.requestAnimationFrame(() => {
      focusTarget?.focus();
    });

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusables = getFocusableElements(dialogRef.current);
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (!dialogRef.current?.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }

      if (event.shiftKey) {
        if (active === first) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      window.cancelAnimationFrame(focusTimer);
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, handleClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="presentation">
      <div
        className="absolute inset-0 bg-black/40"
        aria-hidden="true"
        onClick={handleClose}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="OPS menu"
        className="absolute bottom-0 left-0 right-0 flex max-h-[min(85vh,640px)] flex-col overflow-hidden rounded-t-2xl border border-gray-200 bg-white shadow-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">All OPS sections</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
          {groups.map((group) => (
            <section key={group.id} className="border-b border-gray-100 last:border-b-0">
              <h3 className="px-4 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                {group.label}
              </h3>
              <ul>
                {group.items.map((item) => {
                  const Icon = ROW_ICONS[item.to] || Building2;
                  const isActive = isRowActive(pathname, item.to);

                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end === true}
                        onClick={handleClose}
                        className={`flex h-[52px] w-full touch-manipulation items-center gap-3 px-4 text-sm ${
                          isActive ? 'bg-sage/10 text-sage font-medium' : 'text-gray-900'
                        }`}
                        aria-current={isActive ? 'page' : undefined}
                      >
                        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" strokeWidth={isActive ? 2.25 : 1.75} />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
