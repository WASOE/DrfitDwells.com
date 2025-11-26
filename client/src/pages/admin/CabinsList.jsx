import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/admin/AdminLayout';

const CabinsList = () => {
  const [cabins, setCabins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState({});
  const [filters, setFilters] = useState({
    q: '',
    page: 1,
    limit: 20
  });
  const [multiUnitEnabled, setMultiUnitEnabled] = useState(false);
  const navigate = useNavigate();

  // Debounced search
  const [searchTimeout, setSearchTimeout] = useState(null);

  const fetchCabins = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('adminToken');
      
      // Build query string
      const queryParams = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) {
          queryParams.append(key, value);
        }
      });

      const response = await fetch(`/api/admin/cabins?${queryParams.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setCabins(data.data.items);
        setPagination(data.data.pagination);
        setMultiUnitEnabled(Boolean(data.data.meta?.multiUnitEnabled));
        setError('');
      } else if (response.status === 401) {
        localStorage.removeItem('adminToken');
        navigate('/admin/login');
      } else {
        setError('Failed to load cabins');
      }
    } catch (err) {
      console.error('Fetch cabins error:', err);
      setError('Network error loading cabins');
    } finally {
      setLoading(false);
    }
  }, [filters, navigate]);

  useEffect(() => {
    fetchCabins();
  }, [fetchCabins]);

  const handleSearchChange = (value) => {
    // Clear existing timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    // Set new timeout for debounced search
    const timeout = setTimeout(() => {
      setFilters(prev => ({ ...prev, q: value, page: 1 }));
    }, 300);

    setSearchTimeout(timeout);
  };

  const handlePageChange = (newPage) => {
    setFilters(prev => ({ ...prev, page: newPage }));
  };

  const handleRowClick = (cabinId) => {
    navigate(`/admin/cabins/${cabinId}`, { state: { multiUnitEnabled } });
  };

  if (loading && cabins.length === 0) {
    return (
      <AdminLayout>
        <div className="px-4 sm:px-0">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#81887A] mx-auto"></div>
              <p className="mt-2 text-sm text-gray-600">Loading cabins...</p>
            </div>
          </div>
        </div>
      </AdminLayout>
    );
  }

  if (error) {
    return (
      <AdminLayout>
        <div className="px-4 sm:px-0">
          <div className="rounded-md bg-red-50 p-4">
            <div className="text-sm text-red-700">{error}</div>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="px-4 sm:px-0">
        <div className="sm:flex sm:items-center">
          <div className="sm:flex-auto">
            <h1 className="text-2xl font-playfair font-bold text-gray-900">
              Cabins
            </h1>
            <p className="mt-2 text-sm text-gray-700">
              Manage cabin inventory, pricing, and availability
            </p>
          </div>
          <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
            <button
              onClick={() => navigate('/admin/cabins/new', { state: { multiUnitEnabled } })}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-[#81887A] hover:bg-[#707668] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#81887A]"
            >
              Add cabin
            </button>
          </div>
        </div>

        <div className="mt-8 space-y-6">
          {/* Search */}
          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
            <label className="block text-sm font-medium text-gray-700 mb-1">Search Cabins</label>
            <input
              type="text"
              placeholder="Search by name or location..."
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-[#81887A] focus:border-[#81887A] sm:text-sm"
            />
          </div>

          {/* Results Summary */}
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-600">
              Showing {cabins.length} of {pagination.total || 0} cabins
            </p>
            {pagination.totalPages > 1 && (
              <p className="text-sm text-gray-600">
                Page {pagination.page} of {pagination.totalPages}
              </p>
            )}
          </div>

          {/* Table */}
          <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
            <table className="min-w-full divide-y divide-gray-300">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Location
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Units
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Capacity
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Price/Night
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Min Nights
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Transport Options
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Blocked Dates
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {cabins.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-6 py-12 text-center text-sm text-gray-500">
                    No cabins found matching your criteria.
                  </td>
                </tr>
                ) : (
                  cabins.map((cabin) => {
                    const typeLabel = cabin.inventoryType === 'multi' ? 'Multi-unit' : 'Single unit';
                    const unitsLabel = cabin.inventoryType === 'multi'
                      ? `${cabin.unitsCount || 0} unit${(cabin.unitsCount || 0) === 1 ? '' : 's'}`
                      : '1 unit';

                    return (
                      <tr
                        key={cabin._id}
                        onClick={() => handleRowClick(cabin._id)}
                        className="hover:bg-gray-50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#81887A] focus:ring-inset"
                        tabIndex={0}
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {cabin.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {cabin.location}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {typeLabel}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {unitsLabel}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {cabin.capacity}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          €{cabin.pricePerNight}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {cabin.minNights || 1}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {cabin.transportOptionsCount} option{cabin.transportOptionsCount !== 1 ? 's' : ''}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {cabin.blockedDatesCount} date{cabin.blockedDatesCount !== 1 ? 's' : ''}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <button
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={!pagination.hasPrev}
                  className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="mx-4 text-sm text-gray-700">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <button
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={!pagination.hasNext}
                  className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
};

export default CabinsList;