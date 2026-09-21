import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { opsReadAPI } from '../services/opsApi';
import { OpsSessionProvider } from '../context/OpsSessionContext';
import { OpsPushNotificationsProvider } from '../context/OpsPushNotificationsContext';
import OpsMobileTabBar from './ops/OpsMobileTabBar';
import OpsMoreSheet from './ops/OpsMoreSheet';
import OpsNotificationBell from '../components/ops/OpsNotificationBell';
import OpsSidebar from './ops/OpsSidebar';
import OpsTopBar from './ops/OpsTopBar';
import OpsAppearanceControl from './ops/OpsAppearanceControl';
import { canAccessOpsFrontendPath, isCleanerOnlySession } from './ops/opsNavConfig';
import { OPS_SIDEBAR_COLLAPSED, OPS_SIDEBAR_EXPANDED, useOpsSidebarMode } from './ops/opsSidebarState';
import { OpsAppearanceProvider, OpsRoot } from '../ops/appearance/OpsAppearanceProvider';
import { applyOpsDocumentLang, resolveOpsUiLanguage } from '../ops/i18n/opsUiLanguage';
import { OpsPageWidthProvider, useOpsPageOwnsWidth } from '../ops/layout/OpsPageLayoutContext';
import '../ops/ops.css';
import './ops/opsShell.css';

/** Unmigrated #ops-main cap. Do not change — OpsPage opts out by replacing this class. */
export const OPS_MAIN_LEGACY_CLASSNAME =
  'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 md:pt-8 pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:pb-8';

export const OPS_MAIN_OWNED_CLASSNAME = 'ops-main ops-main--owned';

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

function SkipToContent() {
  return (
    <a href="#ops-main" className="ops-skip-link" data-testid="ops-skip-link">
      Skip to content
    </a>
  );
}

