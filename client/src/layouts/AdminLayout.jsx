import { useState, useEffect, useMemo } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';

export default function AdminLayout() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const checkAuth = async () => {
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

      try {
        const response = await fetch('/api/admin/bookings', {
          method: 'HEAD',
          headers: { Authorization: `Bearer ${token}` }
        });

        if (response.ok) {
          setIsAuthenticated(true);
        } else {
          localStorage.removeItem('adminToken');
          setIsAuthenticated(false);
        }
      } catch {
        localStorage.removeItem('adminToken');
        setIsAuthenticated(false);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#81887A] mx-auto" />
          <p className="mt-2 text-sm text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated && location.pathname !== '/admin/login') {
    navigate('/admin/login', { replace: true });
    return null;
  }

  if (location.pathname === '/admin/login') {
    return <Outlet />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-[#81887A] rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-xs tracking-widest">D&D</span>
              </div>
              <span className="text-lg font-bold text-gray-900 tracking-wider uppercase">Admin Panel</span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-500">{new Date().toLocaleDateString()}</span>
              <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            <a
              href="/admin/bookings"
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                location.pathname.startsWith('/admin/bookings')
                  ? 'border-[#81887A] text-[#81887A]'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Bookings
            </a>
            <a
              href="/admin/cabins"
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                location.pathname.startsWith('/admin/cabins')
                  ? 'border-[#81887A] text-[#81887A]'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Cabins
            </a>
            {developerNavEnabled && (
              <a
                href="/admin/cabin-types"
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  location.pathname.startsWith('/admin/cabin-types')
                    ? 'border-[#81887A] text-[#81887A]'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Cabin types
              </a>
            )}
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
