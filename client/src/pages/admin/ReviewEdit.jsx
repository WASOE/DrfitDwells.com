import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { reviewAPI, cabinAPI } from '../../services/api';

const ReviewEdit = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isNew = id === 'new';
  
  const [review, setReview] = useState(null);
  const [cabins, setCabins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');

  const [formData, setFormData] = useState({
    cabinId: searchParams.get('cabinId') || '',
    rating: 5,
    text: '',
    reviewerName: 'Guest',
    language: 'en',
    status: 'approved',
    pinned: false,
    locked: false,
    moderationNotes: '',
    ownerResponse: {
      text: '',
      respondedBy: 'Jose'
    }
  });

  // Load cabins for dropdown
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

  // Load review if editing
  useEffect(() => {
    if (!isNew) {
      loadReview();
    } else {
      setLoading(false);
    }
  }, [id, isNew]);

  const loadReview = async () => {
    try {
      setLoading(true);
      setError('');
      
      const response = await reviewAPI.getById(id);
      
      if (response.data.success) {
        const reviewData = response.data.data.review;
        setReview(reviewData);
        setFormData({
          cabinId: reviewData.cabinId?._id || reviewData.cabinId || '',
          rating: reviewData.rating,
          text: reviewData.text || '',
          reviewerName: reviewData.reviewerName || 'Guest',
          language: reviewData.language || 'en',
          status: reviewData.status || 'approved',
          pinned: reviewData.pinned || false,
          locked: reviewData.locked || false,
          moderationNotes: reviewData.moderationNotes || '',
          ownerResponse: reviewData.ownerResponse || {
            text: '',
            respondedBy: 'Jose'
          }
        });
      }
    } catch (err) {
      console.error('Load review error:', err);
      if (err.response?.status === 401) {
        localStorage.removeItem('adminToken');
        navigate('/admin/login');
      } else {
        setError(err.response?.data?.message || 'Failed to load review');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field, value) => {
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      setFormData(prev => ({
        ...prev,
        [parent]: {
          ...prev[parent],
          [child]: value
        }
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [field]: value
      }));
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      setSaveMessage('');

      // Validation
      if (!formData.cabinId) {
        setError('Please select a cabin');
        return;
      }
      if (!formData.text.trim()) {
        setError('Review text is required');
        return;
      }

      let response;

      if (isNew) {
        // Create new review - normalize status to lowercase
        response = await reviewAPI.create({
          cabinId: formData.cabinId,
          rating: Number(formData.rating),
          text: formData.text.trim(),
          reviewerName: formData.reviewerName.trim(),
          language: formData.language,
          status: String(formData.status).toLowerCase(),
          pinned: formData.pinned,
          locked: formData.locked
        });
      } else {
        // Update existing review - normalize status to lowercase
        const updateData = {
          rating: Number(formData.rating),
          text: formData.text.trim(),
          reviewerName: formData.reviewerName.trim(),
          language: formData.language,
          status: String(formData.status).toLowerCase(),
          pinned: formData.pinned,
          locked: formData.locked,
          moderationNotes: formData.moderationNotes
        };

        // Add owner response if text exists
        if (formData.ownerResponse.text.trim()) {
          updateData.ownerResponse = {
            text: formData.ownerResponse.text.trim(),
            respondedBy: formData.ownerResponse.respondedBy.trim() || 'Jose'
          };
        }

        // If locked review and trying to edit text, we need to unlock it
        if (review?.locked && formData.text.trim() !== review.text && formData.locked) {
          // Text changed but still locked - this will be caught by backend, but let's warn user
          setError('Cannot edit text while review is locked. Please uncheck "Locked" to edit the text.');
          setSaving(false);
          return;
        }
        
        // If we're unlocking, make sure locked is set to false
        if (review?.locked && !formData.locked) {
          updateData.locked = false;
        }

        response = await reviewAPI.update(id, updateData);
      }

      if (response.data.success) {
        setSaveMessage('Review saved successfully');
        setTimeout(() => {
          navigate('/ops/reviews');
        }, 1500);
      } else {
        setError(response.data.message || 'Failed to save review');
      }
    } catch (err) {
      console.error('Save review error:', err);
      if (err.response?.status === 401) {
        localStorage.removeItem('adminToken');
        navigate('/admin/login');
      } else {
        // Show detailed error message
        const errorMessage = err.response?.data?.message || 
                            err.response?.data?.code ||
                            err.message || 
                            'Failed to save review';
        setError(errorMessage);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="px-4 sm:px-0">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#81887A] mx-auto"></div>
            <p className="mt-2 text-sm text-gray-600">Loading review...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-0 max-w-3xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <button
              onClick={() => navigate('/ops/reviews')}
              className="text-sm text-gray-500 hover:text-gray-800 mb-2 block"
            >
              ← Back to Reviews
            </button>
            <h1 className="text-xl font-semibold tracking-tight text-gray-900">
              {isNew ? 'New Review' : 'Edit Review'}
            </h1>
            {!isNew && review?._id && (
              <p className="mt-0.5 text-sm text-gray-500">
                <span className="font-mono text-[12px]">{review._id}</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/ops/reviews')}
              className="inline-flex items-center px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center px-4 py-2.5 text-sm font-medium text-white bg-[#81887A] rounded-lg hover:bg-[#707668] focus:outline-none focus:ring-2 focus:ring-[#81887A]/30 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </header>

        {error && (
          <div className="mt-4 rounded-md bg-red-50 p-4">
            <div className="text-sm text-red-700">{error}</div>
          </div>
        )}

        {saveMessage && (
          <div className="mt-4 rounded-md bg-green-50 p-4">
            <div className="text-sm text-green-700">{saveMessage}</div>
          </div>
        )}

        {/* Locked Review Warning */}
        {!isNew && review?.locked && formData.locked && (
          <div className="mt-4 rounded-md bg-yellow-50 border border-yellow-200 p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3 flex-1">
                <h3 className="text-sm font-medium text-yellow-800">
                  Review is Locked
                </h3>
                <div className="mt-2 text-sm text-yellow-700">
                  <p>
                    This review was imported from an external source (Airbnb). The review text is locked to prevent accidental changes.
                  </p>
                  <p className="mt-2">
                    <strong>To edit the text:</strong> Uncheck the "Locked" checkbox below, then you can edit the review text.
                  </p>
                </div>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setFormData({ ...formData, locked: false });
                      setTimeout(() => {
                        document.querySelector('textarea[name="text"]')?.focus();
                      }, 100);
                    }}
                    className="text-sm font-medium text-yellow-800 hover:text-yellow-900 underline"
                  >
                    Unlock to Edit Text →
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          <div className="px-6 py-5 space-y-6">
            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Cabin */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Cabin *
                </label>
                <select
                  value={formData.cabinId}
                  onChange={(e) => handleInputChange('cabinId', e.target.value)}
                  disabled={!isNew}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-[#81887A] focus:ring-[#81887A] sm:text-sm disabled:bg-gray-100"
                >
                  <option value="">Select a cabin</option>
                  {cabins.map(cabin => (
                    <option key={cabin._id} value={cabin._id}>
                      {cabin.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Rating */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Rating *
                </label>
                <select
                  value={formData.rating}
                  onChange={(e) => handleInputChange('rating', parseInt(e.target.value))}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-[#81887A] focus:ring-[#81887A] sm:text-sm"
                >
                  <option value={1}>1 ★</option>
                  <option value={2}>2 ★★</option>
                  <option value={3}>3 ★★★</option>
                  <option value={4}>4 ★★★★</option>
                  <option value={5}>5 ★★★★★</option>
                </select>
              </div>

              {/* Reviewer Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reviewer Name
                </label>
                <input
                  type="text"
                  value={formData.reviewerName}
                  onChange={(e) => handleInputChange('reviewerName', e.target.value)}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-[#81887A] focus:ring-[#81887A] sm:text-sm"
                  placeholder="Guest"
                />
              </div>

              {/* Language */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Language
                </label>
                <input
                  type="text"
                  value={formData.language}
                  onChange={(e) => handleInputChange('language', e.target.value)}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-[#81887A] focus:ring-[#81887A] sm:text-sm"
                  placeholder="en"
                />
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Status
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => handleInputChange('status', e.target.value)}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-[#81887A] focus:ring-[#81887A] sm:text-sm"
                >
                  <option value="approved">Approved</option>
                  <option value="pending">Pending</option>
                  <option value="hidden">Hidden</option>
                </select>
              </div>

              {/* Pinned */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Options
                </label>
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.pinned}
                      onChange={(e) => handleInputChange('pinned', e.target.checked)}
                      className="rounded border-gray-300 text-[#81887A] focus:ring-[#81887A]"
                    />
                    <span className="ml-2 text-sm text-gray-700">Pinned</span>
                  </label>
                  {!isNew && (
                    <div className="border border-gray-200 rounded-md p-3 bg-gray-50">
                      <label className="flex items-start">
                        <input
                          type="checkbox"
                          checked={formData.locked}
                          onChange={(e) => handleInputChange('locked', e.target.checked)}
                          className="mt-1 rounded border-gray-300 text-[#81887A] focus:ring-[#81887A]"
                        />
                        <div className="ml-2">
                          <span className="text-sm font-medium text-gray-700">Locked</span>
                          <p className="text-xs text-gray-500 mt-1">
                            {formData.locked 
                              ? "Prevents editing the review text. Uncheck to allow edits."
                              : "Review text can be edited. Check to lock it again."}
                          </p>
                        </div>
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Review Text */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Review Text *
                </label>
                {!isNew && review?.locked && formData.locked && (
                  <span className="text-xs font-medium text-yellow-600 bg-yellow-100 px-2 py-1 rounded">
                    🔒 Locked
                  </span>
                )}
              </div>
              <textarea
                name="text"
                value={formData.text}
                onChange={(e) => handleInputChange('text', e.target.value)}
                rows={6}
                disabled={!isNew && review?.locked && formData.locked}
                className={`w-full rounded-md border-gray-300 shadow-sm focus:border-[#81887A] focus:ring-[#81887A] sm:text-sm ${
                  !isNew && review?.locked && formData.locked 
                    ? 'bg-gray-100 cursor-not-allowed border-gray-300' 
                    : ''
                }`}
                placeholder="Enter the review text..."
              />
              {!isNew && review?.locked && formData.locked && (
                <div className="mt-2 flex items-center text-sm text-gray-600">
                  <svg className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>
                    Uncheck "Locked" above to enable editing this imported review text.
                  </span>
                </div>
              )}
              {!isNew && review?.source === 'airbnb' && (
                <p className="mt-1 text-xs text-gray-500">
                  Source: Imported from {review.source}
                </p>
              )}
            </div>

            {/* Owner Response */}
            <div className="border-t border-gray-200 pt-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Owner Response</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Response Text
                  </label>
                  <textarea
                    value={formData.ownerResponse.text}
                    onChange={(e) => handleInputChange('ownerResponse.text', e.target.value)}
                    rows={4}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-[#81887A] focus:ring-[#81887A] sm:text-sm"
                    placeholder="Enter owner response..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Responded By
                  </label>
                  <input
                    type="text"
                    value={formData.ownerResponse.respondedBy}
                    onChange={(e) => handleInputChange('ownerResponse.respondedBy', e.target.value)}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-[#81887A] focus:ring-[#81887A] sm:text-sm"
                    placeholder="Jose"
                  />
                </div>
              </div>
            </div>

            {/* Moderation Notes */}
            <div className="border-t border-gray-200 pt-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Moderation Notes (Admin Only)
              </label>
              <textarea
                value={formData.moderationNotes}
                onChange={(e) => handleInputChange('moderationNotes', e.target.value)}
                rows={3}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-[#81887A] focus:ring-[#81887A] sm:text-sm"
                placeholder="Internal notes about this review..."
              />
            </div>

            {/* Provenance Info (Read-only for existing reviews) */}
            {!isNew && review && (
              <div className="border-t border-gray-200 pt-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Provenance</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium text-gray-700">Source:</span>
                    <span className="ml-2 text-gray-900">{review.source}</span>
                  </div>
                  {review.externalId && (
                    <div>
                      <span className="font-medium text-gray-700">External ID:</span>
                      <span className="ml-2 text-gray-900">{review.externalId}</span>
                    </div>
                  )}
                  {review.createdAtSource && (
                    <div>
                      <span className="font-medium text-gray-700">Original Date:</span>
                      <span className="ml-2 text-gray-900">
                        {new Date(review.createdAtSource).toLocaleString()}
                      </span>
                    </div>
                  )}
                  {review.editedAt && (
                    <div>
                      <span className="font-medium text-gray-700">Last Edited:</span>
                      <span className="ml-2 text-gray-900">
                        {new Date(review.editedAt).toLocaleString()} by {review.editedBy}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
  );
};

export default ReviewEdit;

