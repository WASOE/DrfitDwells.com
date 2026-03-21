import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

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
      <div className="px-4 sm:px-0">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#81887A] mx-auto"></div>
            <p className="mt-2 text-sm text-gray-600">Loading cabins...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 sm:px-0">
        <div className="rounded-md bg-red-50 p-4">
          <div className="text-sm text-red-700">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-0">
        <header className="flex flex-wrap items-end justify-between gap-4 mb-10">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-gray-900">
              Cabins
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Manage cabin inventory, pricing, and availability
            </p>
          </div>
          <button
            onClick={() => navigate('/admin/cabins/new', { state: { multiUnitEnabled } })}
            className="inline-flex items-center px-4 py-2.5 text-sm font-medium text-white bg-[#81887A] rounded-lg hover:bg-[#707668] focus:outline-none focus:ring-2 focus:ring-[#81887A]/30 focus:ring-offset-2 shrink-0 transition-colors"
          >
            Add cabin
          </button>
        </header>

        <div className="space-y-6">
          {/* Search */}
          <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <label className="block text-xs font-medium text-gray-500 mb-2">Search cabins</label>
            <input
              type="text"
              placeholder="Search by name or location..."
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-lg bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A] transition-colors placeholder:text-gray-400"
            />
          </div>

          {/* Results Summary */}
          <div className="flex justify-between items-center">
            <p className="text-xs text-gray-500 tabular-nums">
              {cabins.length} of {pagination.total || 0} cabins
              {pagination.totalPages > 1 && (
                <span className="ml-2 text-gray-400">· Page {pagination.page} of {pagination.totalPages}</span>
              )}
            </p>
          </div>

          {/* Mobile list: cards */}
          <div className="md:hidden space-y-3">
            {cabins.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 py-10 text-center text-sm text-gray-500">
                No cabins found matching your criteria.
              </div>
            ) : (
              cabins.map((cabin) => {
                const typeLabel = cabin.inventoryType === 'multi' ? 'Multi-unit' : 'Single unit';
                const unitsLabel = cabin.inventoryType === 'multi'
                  ? `${cabin.unitsCount || 0} unit${(cabin.unitsCount || 0) === 1 ? '' : 's'}`
                  : '1 unit';

                return (
                  <div
                    key={cabin._id}
                    className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{cabin.name}</div>
                        <div className="mt-0.5 text-xs text-gray-500 truncate">{cabin.location}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRowClick(cabin._id)}
                        className="shrink-0 inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-[#81887A] rounded-lg hover:bg-[#707668] focus:outline-none focus:ring-2 focus:ring-[#81887A]/30 focus:ring-offset-2 transition-colors"
                      >
                        Edit
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs text-gray-600">
                      <span className="inline-flex items-center px-2 py-1 rounded-full bg-gray-100 text-gray-700">{typeLabel}</span>
                      <span className="inline-flex items-center px-2 py-1 rounded-full bg-gray-100 text-gray-700">{unitsLabel}</span>
                      <span className="inline-flex items-center px-2 py-1 rounded-full bg-gray-100 text-gray-700">{cabin.capacity} cap</span>
                      <span className="inline-flex items-center px-2 py-1 rounded-full bg-gray-100 text-gray-700">€{cabin.pricePerNight}/night</span>
                      <span className="inline-flex items-center px-2 py-1 rounded-full bg-gray-100 text-gray-700">{cabin.minNights || 1} min</span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
                      <div>
                        <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Transport</div>
                        <div className="mt-0.5 text-sm text-gray-900 tabular-nums">{cabin.transportOptionsCount}</div>
                      </div>
                      <div>
                        <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Blocked dates</div>
                        <div className="mt-0.5 text-sm text-gray-900 tabular-nums">{cabin.blockedDatesCount}</div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Table - constrained column widths to reduce sprawl; scroll only when needed */}
          <div className="hidden md:block overflow-x-auto bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <table className="w-full table-fixed" style={{ minWidth: '760px' }}>
              <colgroup>
                <col style={{ width: '18%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '6%' }} />
              </colgroup>
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/80">
                  <th className="px-3 py-3.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-3 py-3.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                    Location
                  </th>
                  <th className="px-3 py-3.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-3 py-3.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                    Units
                  </th>
                  <th className="px-3 py-3.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                    Capacity
                  </th>
                  <th className="px-3 py-3.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                    Price/Night
                  </th>
                  <th className="px-3 py-3.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                    Min Nights
                  </th>
                  <th className="px-3 py-3.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                    Transport Options
                  </th>
                  <th className="px-3 py-3.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                    Blocked Dates
                  </th>
                  <th className="px-3 py-3.5 text-right text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100/80">
                {cabins.length === 0 ? (
                <tr>
                  <td colSpan="10" className="px-4 py-14 text-center text-sm text-gray-500">
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
                        className="hover:bg-gray-50 focus-within:ring-2 focus-within:ring-[#81887A] focus-within:ring-inset"
                      >
                        <td className="px-3 py-3.5 text-sm font-medium text-gray-900">
                          <span className="truncate block" title={cabin.name}>{cabin.name}</span>
                        </td>
                        <td className="px-3 py-3.5 text-sm text-gray-900">
                          <span className="truncate block text-gray-600" title={cabin.location}>{cabin.location}</span>
                        </td>
                        <td className="px-3 py-3.5 text-sm text-gray-900">{typeLabel}</td>
                        <td className="px-3 py-3.5 text-sm text-gray-900">{unitsLabel}</td>
                        <td className="px-3 py-3.5 text-sm text-gray-900">{cabin.capacity}</td>
                        <td className="px-3 py-3.5 text-sm text-gray-900">€{cabin.pricePerNight}</td>
                        <td className="px-3 py-3.5 text-sm text-gray-900">{cabin.minNights || 1}</td>
                        <td className="px-3 py-3.5 text-sm text-gray-900">{cabin.transportOptionsCount}</td>
                        <td className="px-3 py-3.5 text-sm text-gray-900">{cabin.blockedDatesCount}</td>
                        <td className="px-3 py-3.5 whitespace-nowrap text-right text-sm">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleRowClick(cabin._id); }}
                            className="text-[#81887A] font-medium hover:text-[#707668] focus:outline-none focus:ring-2 focus:ring-[#81887A] focus:ring-offset-1 rounded"
                          >
                            Edit
                          </button>
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
            <div className="flex items-center gap-3">
              <button
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={!pagination.hasPrev}
                className="inline-flex items-center px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="text-xs text-gray-500 tabular-nums">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={!pagination.hasNext}
                className="inline-flex items-center px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
  );
};

export default CabinsList;