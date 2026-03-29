import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import '../i18n/ns/booking';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { getLanguageFromPath, localizePath } from '../utils/localizedRoutes';
import { availabilityAPI, unitAPI } from '../services/api';
import Seo from '../components/Seo';
import { useBookingContext } from '../context/BookingContext';
import { startOfDay, addDays, isBefore } from 'date-fns';
import { formatDateOnlyLocal, parseDateOnlyLocal } from '../utils/dateOnly';
import { getMinSelectableStayDate } from '../utils/bookingMinStayDate';

const SearchBar = lazy(() => import('../components/SearchBar'));

// Safe URL normalization helper
function normalizeSrc(u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/')) return u;
  return `/uploads/cabins/${u}`;
}

// Get cover image from images array with fallback to legacy imageUrl
function getCoverImage(cabin) {
  const arr = Array.isArray(cabin.images) ? cabin.images : [];
  const cover = arr.find(i => i && i.isCover) || arr[0];
  const url = cover?.url || cabin.imageUrl || '';
  return normalizeSrc(url);
}

/** URL query → validated stay params (same rules as booking pickers). */
function computeValidatedSearchParams(searchParams) {
  let checkIn = searchParams.get('checkIn');
  let checkOut = searchParams.get('checkOut');
  let adults = parseInt(searchParams.get('adults'), 10) || 2;
  let children = parseInt(searchParams.get('children'), 10) || 0;

  const today = getMinSelectableStayDate();
  let checkInDate = null;
  if (checkIn) {
    const parsed = parseDateOnlyLocal(checkIn);
    if (parsed) {
      checkInDate = startOfDay(parsed);
    }
  }
  if (!checkInDate || isBefore(checkInDate, today)) {
    checkInDate = today;
  }

  let checkOutDate = null;
  if (checkOut) {
    const parsed = parseDateOnlyLocal(checkOut);
    if (parsed) {
      checkOutDate = startOfDay(parsed);
    }
  }
  if (!checkOutDate || !checkInDate || isBefore(checkOutDate, addDays(checkInDate, 1))) {
    checkOutDate = addDays(checkInDate, 1);
  }

  checkIn = formatDateOnlyLocal(checkInDate);
  checkOut = formatDateOnlyLocal(checkOutDate);

  adults = Math.max(1, Math.min(10, adults));
  children = Math.max(0, Math.min(10, children));

  return { checkIn, checkOut, adults, children };
}

