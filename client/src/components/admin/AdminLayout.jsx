import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const AdminLayout = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('adminToken');
      
      if (!token) {
        setIsAuthenticated(false);
        setLoading(false);
        return;
      }

      try {
        // Test token by making a request to a protected endpoint
        const response = await fetch('/api/admin/bookings', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          setIsAuthenticated(true);
        } else {
          // Token is invalid or expired
          localStorage.removeItem('adminToken');
          setIsAuthenticated(false);
        }
      } catch (error) {
        console.error('Auth check error:', error);
        localStorage.removeItem('adminToken');
        setIsAuthenticated(false);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  const developerNavEnabled = useMemo(() => {
    try {
      if (location.pathname.startsWith('/admin/cabin-types')) {
        return true;
      }
      return localStorage.getItem('dd:admin:showCabinTypesNav') === 'true';
    } catch (error) {
      console.warn('Unable to read admin dev nav flag:', error);
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
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#81887A] mx-auto"></div>
          <p className="mt-2 text-sm text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    navigate('/admin/login');
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Admin Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-[#81887A] rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-xs tracking-widest">D&D</span>
              </div>
              <span className="text-lg font-bold text-gray-900 tracking-wider uppercase">
                Admin Panel
              </span>
            </div>
            
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-500">
                {new Date().toLocaleDateString()}
              </span>
              <button
                onClick={handleLogout}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Admin Navigation */}
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

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
};

export default AdminLayout;
