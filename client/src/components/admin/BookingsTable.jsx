import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { exportToCSV } from '../../utils/csvExport';

const BookingsTable = () => {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState({});
  const [updatingStatus, setUpdatingStatus] = useState({});
  const [emailSummaries, setEmailSummaries] = useState({});
  const [filters, setFilters] = useState({
    status: '',
    cabinId: '',
    from: '',
    to: '',
    q: '',
    transport: '',
    page: 1,
    limit: 20
  });
  const navigate = useNavigate();

  // Debounced search
  const [searchTimeout, setSearchTimeout] = useState(null);

  const fetchEmailSummaries = useCallback(async (emails) => {
    if (emails.length === 0) return;
    
    try {
      const token = localStorage.getItem('adminToken');
      const promises = emails.map(email => 
        fetch(`/api/admin/email-events/summary?email=${encodeURIComponent(email)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }).then(res => res.json()).then(data => ({ email, data: data.success ? data.data : null }))
      );
      
      const results = await Promise.all(promises);
      const summaries = {};
      results.forEach(({ email, data }) => {
        if (data) summaries[email] = data;
      });
      setEmailSummaries(summaries);
    } catch (error) {
      console.error('Failed to fetch email summaries:', error);
    }
  }, []);

  const fetchBookings = useCallback(async () => {
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

      const response = await fetch(`/api/admin/bookings?${queryParams.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setBookings(data.data.items);
        setPagination(data.data.pagination);
        setError('');
        
        // Fetch email summaries for all unique emails
        const emails = [...new Set(data.data.items.map(booking => booking.guestInfo.email))];
        fetchEmailSummaries(emails);
      } else if (response.status === 401) {
        localStorage.removeItem('adminToken');
        navigate('/admin/login');
      } else {
        setError('Failed to load bookings');
      }
    } catch (err) {
      console.error('Fetch bookings error:', err);
      setError('Network error loading bookings');
    } finally {
      setLoading(false);
    }
  }, [filters, navigate]);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
      page: 1 // Reset to first page when filters change
    }));
  };

  const handleSearchChange = (value) => {
    // Clear existing timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    // Set new timeout for debounced search
    const timeout = setTimeout(() => {
      handleFilterChange('q', value);
    }, 300);

    setSearchTimeout(timeout);
  };

  const handlePageChange = (newPage) => {
    setFilters(prev => ({ ...prev, page: newPage }));
  };

  const handleRowClick = (bookingId) => {
    navigate(`/admin/bookings/${bookingId}`);
  };

  const handleStatusUpdate = async (bookingId, newStatus) => {
    setUpdatingStatus(prev => ({ ...prev, [bookingId]: true }));
    
    // Optimistic update
    const originalBookings = [...bookings];
    setBookings(prev => prev.map(booking => 
      booking._id === bookingId ? { ...booking, status: newStatus } : booking
    ));

    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/bookings/${bookingId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (!response.ok) {
        if (response.status === 401) {
          localStorage.removeItem('adminToken');
          navigate('/admin/login');
          return;
        }
        throw new Error('Failed to update status');
      }

      // Success - keep the optimistic update
    } catch (error) {
      console.error('Status update error:', error);
      // Rollback optimistic update
      setBookings(originalBookings);
      setError('Failed to update booking status');
    } finally {
      setUpdatingStatus(prev => ({ ...prev, [bookingId]: false }));
    }
  };

  const handleCSVExport = () => {
    const filename = `bookings-${new Date().toISOString().split('T')[0]}.csv`;
    exportToCSV(bookings, filename);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-GB');
  };

  const formatGuestName = (guestInfo) => {
    if (guestInfo.firstName && guestInfo.lastName) {
      return `${guestInfo.firstName} ${guestInfo.lastName}`;
    }
    return guestInfo.firstName || guestInfo.lastName || 'Unknown';
  };

  const formatGuests = (adults, children) => {
    return `${adults}A${children > 0 ? ` ${children}C` : ''}`;
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'confirmed':
        return 'bg-green-100 text-green-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      case 'pending':
      default:
        return 'bg-yellow-100 text-yellow-800';
    }
  };

  if (loading && bookings.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#81887A] mx-auto"></div>
          <p className="mt-2 text-sm text-gray-600">Loading bookings...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <div className="text-sm text-red-700">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-[#81887A] focus:border-[#81887A] sm:text-sm"
            >
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* Date From */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => handleFilterChange('from', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-[#81887A] focus:border-[#81887A] sm:text-sm"
            />
          </div>

          {/* Date To */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => handleFilterChange('to', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-[#81887A] focus:border-[#81887A] sm:text-sm"
            />
          </div>

          {/* Transport Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Transport</label>
            <select
              value={filters.transport}
              onChange={(e) => handleFilterChange('transport', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-[#81887A] focus:border-[#81887A] sm:text-sm"
            >
              <option value="">All Transport</option>
              <option value="Horse">Horse</option>
              <option value="ATV">ATV</option>
              <option value="Jeep">Jeep</option>
              <option value="Hike">Hike</option>
              <option value="Boat">Boat</option>
              <option value="Helicopter">Helicopter</option>
            </select>
          </div>
        </div>

        {/* Search */}
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
          <input
            type="text"
            placeholder="Search by guest name, email, or booking ID..."
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-[#81887A] focus:border-[#81887A] sm:text-sm"
          />
        </div>
      </div>

      {/* Results Summary and Actions */}
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-600">
          Showing {bookings.length} of {pagination.total || 0} bookings
        </p>
        <div className="flex items-center gap-4">
          {pagination.totalPages > 1 && (
            <p className="text-sm text-gray-600">
              Page {pagination.page} of {pagination.totalPages}
            </p>
          )}
          <button
            onClick={handleCSVExport}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#81887A]"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Created
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Check-in
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Check-out
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Cabin
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Guest
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Guests
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Trip Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Transport
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Total
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Email
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {bookings.length === 0 ? (
              <tr>
                <td colSpan="11" className="px-6 py-12 text-center text-sm text-gray-500">
                  No bookings found matching your criteria.
                </td>
              </tr>
            ) : (
              bookings.map((booking) => (
                <tr
                  key={booking._id}
                  onClick={() => handleRowClick(booking._id)}
                  className="hover:bg-gray-50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#81887A] focus:ring-inset"
                  tabIndex={0}
                >
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(booking.createdAt)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(booking.checkIn)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(booking.checkOut)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    <div>
                      <div className="font-medium truncate max-w-[200px]" title={booking.cabinName}>
                        {booking.cabinName || 'Unknown'}
                      </div>
                      {booking.cabinLocation && (
                        <div className="text-gray-500 truncate max-w-[200px]" title={booking.cabinLocation}>
                          {booking.cabinLocation}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    <div>
                      <div className="font-medium truncate max-w-[200px]" title={formatGuestName(booking.guestInfo)}>
                        {formatGuestName(booking.guestInfo)}
                      </div>
                      <div className="text-gray-500 truncate max-w-[200px]" title={booking.guestInfo.email}>
                        {booking.guestInfo.email}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatGuests(booking.adults, booking.children)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {booking.tripType || '—'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {booking.transportMethod?.type || '—'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    €{booking.totalPrice}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <select
                      value={booking.status}
                      onChange={(e) => handleStatusUpdate(booking._id, e.target.value)}
                      disabled={updatingStatus[booking._id]}
                      className={`text-xs font-semibold rounded-full border-0 focus:ring-2 focus:ring-[#81887A] ${
                        booking.status === 'confirmed' 
                          ? 'bg-green-100 text-green-800'
                          : booking.status === 'cancelled'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-yellow-100 text-yellow-800'
                      } ${updatingStatus[booking._id] ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <option value="pending">pending</option>
                      <option value="confirmed">confirmed</option>
                      <option value="cancelled">cancelled</option>
                    </select>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {(() => {
                      const emailSummary = emailSummaries[booking.guestInfo.email];
                      if (!emailSummary) {
                        return <span className="text-gray-400 text-xs">—</span>;
                      }
                      if (emailSummary.hasIssues) {
                        return (
                          <span 
                            className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800"
                            title={`Email issues detected: ${Object.entries(emailSummary.summary)
                              .filter(([type, count]) => ['Bounce', 'SpamComplaint'].includes(type) && count > 0)
                              .map(([type, count]) => `${type}(${count})`)
                              .join(', ')}`}
                          >
                            ⚠️ Issues
                          </span>
                        );
                      }
                      return (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          ✓ OK
                        </span>
                      );
                    })()}
                  </td>
                </tr>
              ))
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
  );
};

export default BookingsTable;