const SearchResults = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const routeLanguage = getLanguageFromPath(pathname);
  const searchBase = localizePath('/search', routeLanguage);
  const homeBase = localizePath('/', routeLanguage);
  const { setBasicInfo } = useBookingContext();
  
  const [cabins, setCabins] = useState([]);
  const [unitCountsByTypeId, setUnitCountsByTypeId] = useState({});
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [showDateAdjustBanner, setShowDateAdjustBanner] = useState(false);
  const { t } = useTranslation('booking');

  // Check if we're returning to craft flow
  const returnTo = searchParams.get('returnTo');

  const currentSearchParams = useMemo(
    () => computeValidatedSearchParams(searchParams),
    [searchParams]
  );

  // Handle draft parameter
  const draftToken = searchParams.get('draft');
  const seoTitle = 'Search availability | Drift & Dwells';
  const seoDescription = 'Browse currently available Drift & Dwells stays for your selected dates and group size.';
  const formatDateLabel = (value) => {
    const parsed = parseDateOnlyLocal(value);
    return parsed ? parsed.toLocaleDateString() : '';
  };

  // Load draft data if token is present
  useEffect(() => {
    const loadDraft = async () => {
      if (!draftToken) return;

      try {
        const response = await fetch(`/api/drafts/${draftToken}`);
        const result = await response.json();

        if (result.success) {
          const { payload } = result;
          
          // Update URL with draft data
          const urlParams = new URLSearchParams(searchParams);
          
          if (payload.checkIn) urlParams.set('checkIn', payload.checkIn);
          if (payload.checkOut) urlParams.set('checkOut', payload.checkOut);
          if (payload.adults) urlParams.set('adults', payload.adults.toString());
          if (payload.children) urlParams.set('children', payload.children.toString());
          
          // Remove draft token from URL
          urlParams.delete('draft');
          
          navigate(`${searchBase}?${urlParams.toString()}`, { replace: true });
        }
      } catch (error) {
        console.error('Error loading draft:', error);
        // Silently ignore draft loading errors
      }
    };

    loadDraft();
  }, [draftToken, navigate, searchBase, searchParams]);

  // Search for available cabins
  const searchCabins = async () => {
    try {
      setLoading(true);
      setErrorMessage('');

      const response = await availabilityAPI.search(currentSearchParams);
      
      if (response.data.success) {
        const cabinsData = response.data.data.cabins;
        // Debug: log multi-unit cabins
        const multiCabins = cabinsData.filter(c => 
          (c?.inventoryMode === 'multi' || c?.inventoryType === 'multi') && 
          (c?.cabinTypeRef || c?.cabinTypeId)
        );
        if (multiCabins.length > 0) {
          console.log('Multi-unit cabins found:', multiCabins.map(c => ({
            name: c.name,
            inventoryMode: c.inventoryMode,
            inventoryType: c.inventoryType,
            cabinTypeRef: c.cabinTypeRef,
            cabinTypeId: c.cabinTypeId
          })));
        }
        setCabins(cabinsData);
        setRetryCount(0);
      } else {
        setErrorMessage(response.data.message || 'Failed to search cabins');
      }
    } catch (err) {
      console.error('Search error:', err);
      const apiMessage = err.response?.data?.message || '';
      if (
        err.response?.status === 400 &&
        apiMessage.toLowerCase().includes('check-in date cannot be in the past') &&
        retryCount < 2
      ) {
        setRetryCount((prev) => prev + 1);
        const today = getMinSelectableStayDate();
        const tomorrow = addDays(today, 1);
        const params = new URLSearchParams(searchParams);
        params.set('checkIn', formatDateOnlyLocal(today));
        params.set('checkOut', formatDateOnlyLocal(tomorrow));
        setShowDateAdjustBanner(true);
        navigate(`${searchBase}?${params.toString()}`, { replace: true });
        return;
      }

      setErrorMessage(apiMessage || 'Error searching for cabins. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Update URL if validation changed parameters - with proper dependency management
  useEffect(() => {
    const urlParams = new URLSearchParams(searchParams);
    let urlUpdated = false;

    // Check if checkIn needs updating
    const currentCheckIn = urlParams.get('checkIn');
    if (currentSearchParams.checkIn !== currentCheckIn) {
      if (currentSearchParams.checkIn) {
        urlParams.set('checkIn', currentSearchParams.checkIn);
      } else {
        urlParams.delete('checkIn');
      }
      urlUpdated = true;
    }

    // Check if checkOut needs updating
    const currentCheckOut = urlParams.get('checkOut');
    if (currentSearchParams.checkOut !== currentCheckOut) {
      if (currentSearchParams.checkOut) {
        urlParams.set('checkOut', currentSearchParams.checkOut);
      } else {
        urlParams.delete('checkOut');
      }
      urlUpdated = true;
    }

    // Check if adults needs updating
    const currentAdults = parseInt(urlParams.get('adults')) || 2;
    if (currentSearchParams.adults !== currentAdults) {
      urlParams.set('adults', currentSearchParams.adults.toString());
      urlUpdated = true;
    }

    // Check if children needs updating
    const currentChildren = parseInt(urlParams.get('children')) || 0;
    if (currentSearchParams.children !== currentChildren) {
      urlParams.set('children', currentSearchParams.children.toString());
      urlUpdated = true;
    }

    // Only navigate if something actually changed
    if (urlUpdated) {
      const rawIn = searchParams.get('checkIn');
      const rawOut = searchParams.get('checkOut');
      const datesRewritten =
        rawIn !== currentSearchParams.checkIn || rawOut !== currentSearchParams.checkOut;
      if (datesRewritten) {
        setShowDateAdjustBanner(true);
      }
      navigate(`${searchBase}?${urlParams.toString()}`, { replace: true });
    }
  }, [currentSearchParams.checkIn, currentSearchParams.checkOut, currentSearchParams.adults, currentSearchParams.children, navigate, searchBase, searchParams]);

  // Load search results on component mount
  useEffect(() => {
    if (currentSearchParams.checkIn && currentSearchParams.checkOut) {
      searchCabins();
    } else {
      navigate(homeBase);
    }
  }, [
    currentSearchParams.checkIn,
    currentSearchParams.checkOut,
    currentSearchParams.adults,
    currentSearchParams.children,
    homeBase,
    navigate
  ]);

  // Unique cabin type ids for multi-unit results
  const multiTypeIds = useMemo(() => {
    const ids = new Set();
    for (const c of cabins) {
      const isMulti = c?.inventoryMode === 'multi' || c?.inventoryType === 'multi';
      const typeId = c?.cabinTypeRef || c?.cabinTypeId;
      if (isMulti && typeId) {
        ids.add(typeId.toString());
      }
    }
    return Array.from(ids);
  }, [cabins]);

  // Fetch unit counts for multi-unit cabin types
  useEffect(() => {
    let cancelled = false;
    const loadCounts = async () => {
      if (multiTypeIds.length === 0) {
        setUnitCountsByTypeId({});
        return;
      }
      try {
        const results = await Promise.allSettled(
          multiTypeIds.map(async (typeId) => {
            try {
              const resp = await unitAPI.getByCabinType(typeId);
              const items = resp?.data?.data?.units || [];
              const active = items.filter(u => u?.isActive !== false).length;
              return { typeId: typeId.toString(), total: items.length, active };
            } catch (err) {
              console.warn(`Failed to load units for type ${typeId}:`, err);
              return { typeId: typeId.toString(), total: 0, active: 0 };
            }
          })
        );
        if (cancelled) return;
        const next = {};
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) {
            next[r.value.typeId] = { total: r.value.total, active: r.value.active };
          }
        }
        setUnitCountsByTypeId(next);
      } catch (err) {
        console.error('Error loading unit counts:', err);
      }
    };
    loadCounts();
    return () => { cancelled = true; };
  }, [multiTypeIds]);

  if (loading) {
    return (
      <>
        <Seo
          title={seoTitle}
          description={seoDescription}
          canonicalPath="/search"
          noindex
        />
        <div className="min-h-screen bg-white">
          <div className="max-w-7xl mx-auto px-6 py-20">
            <div className="text-center py-20">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-sage"></div>
              <p className="mt-6 text-body text-gray-600">Searching for available cabins...</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Seo
        title={seoTitle}
        description={seoDescription}
        canonicalPath="/search"
        noindex
      />
      <div className="min-h-screen bg-white">
        <div className="max-w-7xl mx-auto px-6 py-20">
        {/* Search Bar */}
        <div className="mb-20">
          <Suspense
            fallback={
              <div
                className="min-h-[72px] w-full max-w-2xl rounded-xl bg-gray-100 animate-pulse"
                aria-hidden
              />
            }
          >
            <SearchBar initialData={currentSearchParams} />
          </Suspense>
          {showDateAdjustBanner && (
            <div
              role="status"
              className="mt-4 max-w-2xl rounded-xl border border-amber-200/90 bg-amber-50/95 px-4 py-3 text-sm text-amber-950 shadow-sm md:mt-5 md:px-5 md:py-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <p className="min-w-0 leading-relaxed">{t('search.datesAdjustedBanner')}</p>
                <button
                  type="button"
                  onClick={() => setShowDateAdjustBanner(false)}
                  className="shrink-0 self-end rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-amber-900 underline-offset-2 hover:underline sm:self-start"
                >
                  {t('search.dismissBanner')}
                </button>
              </div>
            </div>
          )}
          {errorMessage && (
            <p className="text-red-500 text-sm mt-4">
              {errorMessage || 'Please select valid dates and try again.'}
            </p>
          )}
        </div>

        {/* Search Results Header */}
        <div className="mb-16">
          <h1 className="headline-section mb-8">
            Available Cabins
          </h1>
          
          <div className="card-editorial p-8">
            <div className="flex flex-wrap items-center gap-8 text-body text-gray-600">
              <span className="flex items-center">
                <span className="w-2 h-2 bg-sage rounded-full mr-3"></span>
                {currentSearchParams.checkIn && formatDateLabel(currentSearchParams.checkIn)} - {currentSearchParams.checkOut && formatDateLabel(currentSearchParams.checkOut)}
              </span>
              <span className="flex items-center">
                <span className="w-2 h-2 bg-sage rounded-full mr-3"></span>
                {currentSearchParams.adults} {currentSearchParams.adults === 1 ? 'Adult' : 'Adults'}
                {currentSearchParams.children > 0 && (
                  <span>, {currentSearchParams.children} {currentSearchParams.children === 1 ? 'Child' : 'Children'}</span>
                )}
              </span>
              <span className="flex items-center">
                <span className="w-2 h-2 bg-sage rounded-full mr-3"></span>
                {cabins.length} {cabins.length === 1 ? 'Cabin' : 'Cabins'} Available
              </span>
            </div>
          </div>
        </div>

        {/* Results */}
        {cabins.length === 0 ? (
          <div className="text-center py-20" data-testid="search-empty-state">
            <h2 className="headline-subsection mb-6">
              No Available Cabins
            </h2>
            <p className="text-editorial text-gray-600 mb-12 max-w-2xl mx-auto">
              Sorry, we couldn't find any available cabins for your selected dates and group size. 
              Try adjusting your search criteria.
            </p>
            <button
              onClick={() => navigate(homeBase)}
              className="btn-pill"
            >
              new search →
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12">
            {cabins.map((cabin) => (
              <div key={cabin._id} className="card-cabin group flex flex-col h-full" data-testid="search-result-card">
                <div className="relative h-64 overflow-hidden">
                  <img
                    src={getCoverImage(cabin)}
                    alt={cabin.name}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  {/* Multi-unit pill */}
                  {(() => {
                    const isMulti = cabin?.inventoryMode === 'multi' || cabin?.inventoryType === 'multi';
                    const typeId = cabin?.cabinTypeRef || cabin?.cabinTypeId;
                    if (!isMulti || !typeId) return null;
                    const typeIdStr = typeId.toString();
                    const count = unitCountsByTypeId[typeIdStr];
                    return (
                      <div className="absolute top-6 left-6 bg-white/95 backdrop-blur-sm px-3 py-1.5 rounded-full border border-gray-200 shadow-sm z-10">
                        <span className="text-xs font-medium text-gray-800">
                          Multi-unit
                          {count?.total > 0 && (
                            <span> • {count.total} units</span>
                          )}
                        </span>
                      </div>
                    );
                  })()}
                  <div className="absolute top-6 right-6 bg-white/95 backdrop-blur-sm px-4 py-2">
                    <span className="text-sm font-light text-sage tracking-wide">
                      {cabin.capacity} {cabin.capacity === 1 ? 'Guest' : 'Guests'}
                    </span>
                  </div>
                </div>
                <div className="p-8 flex flex-col flex-grow">
                  <h3 className="headline-subsection mb-4">
                    {cabin.name}
                  </h3>
                  <p className="text-body text-gray-600 flex items-center mb-6">
                    <span className="w-1 h-1 bg-sage rounded-full mr-3"></span>
                    {cabin.location}
                  </p>
                  <p className="text-body text-gray-600 mb-8 line-clamp-3 flex-grow">
                    {cabin.description}
                  </p>
                  <div className="border-t border-gray-200 pt-6 mt-auto">
                    <div className="flex justify-between items-center mb-6">
                      <div>
                        <p className="text-body text-gray-600">
                          {cabin.totalNights} {cabin.totalNights === 1 ? 'night' : 'nights'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-serif text-2xl font-bold text-sage">
                          €{cabin.totalPrice}
                        </p>
                        <p className="text-sm text-gray-500 font-light">
                          €{cabin.pricePerNight}/night
                          {(cabin.pricingModel || 'per_night') === 'per_person' ? ' per person' : ''}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        const isMulti = cabin?.inventoryMode === 'multi' || cabin?.inventoryType === 'multi';
                        const typeSlug = cabin?.slug || cabin?.cabinTypeSlug;
                        const searchParams = new URLSearchParams(currentSearchParams).toString();

                        // If returning to craft flow, set cabinId in context and navigate back
                        if (returnTo) {
                          setBasicInfo({
                            cabinId: cabin._id,
                            checkIn: currentSearchParams.checkIn,
                            checkOut: currentSearchParams.checkOut,
                            adults: currentSearchParams.adults,
                            children: currentSearchParams.children
                          });
                          navigate(`/${returnTo}`);
                          return;
                        }

                        if (isMulti && typeSlug) {
                          navigate(`${localizePath(`/stays/${typeSlug}`, routeLanguage)}?${searchParams}`);
                          return;
                        }

                        navigate(`${localizePath(`/cabin/${cabin._id}`, routeLanguage)}?${searchParams}`);
                      }}
                      className="w-full btn-editorial text-center block py-3"
                    >
                      {returnTo ? 'Select This Cabin →' : 'view details →'}
                    </button>
                    {returnTo && (
                      <button
                        onClick={() => {
                          // Allow viewing details while preserving returnTo
                          const params = new URLSearchParams(currentSearchParams);
                          params.set('returnTo', returnTo);
                          navigate(`${localizePath(`/cabin/${cabin._id}`, routeLanguage)}?${params.toString()}`);
                        }}
                        className="w-full btn-underline text-center block py-2 mt-2"
                      >
                        view details first →
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Back to Home */}
        <div className="text-center mt-20">
          <button
            onClick={() => navigate(homeBase)}
            className="btn-underline"
          >
            ← back to home
          </button>
        </div>
        </div>
      </div>
    </>
  );
};

export default SearchResults;
