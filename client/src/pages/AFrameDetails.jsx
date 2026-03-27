import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { cabinTypeAPI, availabilityAPI, unitAPI } from '../services/api';
import { useBookingSearch } from '../context/BookingSearchContext';
import { useBookingNavigation } from '../hooks/useBookingNavigation';
import MosaicGallery from '../components/MosaicGallery';
import ReviewsSection from '../components/reviews/ReviewsSection';
import MapArrival from '../components/MapArrival';
import StickyBookingBar from '../components/StickyBookingBar';
import Seo from '../components/Seo';
import { daysBetweenDateOnly, parseDateOnlyLocal } from '../utils/dateOnly';
import './CabinDetails.css';
import '../components/gallery/lightbox.css';

// Constants
const DEFAULT_EXPERIENCES = [
  { key: 'atv_pickup', name: 'ATV pickup', price: 70, currency: 'BGN', unit: 'flat_per_stay', active: true, sortOrder: 0 },
  { key: 'horse_riding', name: 'Horse riding', price: 70, currency: 'BGN', unit: 'per_guest', active: true, sortOrder: 1 },
  { key: 'jeep_transfer', name: 'Jeep transfer', price: 60, currency: 'BGN', unit: 'flat_per_stay', active: true, sortOrder: 2 },
];

const MULTI_UNIT_SLUG = 'a-frame';

