import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { reviewAPI, cabinAPI } from '../../services/api';

const ReviewsList = () => {
  const navigate = useNavigate();
  const [reviews, setReviews] = useState([]);
  const [cabins, setCabins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedReviews, setSelectedReviews] = useState(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  // Filters
  const [filters, setFilters] = useState({
    q: '',
    cabinId: '',
    status: '',
    source: '',
    minRating: '',
    maxRating: '',
    lang: '',
    sort: 'newest',
    page: 1,
    limit: 20
  });

  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 1
  });

  // Load cabins for filter dropdown
  useEffect(() => {
    const loadCabins = async () => {
      try {
        const response = await cabinAPI.getAll();
        if (response.data.success) {
          setCabins(response.data.data.cabins || []);
        }
      } catch (err) {
        console.error('Load cabins error:', err);
      }
    };
    loadCabins();
  }, []);

  // Load reviews
  useEffect(() => {
    loadReviews();
  }, [filters]);

  const loadReviews = async () => {
    try {
      setLoading(true);
      setError('');
      
      const params = Object.fromEntries(
        Object.entries(filters).filter(([_, v]) => v !== '')
      );
      
      const response = await reviewAPI.list(params);
      
      if (response.data.success) {
        setReviews(response.data.data.reviews || []);
        setPagination({
          total: response.data.data.total || 0,
          page: response.data.data.page || 1,
          limit: response.data.data.limit || 20,
          totalPages: response.data.data.totalPages || 1
        });
      }
    } catch (err) {
      console.error('Load reviews error:', err);
      if (err.response?.status === 401) {
        localStorage.removeItem('adminToken');
        navigate('/admin/login');
      } else {
        setError(err.response?.data?.message || 'Failed to load reviews');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
      // Only reset to page 1 if changing a filter (not when changing page itself)
      page: key === 'page' ? value : 1
    }));
    setSelectedReviews(new Set());
  };

  const handleBulkAction = async (action) => {
    if (selectedReviews.size === 0) {
      alert('Please select at least one review');
      return;
    }

    if (!confirm(`Are you sure you want to ${action} ${selectedReviews.size} review(s)?`)) {
      return;
    }

    try {
      setBulkActionLoading(true);
      const response = await reviewAPI.bulkAction({
        ids: Array.from(selectedReviews),
        action
      });

      if (response.data.success) {
        alert(`Successfully ${action}d ${response.data.data.updated} review(s)`);
        setSelectedReviews(new Set());
        loadReviews();
      }
    } catch (err) {
      console.error('Bulk action error:', err);
      alert(err.response?.data?.message || `Failed to ${action} reviews`);
    } finally {
      setBulkActionLoading(false);
    }
  };

  const toggleSelectReview = (reviewId) => {
    setSelectedReviews(prev => {
      const next = new Set(prev);
      if (next.has(reviewId)) {
        next.delete(reviewId);
      } else {
        next.add(reviewId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedReviews.size === reviews.length) {
      setSelectedReviews(new Set());
    } else {
      setSelectedReviews(new Set(reviews.map(r => r._id)));
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      approved: 'bg-green-100 text-green-800',
      pending: 'bg-yellow-100 text-yellow-800',
      hidden: 'bg-gray-100 text-gray-800'
    };
    return badges[status] || 'bg-gray-100 text-gray-800';
  };

  const getSourceBadge = (source) => {
    const badges = {
      airbnb: 'bg-pink-100 text-pink-800',
      manual: 'bg-blue-100 text-blue-800',
      import: 'bg-purple-100 text-purple-800'
    };
    return badges[source] || 'bg-gray-100 text-gray-800';
  };

  const renderStars = (rating) => {
    return '★'.repeat(rating) + '☆'.repeat(5 - rating);
  };

  return (
    <div className="px-4 sm:px-0">
        <header className="flex flex-wrap items-end justify-between gap-4 mb-10">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-gray-900">
              Reviews
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Manage and moderate cabin reviews
            </p>
          </div>
          <button
            onClick={() => navigate('/admin/reviews/new')}
            className="inline-flex items-center px-4 py-2.5 text-sm font-medium text-white bg-[#81887A] rounded-lg hover:bg-[#707668] focus:outline-none focus:ring-2 focus:ring-[#81887A]/30 focus:ring-offset-2 shrink-0 transition-colors"
          >
            + Add Review
          </button>
        </header>

        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Search */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">
                Search
              </label>
              <input
                type="text"
                value={filters.q}
                onChange={(e) => handleFilterChange('q', e.target.value)}
                placeholder="Search reviews..."
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-[#81887A] focus:ring-[#81887A] sm:text-sm"
              />
            </div>

            {/* Cabin */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cabin
              </label>
              <select
                value={filters.cabinId}
                onChange={(e) => handleFilterChange('cabinId', e.target.value)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-[#81887A] focus:ring-[#81887A] sm:text-sm"
              >
                <option value="">All Cabins</option>
                {cabins.map(cabin => (
                  <option key={cabin._id} value={cabin._id}>
                    {cabin.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                value={filters.status}
                onChange={(e) => handleFilterChange('status', e.target.value)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-[#81887A] focus:ring-[#81887A] sm:text-sm"
              >
                <option value="">All Status</option>
                <option value="approved">Approved</option>
                <option value="pending">Pending</option>
                <option value="hidden">Hidden</option>
              </select>
            </div>

            {/* Source */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Source
              </label>
              <select
                value={filters.source}
                onChange={(e) => handleFilterChange('source', e.target.value)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-[#81887A] focus:ring-[#81887A] sm:text-sm"
              >
                <option value="">All Sources</option>
                <option value="airbnb">Airbnb</option>
                <option value="manual">Manual</option>
                <option value="import">Import</option>
              </select>
            </div>

            {/* Rating Range */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Min Rating
              </label>
              <select
                value={filters.minRating}
                onChange={(e) => handleFilterChange('minRating', e.target.value)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-[#81887A] focus:ring-[#81887A] sm:text-sm"
              >
                <option value="">Any</option>
                <option value="1">1+</option>
                <option value="2">2+</option>
                <option value="3">3+</option>
                <option value="4">4+</option>
                <option value="5">5</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Rating
              </label>
              <select
                value={filters.maxRating}
                onChange={(e) => handleFilterChange('maxRating', e.target.value)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-[#81887A] focus:ring-[#81887A] sm:text-sm"
              >
                <option value="">Any</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
              </select>
            </div>

            {/* Language */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Language
              </label>
              <input
                type="text"
                value={filters.lang}
                onChange={(e) => handleFilterChange('lang', e.target.value)}
                placeholder="e.g., en, bg"
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-[#81887A] focus:ring-[#81887A] sm:text-sm"
              />
            </div>

            {/* Sort */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sort
              </label>
              <select
                value={filters.sort}
                onChange={(e) => handleFilterChange('sort', e.target.value)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-[#81887A] focus:ring-[#81887A] sm:text-sm"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="rating">Highest Rating</option>
                <option value="pinned">Pinned First</option>
              </select>
            </div>
          </div>
        </div>

        {/* Bulk Actions */}
        {selectedReviews.size > 0 && (
          <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-between">
            <span className="text-sm text-blue-800">
              {selectedReviews.size} review(s) selected
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => handleBulkAction('approve')}
                disabled={bulkActionLoading}
                className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                onClick={() => handleBulkAction('hide')}
                disabled={bulkActionLoading}
                className="px-3 py-1 bg-yellow-600 text-white text-sm rounded hover:bg-yellow-700 disabled:opacity-50"
              >
                Hide
              </button>
              <button
                onClick={() => handleBulkAction('pin')}
                disabled={bulkActionLoading}
                className="px-3 py-1 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 disabled:opacity-50"
              >
                Pin
              </button>
              <button
                onClick={() => handleBulkAction('unpin')}
                disabled={bulkActionLoading}
                className="px-3 py-1 bg-gray-600 text-white text-sm rounded hover:bg-gray-700 disabled:opacity-50"
              >
                Unpin
              </button>
              <button
                onClick={() => handleBulkAction('delete')}
                disabled={bulkActionLoading}
                className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 rounded-md bg-red-50 p-4">
            <div className="text-sm text-red-700">{error}</div>
          </div>
        )}

        {/* Reviews list */}
        {loading ? (
          <div className="mt-8 text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#81887A] mx-auto"></div>
            <p className="mt-2 text-sm text-gray-600">Loading reviews...</p>
          </div>
        ) : reviews.length === 0 ? (
          <div className="mt-8 text-center py-12 bg-white shadow rounded-lg">
            <p className="text-gray-500">No reviews found</p>
          </div>
        ) : (
          <>
            {/* Mobile: cards */}
            <div className="md:hidden mt-6 space-y-3">
              {reviews.map((review) => (
                <div
                  key={review._id}
                  className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {review.pinned && <span className="text-yellow-500" title="Pinned">📌</span>}
                        <span className="text-sm font-medium text-gray-900 tabular-nums">
                          {renderStars(review.rating)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-gray-500 truncate">
                        {review.cabinId?.name || 'N/A'} · {review.reviewerName || 'Unknown'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(`/ops/reviews?reviewId=${review._id}`)}
                      className="shrink-0 inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-[#81887A] rounded-lg hover:bg-[#707668] focus:outline-none focus:ring-2 focus:ring-[#81887A]/30 focus:ring-offset-2 transition-colors"
                    >
                      Edit
                    </button>
                  </div>

                  <div className="text-sm text-gray-900 leading-snug">
                    <span className="block line-clamp-3">{review.text}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
                    <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getSourceBadge(review.source)}`}>
                      {review.source}
                    </span>
                    <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadge(review.status)}`}>
                      {review.status}
                    </span>
                    {review.locked && (
                      <span className="text-xs text-gray-500" title="Review is locked (imported)">🔒 Locked</span>
                    )}
                    <span className="ml-auto text-xs text-gray-500 tabular-nums">
                      {review.createdAtSource
                        ? new Date(review.createdAtSource).toLocaleDateString()
                        : new Date(review.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop/tablet: table */}
            <div className="hidden md:block mt-8 bg-white shadow overflow-hidden sm:rounded-lg overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <input
                        type="checkbox"
                        checked={selectedReviews.size === reviews.length && reviews.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300 text-[#81887A] focus:ring-[#81887A]"
                      />
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Pinned
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Rating
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Review
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Reviewer
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Cabin
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Source
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky right-0 bg-gray-50">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {reviews.map((review) => (
                    <tr key={review._id} className="hover:bg-gray-50 group">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={selectedReviews.has(review._id)}
                          onChange={() => toggleSelectReview(review._id)}
                          className="rounded border-gray-300 text-[#81887A] focus:ring-[#81887A]"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {review.pinned && (
                          <span className="text-yellow-500">📌</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {renderStars(review.rating)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900 max-w-xs truncate">
                          {review.text}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{review.reviewerName}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {review.cabinId?.name || 'N/A'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getSourceBadge(review.source)}`}>
                          {review.source}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadge(review.status)}`}>
                          {review.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {review.createdAtSource
                          ? new Date(review.createdAtSource).toLocaleDateString()
                          : new Date(review.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium sticky right-0 bg-white group-hover:bg-gray-50 z-10">
                        <button
                          onClick={() => navigate(`/ops/reviews?reviewId=${review._id}`)}
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white bg-[#81887A] hover:bg-[#707668] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#81887A] transition-colors"
                          title="Edit this review"
                        >
                          Edit
                        </button>
                        {review.locked && (
                          <span className="ml-2 text-xs text-gray-500" title="Review is locked (imported)">
                            🔒
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <div className="text-sm text-gray-700">
                  Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
                  {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
                  {pagination.total} reviews
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleFilterChange('page', pagination.page - 1)}
                    disabled={pagination.page === 1}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => handleFilterChange('page', pagination.page + 1)}
                    disabled={pagination.page >= pagination.totalPages}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
  );
};

export default ReviewsList;