function CompactHeader({ title, session, onLogout }) {
  return (
    <header className="ops-mobile-header" data-testid="ops-mobile-header">
      <div className="ops-mobile-header__inner">
        <div className="ops-mobile-header__row">
          <div className="ops-mobile-header__copy">
            <p className="ops-mobile-header__eyebrow">Ops Console</p>
            <h1 className="ops-mobile-header__title">{title}</h1>
          </div>
          <div className="ops-mobile-header__actions">
            <OpsAppearanceControl />
            <OpsNotificationBell actorId={session.actorId} />
            <div className={roleClass(session.role)} title="Session role from login">
              {roleLabel(session.role)}
            </div>
            <button type="button" onClick={onLogout} className="ops-topbar__logout" data-testid="ops-logout">
              Logout
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

export default function OpsLayout() {
  return (
    <OpsAppearanceProvider>
      <OpsPageWidthProvider>
        <OpsLayoutShell />
      </OpsPageWidthProvider>
    </OpsAppearanceProvider>
  );
}

function OpsLayoutShell() {
  const [ready, setReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [session, setSession] = useState(null);
  const [health, setHealth] = useState(null);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const moreButtonRef = useRef(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { mode, isDesktop, persistMode } = useOpsSidebarMode();
  const pageOwnsWidth = useOpsPageOwnsWidth();

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    setIsAuthenticated(false);
    setSession(null);
    navigate('/login');
  };

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem('adminToken');
    if (!token) {
      setReady(true);
      setIsAuthenticated(false);
      setSession(null);
      return;
    }

    const run = async () => {
      try {
        const sessionResp = await opsReadAPI.session();
        if (cancelled) return;
        const sessionData = sessionResp?.data?.data || null;
        const authenticated = sessionResp?.data?.success && sessionData?.authenticated === true;
        if (!authenticated) {
          setIsAuthenticated(false);
          setSession(null);
          return;
        }
        setIsAuthenticated(true);
        setSession(sessionData);
        try {
          const healthResp = await opsReadAPI.health();
          if (cancelled) return;
          setHealth(healthResp?.data?.data || null);
        } catch {
          if (!cancelled) setHealth(null);
        }
      } catch {
        if (!cancelled) {
          setIsAuthenticated(false);
          setSession(null);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (ready && !isAuthenticated) {
      navigate('/login', { replace: true });
    }
  }, [ready, isAuthenticated, navigate]);

  useEffect(() => {
    if (!ready || !isAuthenticated || !session) {
      return;
    }
    if (!canAccessOpsFrontendPath(pathname, session)) {
      navigate(session.defaultRoute || '/ops/cleaning', { replace: true });
    }
  }, [ready, isAuthenticated, session, pathname, navigate]);

  useEffect(() => {
    setIsMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!session) {
      return undefined;
    }
    return applyOpsDocumentLang(resolveOpsUiLanguage(session));
  }, [session]);

  if (!ready) {
    return (
      <OpsRoot themed className="min-h-screen flex items-center justify-center">
        <div className="ops-shell-loading">Loading ops console...</div>
      </OpsRoot>
    );
  }

  if (!isAuthenticated || !session) return null;

  const staleSync =
    (health?.dependencies?.syncLastSeenByCabinChannel || []).some((x) => x.lastSyncOutcome === 'failed' || x.lastSyncOutcome === 'warning');
  const staleWebhook = !health?.dependencies?.stripeWebhookLastSeenAt;
  const hasDegraded = staleSync || staleWebhook;
  const cleanerOnly = isCleanerOnlySession(session);
  const showDesktopShell = !cleanerOnly && isDesktop;

  function handleSidebarToggle() {
    persistMode(mode === OPS_SIDEBAR_EXPANDED ? OPS_SIDEBAR_COLLAPSED : OPS_SIDEBAR_EXPANDED);
  }

  return (
    <OpsSessionProvider session={session}>
      <OpsPushNotificationsProvider actorId={session.actorId}>
      <OpsRoot themed className="min-h-screen">
        <SkipToContent />
        {cleanerOnly ? <CompactHeader title="Cleaning" session={session} onLogout={handleLogout} /> : null}
        {!cleanerOnly && !isDesktop ? (
          <CompactHeader title="Drift & Dwells" session={session} onLogout={handleLogout} />
        ) : null}

        <div
          className={showDesktopShell ? `ops-shell-frame ops-shell-frame--desktop ops-shell-frame--${mode}` : 'ops-shell-frame'}
          data-sidebar-mode={showDesktopShell ? mode : undefined}
        >
          {showDesktopShell ? <OpsSidebar mode={mode} /> : null}
          <div className="ops-shell-main">
            {showDesktopShell ? (
              <OpsTopBar mode={mode} session={session} onToggle={handleSidebarToggle} onLogout={handleLogout} />
            ) : null}
            {!cleanerOnly && hasDegraded ? (
              <div className="ops-degraded-banner" data-testid="ops-degraded-banner">
                <div className="ops-degraded-banner__inner">
                  Degraded state: {staleWebhook ? 'webhook not seen yet. ' : ''}
                  {staleSync ? 'sync warnings/failures detected.' : ''}
                </div>
              </div>
            ) : null}
            <main
              id="ops-main"
              data-testid="ops-main"
              data-ops-page-owns-width={pageOwnsWidth ? 'true' : 'false'}
              className={pageOwnsWidth ? OPS_MAIN_OWNED_CLASSNAME : OPS_MAIN_LEGACY_CLASSNAME}
            >
              <Outlet />
            </main>
          </div>
        </div>

        {!cleanerOnly && !isDesktop ? (
          <>
            <OpsMobileTabBar
              onMoreClick={() => setIsMoreOpen(true)}
              moreButtonRef={moreButtonRef}
              isMoreOpen={isMoreOpen}
            />
            <OpsMoreSheet
              open={isMoreOpen}
              onClose={() => setIsMoreOpen(false)}
              returnFocusRef={moreButtonRef}
            />
          </>
        ) : null}
      </OpsRoot>
      </OpsPushNotificationsProvider>
    </OpsSessionProvider>
  );
}