const AFrameDetails = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { openModal: openDateModal } = useBookingSearch();

  const [cabinType, setCabinType] = useState(null);
  const [availability, setAvailability] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [selectedExpKeys, setSelectedExpKeys] = useState(new Set());
  const [isMultiUnitEnabled, setIsMultiUnitEnabled] = useState(false);
  const [unitStats, setUnitStats] = useState(null); // { total, active }

  // Search criteria
  const searchCriteria = useMemo(() => ({
    checkIn: searchParams.get('checkIn'),
    checkOut: searchParams.get('checkOut'),
    adults: Math.max(1, parseInt(searchParams.get('adults'), 10) || 2),
    children: Math.max(0, parseInt(searchParams.get('children'), 10) || 0)
  }), [searchParams]);

  const updateSearchParams = useCallback((patch) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
          next.delete(key);
        } else {
          next.set(key, String(value));
        }
      });
      return next;
    });
  }, [setSearchParams]);

  const { goToConfirmOrOpenDates } = useBookingNavigation({
    bookingEntityId: cabinType?._id,
    bookingEntityType: 'cabinType',
    bookingEntitySlug: MULTI_UNIT_SLUG,
    confirmPath: '/stays/a-frame/confirm',
    searchCriteria,
    selectedExpKeys,
    openDateModal,
    navigate
  });

  // Image gallery
  const gallery = useMemo(() => {
    if (!cabinType) return [];
    return Array.isArray(cabinType.images) && cabinType.images.length
      ? cabinType.images.slice().sort((a, b) => {
          if (b.isCover !== a.isCover) return b.isCover - a.isCover;
          return (a.sort || 0) - (b.sort || 0);
        })
      : (cabinType?.imageUrl ? [{ url: cabinType.imageUrl, alt: cabinType.name || '' }] : []);
  }, [cabinType]);

  const normalizeSrc = useCallback((u) => {
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith('/')) return u;
    return `/uploads/cabins/${u}`;
  }, []);

  const lightboxGallery = useMemo(() => (
    gallery.map((img) => ({
      ...img,
      url: normalizeSrc(img.url || img),
      alt: img.alt || cabinType?.name || 'A-Frame image'
    }))
  ), [gallery, normalizeSrc, cabinType?.name]);

  const openLightbox = useCallback((index = 0) => {
    const safeIndex = Math.max(0, Math.min(index, lightboxGallery.length - 1));
    setLightboxIndex(safeIndex);
    setLightboxOpen(true);
    document.body.classList.add('lightbox-open');
  }, [lightboxGallery.length]);

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    document.body.classList.remove('lightbox-open');
  }, []);

  const goToPrevious = useCallback(() => {
    if (!lightboxGallery.length) return;
    const nextIndex = lightboxIndex === 0 ? lightboxGallery.length - 1 : lightboxIndex - 1;
    setLightboxIndex(nextIndex);
  }, [lightboxGallery.length, lightboxIndex]);

  const goToNext = useCallback(() => {
    if (!lightboxGallery.length) return;
    const nextIndex = lightboxIndex === lightboxGallery.length - 1 ? 0 : lightboxIndex + 1;
    setLightboxIndex(nextIndex);
  }, [lightboxGallery.length, lightboxIndex]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!lightboxOpen) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') goToPrevious();
      if (e.key === 'ArrowRight') goToNext();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [lightboxOpen, closeLightbox, goToPrevious, goToNext]);

  useEffect(() => (
    () => document.body.classList.remove('lightbox-open')
  ), []);

  // Experiences
  const experiences = useMemo(() => {
    const fromType = Array.isArray(cabinType?.experiences) ? cabinType.experiences.filter(x => x?.active !== false) : [];
    return (fromType.length ? fromType : DEFAULT_EXPERIENCES).slice().sort((a,b)=> (a.sortOrder||0)-(b.sortOrder||0));
  }, [cabinType?.experiences]);

  const toggleExperience = useCallback((key) => {
    setSelectedExpKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const experienceTotal = useMemo(() => {
    let guests = (searchCriteria.adults || 0) + (searchCriteria.children || 0);
    return experiences.reduce((sum, exp) => {
      if (!selectedExpKeys.has(exp.key)) return sum;
      const qty = exp.unit === 'per_guest' ? Math.max(guests, 1) : 1;
      return sum + (exp.price || 0) * qty;
    }, 0);
  }, [experiences, selectedExpKeys, searchCriteria.adults, searchCriteria.children]);

  // Pricing
  const pricing = useMemo(() => {
    if (!cabinType || !searchCriteria.checkIn || !searchCriteria.checkOut || !cabinType.pricePerNight) {
      return null;
    }
    
    try {
      const checkIn = parseDateOnlyLocal(searchCriteria.checkIn);
      const checkOut = parseDateOnlyLocal(searchCriteria.checkOut);
      
      if (!checkIn || !checkOut || isNaN(checkIn.getTime()) || isNaN(checkOut.getTime()) || checkOut <= checkIn) {
        return null;
      }
      
      const totalNights = daysBetweenDateOnly(checkIn, checkOut);
      const totalGuests = (searchCriteria.adults || 0) + (searchCriteria.children || 0);
      let totalPrice = totalNights * cabinType.pricePerNight;
      if ((cabinType.pricingModel || 'per_night') === 'per_person') {
        totalPrice *= Math.max(totalGuests, 1);
      }
      
      return { totalNights, totalPrice };
    } catch {
      return null;
    }
  }, [cabinType, searchCriteria.checkIn, searchCriteria.checkOut, searchCriteria.adults, searchCriteria.children]);

  // Highlights
  const highlights = useMemo(() => {
    const fallback = [
      'Firepit + starry sky in a protected valley',
      'Off-grid comfort: wood stove, steaming hot tub',
      '1km protected walk-in → true seclusion'
    ];
    return Array.isArray(cabinType?.highlights) && cabinType.highlights.length ? cabinType.highlights.slice(0,5) : fallback;
  }, [cabinType?.highlights]);

  // Load cabin type and availability
  useEffect(() => {
    let cancelled = false;
    
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        setAvailability(null);

        // Load cabin type
        const typeResponse = await cabinTypeAPI.getBySlug(MULTI_UNIT_SLUG);
        if (cancelled) return;
        
        if (!typeResponse.data.success) {
          setError('Cabin type not found');
          return;
        }
        
        const type = typeResponse.data.data.cabinType;
        setCabinType(type);

        const isMultiUnit = Boolean(type?.meta?.isMultiUnit);
        setIsMultiUnitEnabled(isMultiUnit);

        // Load unit stats for explanatory copy
        if (type?._id) {
          try {
            const unitsResp = await unitAPI.getByCabinType(type._id);
            const items = unitsResp?.data?.data?.units || [];
            const active = items.filter(u => u?.isActive).length;
            if (!cancelled) {
              setUnitStats({ total: items.length, active });
            }
          } catch {
            if (!cancelled) setUnitStats(null);
          }
        }

        if (!isMultiUnit) {
          setError('This stay is currently unavailable as a multi-unit experience.');
          return;
        }
        
        // Load availability if dates are provided
        if (searchCriteria.checkIn && searchCriteria.checkOut) {
          try {
            const availResponse = await availabilityAPI.checkCabinType(MULTI_UNIT_SLUG, {
              checkIn: searchCriteria.checkIn,
              checkOut: searchCriteria.checkOut,
              adults: searchCriteria.adults,
              children: searchCriteria.children
            });
            
            if (!cancelled && availResponse.data.success) {
              setAvailability(availResponse.data.data);
            }
          } catch (availErr) {
            if (cancelled) return;
            console.error('Availability load error:', availErr);
            setAvailability(null);
            setError(availErr.response?.data?.message || 'Error loading availability');
          }
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Load error:', err);
        setError(err.response?.data?.message || 'Error loading A-frame details');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadData();
    
    return () => {
      cancelled = true;
    };
  }, [searchCriteria.checkIn, searchCriteria.checkOut, searchCriteria.adults, searchCriteria.children]);

  // Early returns
  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        <div className="cabin-container py-20">
          <div className="text-center py-20">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-sage" aria-label="Loading" />
            <p className="mt-6 text-sm text-gray-600">Loading A-frame details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error && !cabinType) {
    return (
      <div className="min-h-screen bg-white">
        <div className="cabin-container py-20">
          <div className="text-center py-20">
            <h2 className="section-title mb-6">Error</h2>
            <p className="text-base text-gray-600 mb-12" role="alert">{error}</p>
            <button onClick={() => navigate('/')} className="btn-pill">back to home →</button>
          </div>
        </div>
      </div>
    );
  }

  if (!cabinType) return null;

  if (!isMultiUnitEnabled) {
    return (
      <div className="min-h-screen bg-white">
        <div className="cabin-container py-20">
          <div className="text-center py-20">
            <h2 className="section-title mb-6">Currently Unavailable</h2>
            <p className="text-base text-gray-600 mb-12" role="alert">
              Multi-unit cabins are not available right now. Please check back later or explore our other stays.
            </p>
            <button onClick={() => navigate('/')} className="btn-pill">browse other cabins →</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white cabin-details-page">
      <Seo
        title={`${cabinType?.name || 'A-Frame'} | Drift & Dwells`}
        description={cabinType?.description?.substring(0, 160) || 'Book an A-frame cabin with Drift & Dwells.'}
        canonicalPath="/stays/a-frame"
        ogImage={cabinType?.imageUrl}
      />
      {/* Hero + intro — now using the same grid geometry as CabinDetails */}
      <div className="cabin-page-outer cabin-hero-grid mt-8 mb-24">
        {/* Row 1: title block */}
        <div className="cabin-hero-title-block">
          <button onClick={() => navigate(-1)} className="btn-underline mb-8 mt-8">
            ← back to search results
          </button>

          <div className="space-y-2 mb-3 lg:mb-4">
            <h1 className="cabin-title">{cabinType.name || 'A-frame'}</h1>

            <div className="trust-row flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {typeof cabinType.averageRating === 'number' && cabinType.averageRating > 0 && (
                <>
                  <span className="flex items-center gap-1">
                    <span className="text-amber-500" aria-hidden="true">★</span>
                    <span className="rating-score">{cabinType.averageRating.toFixed(2)}</span>
                  </span>
                  {cabinType.reviewsCount > 0 && (
                    <>
                      <span className="text-gray-400">•</span>
                      <a
                        href="#guest-reviews"
                        className="text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline"
                      >
                        {cabinType.reviewsCount} {cabinType.reviewsCount === 1 ? 'review' : 'reviews'}
                      </a>
                    </>
                  )}
                </>
              )}
              {cabinType.hostName?.trim() && (
                <>
                  <span className="text-gray-400">•</span>
                  <span className="text-gray-600">
                    Hosted by <span className="font-medium">{cabinType.hostName.trim()}</span>
                  </span>
                </>
              )}
              {availability && availability.availabilitySummary && (
                <>
                  <span className="text-gray-400">•</span>
                  <span className="text-gray-600">
                    {availability.availabilitySummary.availableUnits.length} of {availability.availabilitySummary.totalUnits} units available
                  </span>
                </>
              )}
            </div>

            {/* Multi-unit explanatory copy */}
            {isMultiUnitEnabled && (
              <p className="text-sm text-gray-700 mt-1.5">
                {unitStats?.total ? (
                  <>
                    This listing has <strong>{unitStats.total} identical units</strong>. We’ll assign one automatically after you book.
                  </>
                ) : (
                  <>This listing has <strong>multiple identical units</strong>. We’ll assign one automatically after you book.</>
                )}{' '}
                {searchCriteria.checkIn && searchCriteria.checkOut && availability?.availabilitySummary && (
                  <span>
                    <strong> {availability.availabilitySummary.availableUnits.length} units available</strong> for your dates.
                  </span>
                )}
              </p>
            )}
          </div>
        </div>

        {/* Row 2: gallery */}
        <div className="cabin-hero-gallery-wrap mt-6 w-full">
          {gallery.length > 0 && (
            <MosaicGallery
              images={gallery}
              onOpenLightbox={(index) => openLightbox(index)}
            />
          )}
        </div>

        {/* Right column spacer — rows 1–2; reserves space so future card can start below gallery */}
        <div className="cabin-hero-right-spacer hidden lg:block" aria-hidden="true" />

        {/* Row 3: main content on the left */}
        <div className="cabin-hero-content">
        {/* Quick Book Strip — mobile only; desktop has single booking card on right */}
        <div className="mt-6 p-4 md:p-5 bg-gradient-to-br from-sage/10 via-white to-sage/5 border border-sage/20 rounded-xl shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 lg:hidden">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
            <div>
              <span className="text-[10px] uppercase tracking-[0.2em] text-gray-500 font-medium">Price</span>
              <p className="text-xl md:text-2xl font-semibold text-gray-900 tabular-nums mt-0.5">
                {pricing
                  ? `€${(pricing.totalPrice + (experienceTotal || 0)).toLocaleString()} total`
                  : cabinType?.pricePerNight
                    ? `From €${cabinType.pricePerNight.toLocaleString()}/night`
                    : 'Select dates for pricing'}
              </p>
              {pricing && (
                <p className="text-sm text-gray-500 mt-0.5">
                  {pricing.totalNights} {pricing.totalNights === 1 ? 'night' : 'nights'}
                  {cabinType?.pricePerNight && ` · €${cabinType.pricePerNight.toLocaleString()}/night`}
                </p>
              )}
            </div>
          </div>
          <div className="flex-shrink-0">
            <button
              type="button"
              onClick={goToConfirmOrOpenDates}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-[#81887A] text-white font-semibold text-sm hover:opacity-95 transition-all shadow-sm hover:shadow-md min-h-[44px] touch-manipulation"
            >
              {searchCriteria.checkIn && searchCriteria.checkOut ? 'Continue to payment →' : 'Select dates'}
            </button>
          </div>
        </div>

          <div className="space-y-4 mt-6">
            {cabinType.location && (
              <p className="text-sm text-gray-600 flex items-center">
                <span className="w-1.5 h-1.5 bg-sage rounded-full mr-2" aria-hidden="true"></span>
                {cabinType.location}
              </p>
            )}
            {cabinType.description && (
              <p className="text-base text-gray-700 leading-relaxed">
                {cabinType.description}
              </p>
            )}
          </div>

          {highlights && highlights.length > 0 && (
            <div className="mt-12 md:mt-16">
              <h2 className="section-title mb-4">Why you'll love it</h2>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-y-2.5 gap-x-6 text-gray-700 text-base">
                {highlights.map((h, i) => (
                  <li key={`hl-${i}`} className="flex items-start gap-2.5">
                    <span className="text-[#81887A] text-sm mt-[0.1em]" aria-hidden="true">✓</span>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {cabinType.amenities && cabinType.amenities.length > 0 && (
            <div className="space-y-4 mt-12 md:mt-16">
              <h2 className="section-title">Amenities</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {cabinType.amenities.map((amenity, index) => (
                  <div key={`amenity-${index}`} className="flex items-center text-sm text-gray-600">
                    <span className="w-1.5 h-1.5 bg-sage rounded-full mr-2" aria-hidden="true"></span>
                    <span>{amenity}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Guest Reviews and map now live in the main content flow, like CabinDetails */}
          <div className="mt-12 md:mt-16 reviews-col" id="details">
            <h2 className="section-title" id="guest-reviews">Guest Reviews</h2>
            <ReviewsSection 
              cabinId={cabinType._id}
              averageRating={cabinType.averageRating}
              reviewCount={cabinType.reviewsCount}
              hideHeading={true}
            />
            <MapArrival cabin={cabinType} />
          </div>
        </div>

        {/* RIGHT: booking card — Cabin-standard compact card (desktop only) */}
        <aside className="cabin-hero-right hidden lg:block" aria-label="Reservation">
          <div className="booking-card-compact rounded-2xl border border-gray-200/80 shadow-sm bg-white p-5">
            {pricing ? (
              <>
                <div className="mb-4">
                  <p className="text-2xl font-semibold text-gray-900 tabular-nums">
                    €{(pricing.totalPrice + (experienceTotal || 0)).toLocaleString()}
                    <span className="text-base font-normal text-gray-500 ml-1">total</span>
                  </p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {pricing.totalNights} {pricing.totalNights === 1 ? 'night' : 'nights'}
                    {cabinType?.pricePerNight && ` · €${cabinType.pricePerNight.toLocaleString()}/night`}
                  </p>
                </div>

                <div className="space-y-2 text-sm border-t border-gray-100 pt-4">
                  <div className="flex justify-between items-center gap-3 py-1.5">
                    <span className="text-gray-500">Check-in</span>
                    <input
                      type="date"
                      value={searchCriteria.checkIn || ''}
                      onChange={(e) => updateSearchParams({ checkIn: e.target.value })}
                      className="input-editorial h-8 px-2 py-1 text-xs text-gray-900 w-[150px]"
                    />
                  </div>
                  <div className="flex justify-between items-center gap-3 py-1.5">
                    <span className="text-gray-500">Check-out</span>
                    <input
                      type="date"
                      value={searchCriteria.checkOut || ''}
                      onChange={(e) => updateSearchParams({ checkOut: e.target.value })}
                      className="input-editorial h-8 px-2 py-1 text-xs text-gray-900 w-[150px]"
                    />
                  </div>

                  <div className="flex justify-between items-center gap-3 py-1.5">
                    <span className="text-gray-500">Guests</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updateSearchParams({
                          adults: Math.max(1, (searchCriteria.adults || 1) - 1)
                        })}
                        className="w-6 h-6 rounded-full border border-gray-300 flex items-center justify-center text-xs text-gray-700 hover:bg-gray-50"
                        aria-label="Decrease guests"
                      >
                        −
                      </button>
                      <span className="text-gray-900 text-sm min-w-[2rem] text-center">
                        {(searchCriteria.adults || 0) + (searchCriteria.children || 0)}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateSearchParams({
                          adults: Math.max(1, (searchCriteria.adults || 1) + 1)
                        })}
                        className="w-6 h-6 rounded-full border border-gray-300 flex items-center justify-center text-xs text-gray-700 hover:bg-gray-50"
                        aria-label="Increase guests"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                {experiences.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <div className="text-sm text-gray-600 mb-1 flex items-center justify-between">
                      <span>Add experiences {selectedExpKeys.size > 0 && `· €${experienceTotal.toLocaleString()}`}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {experiences.map(exp => {
                        const selected = selectedExpKeys.has(exp.key);
                        const guests = (searchCriteria.adults || 0) + (searchCriteria.children || 0);
                        const qty = exp.unit === 'per_guest' ? Math.max(guests, 1) : 1;
                        const showQty = exp.unit === 'per_guest' && guests > 1;
                        return (
                          <button
                            key={exp.key}
                            type="button"
                            onClick={() => toggleExperience(exp.key)}
                            className={`px-2.5 py-1 rounded-lg text-xs border ${selected ? 'bg-[#81887A] text-white border-[#81887A]' : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-300'}`}
                            aria-pressed={selected}
                          >
                            {exp.name}{showQty && ` ×${qty}`} · {exp.price} {exp.currency}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  data-booking-primary-cta="true"
                  onClick={goToConfirmOrOpenDates}
                  className="w-full mt-5 py-3.5 rounded-xl bg-[#81887A] text-white font-semibold text-sm hover:opacity-95 transition-all shadow-sm"
                >
                  {!searchCriteria.checkIn || !searchCriteria.checkOut ? 'Select dates' : 'Continue to payment'}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-500 mb-4">
                  Add dates to see price and availability.
                </p>
                <button
                  type="button"
                  onClick={() => openDateModal?.()}
                  className="w-full py-3.5 rounded-xl bg-[#81887A] text-white font-semibold text-sm hover:opacity-95 transition-all"
                >
                  Select dates
                </button>
              </>
            )}
          </div>
        </aside>
      </div>

      <StickyBookingBar
        className="lg:hidden"
        label={
          pricing
            ? `€${(pricing.totalPrice + (experienceTotal || 0)).toLocaleString()} total`
            : cabinType?.pricePerNight
              ? `From €${cabinType.pricePerNight.toLocaleString()}/night`
              : 'Select dates for pricing'
        }
        subLabel={
          pricing
            ? `${pricing.totalNights} ${pricing.totalNights === 1 ? 'night' : 'nights'}${cabinType?.pricePerNight ? ` · €${cabinType.pricePerNight.toLocaleString()}/night` : ''}`
            : null
        }
        buttonLabel={searchCriteria.checkIn && searchCriteria.checkOut ? 'Continue to payment →' : 'Select dates'}
        onButtonClick={goToConfirmOrOpenDates}
      />

      {lightboxOpen && lightboxGallery.length > 0 && (
        <div className="lightbox-overlay" role="dialog" aria-modal="true">
          <div className="lightbox-container">
            <button
              className="lightbox-close"
              aria-label="Close gallery"
              onClick={closeLightbox}
            >
              ×
            </button>
            {lightboxGallery.length > 1 && (
              <>
                <button
                  className="lightbox-nav lightbox-prev"
                  aria-label="Previous photo"
                  onClick={goToPrevious}
                >
                  ‹
                </button>
                <button
                  className="lightbox-nav lightbox-next"
                  aria-label="Next photo"
                  onClick={goToNext}
                >
                  ›
                </button>
              </>
            )}
            <div className="lightbox-image-container" onClick={closeLightbox}>
              <img
                src={lightboxGallery[lightboxIndex]?.url}
                alt={lightboxGallery[lightboxIndex]?.alt || `Photo ${lightboxIndex + 1}`}
                className="lightbox-image"
                loading="eager"
                decoding="async"
              />
            </div>
            <div className="lightbox-caption">
              <div className="lightbox-counter">
                {lightboxIndex + 1} / {lightboxGallery.length}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AFrameDetails;

