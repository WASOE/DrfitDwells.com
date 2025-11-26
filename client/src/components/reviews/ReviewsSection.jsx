import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { reviewAPI } from '../../services/api';
import { format } from 'date-fns';
import { deriveDisplayName, getAvatarInitials } from '../../utils/nameUtils';

function Stars({ value }) {
  const full = Math.round(value);
  return (
    <span aria-label={`${value} stars`} className="inline-flex gap-0.5 align-middle">
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className={i < full ? 'text-amber-500' : 'text-gray-300'}>★</span>
      ))}
    </span>
  );
}

function sanitize(text = '') {
  if (!text) return '';
  return String(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
}

// Avatar initial helper - now uses getAvatarInitials for proper 2-letter support
function AvatarInitial({ name }) {
  const initials = getAvatarInitials(name);
  return (
    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold text-gray-700 flex-shrink-0" aria-label={`Avatar for ${name}`}>
      {initials}
    </div>
  );
}

function ReviewCard({ r }) {
  const [expanded, setExpanded] = useState(false);
  // Robust name extraction with privacy formatting
  const displayName = deriveDisplayName(r);
  const locale = r.language?.toUpperCase() || 'EN';
  const reviewText = sanitize(r.text);
  const lines = reviewText.split('\n');
  const isLong = lines.length > 10 || reviewText.length > 500;
  const displayText = expanded || !isLong ? reviewText : lines.slice(0, 10).join('\n') + '...';
  
  return (
    <article className="border border-gray-200 rounded-xl p-6 mb-6 bg-white hover:shadow-md transition-shadow">
      {/* Header: Avatar + Name + Locale + Date on one line */}
      <div className="flex items-center gap-3 mb-3">
        <AvatarInitial name={displayName} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 text-sm" aria-label={`Review by ${displayName}`}>{displayName}</span>
            {/* Verified badge if reviewerId exists */}
            {r.reviewerId && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200" title="Verified reviewer">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 00-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 00-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 002.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Verified
              </span>
            )}
            {/* Review highlight badge - enhanced with icon if it's a stay duration */}
            {r.reviewHighlight && (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-sage/10 text-sage-dark border border-sage/20">
                {r.highlightType === 'LENGTH_OF_STAY' && (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                )}
                {r.reviewHighlight}
              </span>
            )}
            {locale && locale !== 'EN' && (
              <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 transition-opacity hover:opacity-80">
                {locale}
                <button
                  className="ml-1 text-gray-500 hover:text-gray-700"
                  onClick={(e) => {
                    e.preventDefault();
                    // TODO: Implement translation
                    console.log('Translate review to', locale);
                  }}
                  aria-label={`Translate review from ${locale}`}
                  title="Translate"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 8l6 6"></path>
                    <path d="M4 14l6-6 2-3"></path>
                    <path d="M2 5h12"></path>
                    <path d="M7 2h1"></path>
                    <path d="M22 22l-5-10-5 10"></path>
                    <path d="M14 18h6"></path>
                  </svg>
                </button>
              </span>
            )}
            {r.localizedDate || r.createdAtSource ? (
              <time dateTime={r.createdAtSource} className="text-xs text-gray-500">
                {r.localizedDate || (r.createdAtSource ? format(new Date(r.createdAtSource), 'MMMM yyyy') : '')}
              </time>
            ) : null}
          </div>
        </div>
        {r.pinned && (
          <span className="text-yellow-500 text-base flex-shrink-0" title="Pinned review" aria-label="Pinned review">📌</span>
        )}
      </div>
      
      {/* Stars row */}
      <div className="mb-3">
        <Stars value={r.rating || 5} />
      </div>
      
      {/* Review body */}
      <div>
        <p className="text-gray-700 leading-relaxed text-base prose max-w-none lg:max-w-[68ch]" style={{ whiteSpace: 'pre-wrap' }}>
          {displayText}
        </p>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-2 text-sm text-[#81887A] hover:text-[#707668] font-medium"
          >
            {expanded ? 'Read less' : 'Read more'}
          </button>
        )}
      </div>

      {r.ownerResponse?.text && (
        <div className="mt-5 pt-5 border-t border-gray-200">
          <div className="font-semibold text-sm text-gray-900 mb-2">
            Owner response
            {r.ownerResponse.respondedBy && (
              <span className="text-gray-500 font-normal ml-2">from {r.ownerResponse.respondedBy}</span>
            )}
          </div>
          <p className="text-sm text-gray-700 leading-relaxed" style={{ whiteSpace: 'pre-wrap' }}>
            {sanitize(r.ownerResponse.text)}
          </p>
        </div>
      )}
    </article>
  );
}

