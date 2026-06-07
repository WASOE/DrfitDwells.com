import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { opsReadAPI } from '../services/opsApi';
import { OpsSessionProvider } from '../context/OpsSessionContext';
import OpsDesktopNav from './ops/OpsDesktopNav';
import OpsMobileTabBar from './ops/OpsMobileTabBar';
import OpsMoreSheet from './ops/OpsMoreSheet';
import { canAccessOpsFrontendPath, isCleanerOnlySession } from './ops/opsNavConfig';

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

export default function OpsLayout() {
  const [ready, setReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [session, setSession] = useState(null);
  const [health, setHealth] = useState(null);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const moreButtonRef = useRef(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();

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

  if (!ready) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-sm text-gray-500">Loading ops console...</div>
      </div>
    );
  }

  if (!isAuthenticated || !session) return null;

  const staleSync =
    (health?.dependencies?.syncLastSeenByCabinChannel || []).some((x) => x.lastSyncOutcome === 'failed' || x.lastSyncOutcome === 'warning');
  const staleWebhook = !health?.dependencies?.stripeWebhookLastSeenAt;
  const hasDegraded = staleSync || staleWebhook;
  const cleanerOnly = isCleanerOnlySession(session);

  return (
    <OpsSessionProvider session={session}>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Ops Console</p>
                <h1 className="text-base font-semibold text-gray-900 truncate">
                  {cleanerOnly ? 'Cleaning' : 'Drift & Dwells'}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className={`text-xs px-2 py-1 rounded border tabular-nums ${roleBadgeClass(session.role)}`}
                  title="Session role from login"
                >
                  {roleLabel(session.role)}
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="text-xs px-2 py-1 rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  data-testid="ops-logout"
                >
                  Logout
                </button>
              </div>
            </div>
            {!cleanerOnly ? (
              <div className="hidden md:block">
                <OpsDesktopNav />
              </div>
            ) : null}
          </div>
        </header>

        {!cleanerOnly && hasDegraded ? (
          <div className="bg-amber-50 border-b border-amber-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 text-xs text-amber-800">
              Degraded state: {staleWebhook ? 'webhook not seen yet. ' : ''}
              {staleSync ? 'sync warnings/failures detected.' : ''}
            </div>
          </div>
        ) : null}

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 md:pt-8 pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:pb-8">
          <Outlet />
        </main>

        {!cleanerOnly ? (
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
      </div>
    </OpsSessionProvider>
  );
}
