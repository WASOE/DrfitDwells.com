import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { decodeRoleFromToken, opsReadAPI } from '../services/opsApi';

export default function OpsLayout() {
  const [ready, setReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [health, setHealth] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  const role = decodeRoleFromToken();

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    setIsAuthenticated(false);
    navigate('/login');
  };

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem('adminToken');
    if (!token) {
      setReady(true);
      setIsAuthenticated(false);
      return;
    }

    const run = async () => {
      try {
        const sessionResp = await opsReadAPI.session();
        if (cancelled) return;
        const authenticated = sessionResp?.data?.success && sessionResp?.data?.data?.authenticated === true;
        if (!authenticated) {
          setIsAuthenticated(false);
          return;
        }
        setIsAuthenticated(true);
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

  if (!ready) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-sm text-gray-500">Loading ops console...</div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const navItems = [
    { to: '/ops', label: 'Dashboard' },
    { to: '/ops/calendar', label: 'Calendar' },
    { to: '/ops/reservations', label: 'Reservations' },
    { to: '/ops/payments', label: 'Payments' },
    { to: '/ops/promo-codes', label: 'Promo codes' },
    { to: '/ops/sync', label: 'Sync' },
    { to: '/ops/cabins', label: 'Cabins' },
    { to: '/ops/reviews', label: 'Reviews' },
    { to: '/ops/communications', label: 'Comms' },
    { to: '/ops/manual-review', label: 'Manual' },
    { to: '/ops/readiness', label: 'Readiness' }
  ];

  const staleSync =
    (health?.dependencies?.syncLastSeenByCabinChannel || []).some((x) => x.lastSyncOutcome === 'failed' || x.lastSyncOutcome === 'warning');
  const staleWebhook = !health?.dependencies?.stripeWebhookLastSeenAt;
  const hasDegraded = staleSync || staleWebhook;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Ops Console</p>
              <h1 className="text-base font-semibold text-gray-900 truncate">Drift & Dwells</h1>
            </div>
            <div className="flex items-center gap-2">
              <div
                className={`text-xs px-2 py-1 rounded border tabular-nums ${
                  role === 'operator'
                    ? 'text-sky-800 border-sky-200 bg-sky-50'
                    : 'text-amber-900 border-amber-200 bg-amber-50'
                }`}
                title="Session role from login"
              >
                {role === 'operator' ? 'Operator' : 'Admin'}
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
          <nav className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto border-t border-gray-100">
            <div className="flex items-center gap-1 min-w-max">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/ops'}
                  className={({ isActive }) =>
                    `px-3 py-2 text-sm border-b-2 whitespace-nowrap ${
                      isActive ? 'text-[#81887A] border-[#81887A] font-medium' : 'text-gray-500 border-transparent hover:text-gray-800'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </nav>
        </div>
      </header>

      {hasDegraded ? (
        <div className="bg-amber-50 border-b border-amber-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 text-xs text-amber-800">
            Degraded state: {staleWebhook ? 'webhook not seen yet. ' : ''}
            {staleSync ? 'sync warnings/failures detected.' : ''}
          </div>
        </div>
      ) : null}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
        <Outlet />
      </main>

      {location.pathname.startsWith('/ops/reservations/') ? null : (
        <div className="fixed bottom-0 inset-x-0 border-t border-gray-200 bg-white/95 backdrop-blur sm:hidden">
          <div className="max-w-7xl mx-auto px-2 py-1">
            <div className="flex items-center gap-1 overflow-x-auto min-w-full">
              {navItems.map((item) => (
                <NavLink
                  key={`mobile-${item.to}`}
                  to={item.to}
                  end={item.to === '/ops'}
                  className={({ isActive }) =>
                    `flex-none text-center text-[11px] px-2 py-2 rounded ${isActive ? 'bg-[#81887A] text-white' : 'text-gray-600 hover:bg-gray-100'}`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