function Histogram({ buckets }) {
  const total = Object.values(buckets).reduce((a, b) => a + b, 0) || 1;
  
  return (
    <div className="grid grid-cols-1 gap-2.5" role="group" aria-label="Rating distribution">
      {[5, 4, 3, 2, 1].map(star => {
        const count = buckets[star] || 0;
        const pct = Math.round((count / total) * 100);
        return (
          <div key={star} className="flex items-center gap-3" role="listitem">
            <div className="w-6 text-sm text-gray-700 font-medium" aria-label={`${star} star`}>{star}</div>
            <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100" aria-label={`${pct}% of reviews are ${star} star`}>
              <div 
                className="h-1.5 bg-gray-900 rounded-full transition-all duration-300" 
                style={{ width: `${pct}%` }} 
              />
            </div>
            <div className="w-12 text-right text-xs text-gray-600 font-medium">{pct}%</div>
          </div>
        );
      })}
    </div>
  );
}

const ReviewsSection = ({ cabinId, averageRating, reviewCount, hideHeading = false }) => {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState('relevant');
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1
  });
  const containerRef = useRef(null);

  const loadReviews = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await reviewAPI.getByCabinId(cabinId, {
        page: pagination.page,
        limit: pagination.limit,
        sort: 'pinned_first',
        minRating: 2
      });

      if (response.data.success) {
        setReviews(response.data.data.items || []);
        setPagination(prev => ({
          ...prev,
          total: response.data.data.total || 0,
          totalPages: response.data.data.totalPages || 1
        }));
      }
    } catch (err) {
      console.error('Load reviews error:', err);
      setError('Failed to load reviews');
    } finally {
      setLoading(false);
    }
  }, [cabinId, pagination.page, pagination.limit]);

  useEffect(() => {
    if (cabinId) {
      loadReviews();
    }
  }, [cabinId, pagination.page, loadReviews]);

  // Scroll to anchor on sort change
  useEffect(() => {
    if (window.location.hash === '#guest-reviews' && containerRef.current) {
      const timeoutId = setTimeout(() => {
        containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [sortKey]);

  // Filter out 1★ and hidden reviews
  const filtered = useMemo(() => {
    return reviews.filter(r => (r?.rating ?? 5) >= 2 && r?.status !== 'hidden');
  }, [reviews]);

  // Calculate histogram
  const histogram = useMemo(() => {
    const b = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    filtered.forEach(r => {
      const rounded = Math.round(r.rating || 5);
      b[rounded] = (b[rounded] || 0) + 1;
    });
    return b;
  }, [filtered]);

  // Sort reviews
  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortKey) {
      case 'recent':
        return arr.sort((a, b) => {
          const dateA = new Date(a.createdAtSource || a.createdAt || 0);
          const dateB = new Date(b.createdAtSource || b.createdAt || 0);
          return dateB - dateA;
        });
      case 'high':
        return arr.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      case 'low':
        return arr.sort((a, b) => (a.rating || 0) - (b.rating || 0));
      case 'relevant':
      default:
        // Keep pinned first, then by creation date (server already sends this way)
        return arr;
    }
  }, [filtered, sortKey]);

  if (loading && reviews.length === 0) {
    return (
      <div ref={containerRef} className="mt-0">
        {!hideHeading && (
          <h2 className="section-title mb-6" id="guest-reviews">Guest Reviews</h2>
        )}
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-sage"></div>
          <p className="mt-4 text-sm text-gray-600">Loading reviews...</p>
        </div>
      </div>
    );
  }

  if (error && reviews.length === 0) {
    return (
      <div ref={containerRef} className="mt-0">
        {!hideHeading && (
          <h2 className="section-title mb-6" id="guest-reviews">Guest Reviews</h2>
        )}
        <div className="text-center py-8">
          <p className="text-sm text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (reviews.length === 0) {
    return null;
  }

  const displayRating = averageRating || (reviews.length > 0 
    ? reviews.reduce((sum, r) => sum + (r.rating || 5), 0) / reviews.length 
    : 0);
  const displayCount = reviewCount || pagination.total || filtered.length;

  return (
    <div ref={containerRef} className="mt-0">
      {!hideHeading && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <h2 className="section-title" id="guest-reviews">
        Guest Reviews
            {displayCount > 0 && (
              <span className="text-base text-gray-500 font-normal ml-2">
                ({displayCount} {displayCount === 1 ? 'review' : 'reviews'})
          </span>
        )}
      </h2>

          <div className="relative">
            <select
              className="border border-gray-300 rounded-lg px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black focus:border-black transition-colors"
              value={sortKey}
              onChange={(e) => {
                setSortKey(e.target.value);
                if (window?.location) window.location.hash = '#guest-reviews';
              }}
              aria-label="Sort reviews"
            >
              <option value="relevant">Most relevant</option>
              <option value="recent">Most recent</option>
              <option value="high">Highest rated</option>
              <option value="low">Lowest rated</option>
            </select>
                  </div>
                </div>
      )}

      {/* Sort dropdown when heading is hidden */}
      {hideHeading && (
        <div className="flex justify-end mb-8">
          <select
            className="border border-gray-300 rounded-lg px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black focus:border-black transition-colors"
            value={sortKey}
            onChange={(e) => {
              setSortKey(e.target.value);
              if (window?.location) window.location.hash = '#guest-reviews';
            }}
            aria-label="Sort reviews"
          >
            <option value="relevant">Most relevant</option>
            <option value="recent">Most recent</option>
            <option value="high">Highest rated</option>
            <option value="low">Lowest rated</option>
          </select>
              </div>
      )}

      {/* Rating summary and histogram */}
      <div className="mb-10 p-6 bg-gray-50 rounded-lg">
        <div className="flex items-center gap-3 mb-6">
          <Stars value={displayRating} />
          <span className="text-3xl font-semibold">{displayRating.toFixed(2)}</span>
          {displayCount > 0 && (
            <span className="text-base text-gray-600">• {displayCount} {displayCount === 1 ? 'review' : 'reviews'}</span>
                  )}
                </div>
        <Histogram buckets={histogram} />
              </div>

      {/* Review cards */}
      <div className="space-y-6">
        {sorted.map((review) => (
          <ReviewCard key={review._id} r={review} />
        ))}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex justify-center items-center gap-6 pt-10 mt-10 border-t border-gray-200">
          <button
            onClick={() => {
              setPagination(prev => ({ ...prev, page: prev.page - 1 }));
              if (window?.location) window.location.hash = '#guest-reviews';
            }}
            disabled={pagination.page === 1}
            className="btn-underline disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            ← Previous
          </button>
          <span className="text-sm text-gray-600">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            onClick={() => {
              setPagination(prev => ({ ...prev, page: prev.page + 1 }));
              if (window?.location) window.location.hash = '#guest-reviews';
            }}
            disabled={pagination.page >= pagination.totalPages}
            className="btn-underline disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
};

export default ReviewsSection;
