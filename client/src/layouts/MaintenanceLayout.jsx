import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { decodeRoleFromToken } from '../services/opsApi';
import maintenanceApi from '../services/maintenanceApi';

export default function MaintenanceLayout() {
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem('adminToken');
    if (!token) {
      setReady(true);
      setAllowed(false);
      return;
    }
    if (decodeRoleFromToken() === 'operator') {
      setReady(true);
      setAllowed(false);
      return;
    }

    const run = async () => {
      try {
        await maintenanceApi.session();
        if (!cancelled) {
          setAllowed(true);
        }
      } catch {
        if (!cancelled) setAllowed(false);
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
    if (!ready) return;
    const token = localStorage.getItem('adminToken');
    if (!token || decodeRoleFromToken() === 'operator' || !allowed) {
      navigate(decodeRoleFromToken() === 'operator' ? '/ops' : '/login', { replace: true });
    }
  }, [ready, allowed, navigate]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-sm text-slate-400">Loading maintenance…</div>
      </div>
    );
  }

  if (!allowed) return null;

  const nav = [
    { to: '/maintenance', label: 'Overview', end: true },
    { to: '/maintenance/cabins', label: 'Cabins' },
    { to: '/maintenance/reservations', label: 'Reservations' },
    { to: '/maintenance/sync', label: 'Sync' },
    { to: '/maintenance/cleanup', label: 'Cleanup' },
    { to: '/maintenance/archived', label: 'Archived / fixtures' }
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-amber-900/40 bg-slate-900/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.25em] text-amber-500/90">Restricted</p>
              <h1 className="text-base font-semibold text-white">Maintenance &amp; system repair</h1>
              <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
                Destructive and data-repair tools. Not for daily operations — use OPS for live workflows.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <a
                href="/ops"
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800"
              >
                OPS console
              </a>
              <a
                href="/ops/reservations"
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800"
              >
                Admin
              </a>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto pb-2 -mx-1 px-1">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `px-3 py-2 text-sm rounded-lg whitespace-nowrap border ${
                    isActive
                      ? 'bg-amber-950/50 border-amber-700/50 text-amber-100'
                      : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/80'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-10">
        <Outlet key={location.pathname} />
      </main>
    </div>
  );
}
