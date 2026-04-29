import { useState, useEffect, useMemo } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { decodeRoleFromToken } from '../services/opsApi';

export default function AdminLayout() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === '/admin/login') {
      setIsAuthenticated(true);
      setLoading(false);
      return;
    }

    const token = localStorage.getItem('adminToken');
    if (!token) {
      setIsAuthenticated(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/admin/bookings', {
          method: 'HEAD',
          headers: { Authorization: `Bearer ${token}` }
        });
        if (cancelled) return;
        if (response.ok) {
          setIsAuthenticated(true);
        } else {
          localStorage.removeItem('adminToken');
          setIsAuthenticated(false);
        }
      } catch {
        if (cancelled) return;
        localStorage.removeItem('adminToken');
        setIsAuthenticated(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    checkAuth();
    return () => { cancelled = true; };
  }, [location.pathname]);

  const developerNavEnabled = useMemo(() => {
    try {
      if (location.pathname.startsWith('/admin/cabin-types')) return true;
      return localStorage.getItem('dd:admin:showCabinTypesNav') === 'true';
    } catch {
      return false;
    }
  }, [location.pathname]);

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    setIsAuthenticated(false);
    navigate('/admin/login');
  };

  useEffect(() => {
    if (!loading && !isAuthenticated && location.pathname !== '/admin/login') {
      navigate('/admin/login', { replace: true });
    }
  }, [loading, isAuthenticated, location.pathname, navigate]);

  useEffect(() => {
    if (loading || !isAuthenticated || location.pathname === '/admin/login') return;
    if (decodeRoleFromToken() === 'operator' && location.pathname.startsWith('/admin')) {
      navigate('/ops', { replace: true });
    }
  }, [loading, isAuthenticated, location.pathname, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-7 w-7 border-2 border-gray-200 border-t-[#81887A] mx-auto" />
          <p className="mt-3 text-xs text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated && location.pathname !== '/admin/login') {
    return null;
  }

  if (location.pathname === '/admin/login') {
    return <Outlet />;
  }

  const navLink = (path, label) => {
    const isActive = location.pathname.startsWith(path);
    return (
      <a
        href={path}
        className={`py-3 px-4 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
          isActive
            ? 'text-[#81887A] border-[#81887A]'
            : 'border-transparent text-gray-500 hover:text-gray-800'
        }`}
      >
        {label}
      </a>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-3">
            {/* Mobile-safe header: brand + logout */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 bg-[#81887A] rounded-lg flex items-center justify-center shrink-0">
                  <span className="text-white font-semibold text-[10px] tracking-widest">D&D</span>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 tracking-tight truncate">Admin</div>
                  <div className="text-[11px] text-gray-400 tabular-nums hidden sm:block">
                    {new Date().toLocaleDateString()}
                  </div>
                </div>
              </div>

              <button
                onClick={handleLogout}
                className="text-sm text-gray-500 hover:text-gray-800 font-medium transition-colors px-3 py-2 rounded-md border border-gray-200 hover:bg-gray-50"
              >
                Logout
              </button>
            </div>

            {/* Nav: horizontal scroll on mobile, standard on desktop */}
            <div className="mt-3 -mx-4 sm:mx-0">
              <nav className="flex items-center gap-1 overflow-x-auto px-4 sm:px-0 border-b border-gray-200 [-webkit-overflow-scrolling:touch]">
                {navLink('/ops/reservations', 'Bookings')}
                {navLink('/ops/cabins', 'Cabins')}
                {navLink('/ops/reviews', 'Reviews')}
                {navLink('/admin/promo-codes', 'Promo codes')}
                {decodeRoleFromToken() === 'admin' && navLink('/maintenance', 'Maintenance')}
                {developerNavEnabled && navLink('/admin/cabin-types', 'Cabin types')}
              </nav>
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto py-10 px-4 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
