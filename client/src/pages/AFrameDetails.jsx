import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { cabinTypeAPI, availabilityAPI, bookingAPI, unitAPI } from '../services/api';
import MosaicGallery from '../components/MosaicGallery';
import ReviewsSection from '../components/reviews/ReviewsSection';
import MapArrival from '../components/MapArrival';
import Seo from '../components/Seo';
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
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const [cabinType, setCabinType] = useState(null);
  const [availability, setAvailability] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [selectedExpKeys, setSelectedExpKeys] = useState(new Set());
  const [isMultiUnitEnabled, setIsMultiUnitEnabled] = useState(false);
  const [unitStats, setUnitStats] = useState(null); // { total, active }

  // Form state
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    specialRequests: ''
  });

  const [formErrors, setFormErrors] = useState({});

  // Search criteria
  const searchCriteria = useMemo(() => ({
    checkIn: searchParams.get('checkIn'),
    checkOut: searchParams.get('checkOut'),
    adults: Math.max(1, parseInt(searchParams.get('adults'), 10) || 2),
    children: Math.max(0, parseInt(searchParams.get('children'), 10) || 0)
  }), [searchParams]);

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
      const checkIn = new Date(searchCriteria.checkIn);
      const checkOut = new Date(searchCriteria.checkOut);
      
      if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime()) || checkOut <= checkIn) {
        return null;
      }
      
      const totalNights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
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

  // Form handlers
  const handleInputChange = useCallback((field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (formErrors[field]) {
      setFormErrors(prev => ({ ...prev, [field]: null }));
    }
  }, [formErrors]);

  const validateForm = useCallback(() => {
    const errors = {};
    if (!formData.firstName.trim()) errors.firstName = 'First name is required';
    if (!formData.lastName.trim()) errors.lastName = 'Last name is required';
    if (!formData.email.trim()) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Please enter a valid email address';
    }
    if (!formData.phone.trim()) {
      errors.phone = 'Phone number is required';
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }, [formData]);

  const handleBookingSubmit = useCallback(async (e) => {
    e.preventDefault();
    
    if (!validateForm()) return;
    if (!cabinType || !searchCriteria.checkIn || !searchCriteria.checkOut) {
      setError('Please ensure check-in and check-out dates are selected');
      return;
    }

    if (!isMultiUnitEnabled) {
      setError('Multi-unit cabin bookings are currently disabled.');
      return;
    }

    // Check availability
    if (!availability || !availability.cabinType?.available) {
      setError('No units available for the selected dates');
      return;
    }

    try {
      setBookingLoading(true);
      setError(null);
      
      const bookingData = {
        cabinTypeId: cabinType._id,
        checkIn: searchCriteria.checkIn,
        checkOut: searchCriteria.checkOut,
        adults: searchCriteria.adults,
        children: searchCriteria.children,
        guestInfo: {
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          email: formData.email.trim(),
          phone: formData.phone.trim()
        },
        specialRequests: formData.specialRequests.trim()
      };

      const response = await bookingAPI.create(bookingData);
      
      if (response.data.success) {
        const bookingId = response.data.data?.booking?._id;
        setBookingSuccess(true);
        if (bookingId) {
          setTimeout(() => {
            navigate(`/booking-success/${bookingId}`);
          }, 2000);
        }
      } else {
        setError(response.data.message || 'Error creating booking. Please try again.');
      }
    } catch (err) {
      console.error('Booking error:', err);
      setError(err.response?.data?.message || 'Error creating booking. Please try again.');
    } finally {
      setBookingLoading(false);
    }
  }, [validateForm, cabinType, searchCriteria, formData, availability, navigate, isMultiUnitEnabled]);

  const formatDate = useCallback((dateString) => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return '';
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '';
    }
  }, []);

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
      <div className="cabin-container">
        <button onClick={() => navigate(-1)} className="btn-underline mb-8 mt-8">← back to search results</button>

        <div className="space-y-2 mb-6">
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
                    <a href="#guest-reviews" className="text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline">
                      {cabinType.reviewsCount} {cabinType.reviewsCount === 1 ? 'review' : 'reviews'}
                    </a>
                  </>
                )}
              </>
            )}
            {cabinType.hostName?.trim() && (
              <>
                <span className="text-gray-400">•</span>
                <span className="text-gray-600">Hosted by <span className="font-medium">{cabinType.hostName.trim()}</span></span>
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
            <p className="text-sm text-gray-700 mt-2">
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

        {gallery.length > 0 && (
          <div className="mt-6 w-full">
            <MosaicGallery images={gallery} onOpenLightbox={(index) => openLightbox(index)} />
          </div>
        )}

        <div className="space-y-4 mt-6">
          {cabinType.location && (
            <p className="text-sm text-gray-600 flex items-center">
              <span className="w-1.5 h-1.5 bg-sage rounded-full mr-2" aria-hidden="true"></span>
              {cabinType.location}
            </p>
          )}
          {cabinType.description && (
            <p className="text-base text-gray-700 leading-relaxed">{cabinType.description}</p>
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
      </div>

      <section className="cabin-container details-grid mt-12 md:mt-16 mb-24">
        <div className="reviews-col">
          <h2 className="section-title" id="guest-reviews">Guest Reviews</h2>
          <ReviewsSection 
            cabinId={cabinType._id}
            averageRating={cabinType.averageRating}
            reviewCount={cabinType.reviewsCount}
            hideHeading={true}
          />
          <MapArrival cabin={cabinType} />
        </div>

        <aside className="aside-sticky" aria-label="Booking information">
          <div className="booking-card rounded-2xl border border-gray-200 shadow-md bg-white">
            <h3 className="text-xl font-bold text-gray-900 mb-6">Booking Summary</h3>
              
            {pricing && (
              <div className="space-y-3 text-sm">
                {searchCriteria.checkIn && (
                  <div className="flex justify-between items-center py-2">
                    <span className="text-gray-600">Check-in</span>
                    <span className="font-medium text-gray-900">{formatDate(searchCriteria.checkIn)}</span>
                  </div>
                )}
                {searchCriteria.checkOut && (
                  <div className="flex justify-between items-center py-2">
                    <span className="text-gray-600">Check-out</span>
                    <span className="font-medium text-gray-900">{formatDate(searchCriteria.checkOut)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-2">
                  <span className="text-gray-600">Guests</span>
                  <span className="font-medium text-gray-900">
                    {searchCriteria.adults} {searchCriteria.adults === 1 ? 'Adult' : 'Adults'}
                    {searchCriteria.children > 0 && (
                      <span>, {searchCriteria.children} {searchCriteria.children === 1 ? 'Child' : 'Children'}</span>
                    )}
                  </span>
                </div>
                {availability && availability.availabilitySummary && (
                  <div className="flex justify-between items-center py-2">
                    <span className="text-gray-600">Available units</span>
                    <span className="font-medium text-gray-900">
                      {availability.availabilitySummary.availableUnits.length} of {availability.availabilitySummary.totalUnits}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center py-2">
                  <span className="text-gray-600">Nights</span>
                  <span className="font-medium text-gray-900">{pricing.totalNights}</span>
                </div>
                {cabinType.pricePerNight && (
                  <div className="flex justify-between items-center py-2">
                    <span className="text-gray-600">Price per night</span>
                    <span className="font-medium text-gray-900 tabular-nums">
                      €{cabinType.pricePerNight.toLocaleString()} / night
                      {(cabinType.pricingModel || 'per_night') === 'per_person' ? ' per person' : ''}
                    </span>
                  </div>
                )}
                
                {experiences.length > 0 && (
                  <div className="py-3">
                    <div className="text-sm font-semibold text-gray-900 mb-2">Experience add-ons</div>
                    <div className="flex flex-wrap gap-2">
                      {experiences.map(exp => {
                        const selected = selectedExpKeys.has(exp.key);
                        const guests = (searchCriteria.adults || 0) + (searchCriteria.children || 0);
                        const qty = exp.unit === 'per_guest' ? Math.max(guests, 1) : 1;
                        return (
                          <button
                            key={exp.key}
                            type="button"
                            onClick={() => toggleExperience(exp.key)}
                            className={`px-3 py-1.5 rounded-full text-sm inline-flex items-center gap-2 border ${selected ? 'bg-[#81887A] text-white border-[#81887A]' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'}`}
                            aria-pressed={selected}
                          >
                            <span>{exp.name}</span>
                            <span className="opacity-80">· {exp.price} {exp.currency}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="border-t border-gray-200 pt-3 mt-3">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-sm">Total</span>
                    <span className="font-semibold text-base text-gray-900 tabular-nums">€{(pricing.totalPrice + (experienceTotal || 0)).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            )}

            {!pricing && (
              <p className="text-sm text-gray-500 py-4">Please select check-in and check-out dates to see pricing.</p>
            )}

            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800" role="alert">
                {error}
              </div>
            )}

            {bookingSuccess ? (
              <div className="mt-6 p-4 text-center" role="alert">
                <h2 className="text-base font-semibold mb-3">Booking Submitted!</h2>
                <p className="text-sm text-gray-600">Your booking request has been submitted successfully.</p>
              </div>
            ) : (
              <form onSubmit={handleBookingSubmit} className="mt-6 space-y-4" noValidate>
                <h2 className="text-base font-semibold mb-4">Guest Information</h2>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="firstName" className="label-editorial">First Name *</label>
                    <input
                      id="firstName"
                      name="firstName"
                      type="text"
                      value={formData.firstName}
                      onChange={(e) => handleInputChange('firstName', e.target.value)}
                      className={`input-editorial ${formErrors.firstName ? 'border-red-500' : ''}`}
                      required
                    />
                    {formErrors.firstName && (
                      <p className="text-red-500 text-xs mt-1" role="alert">{formErrors.firstName}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="lastName" className="label-editorial">Last Name *</label>
                    <input
                      id="lastName"
                      name="lastName"
                      type="text"
                      value={formData.lastName}
                      onChange={(e) => handleInputChange('lastName', e.target.value)}
                      className={`input-editorial ${formErrors.lastName ? 'border-red-500' : ''}`}
                      required
                    />
                    {formErrors.lastName && (
                      <p className="text-red-500 text-xs mt-1" role="alert">{formErrors.lastName}</p>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="email" className="label-editorial">Email *</label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    className={`input-editorial ${formErrors.email ? 'border-red-500' : ''}`}
                    required
                  />
                  {formErrors.email && (
                    <p className="text-red-500 text-xs mt-1" role="alert">{formErrors.email}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="phone" className="label-editorial">Phone *</label>
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => handleInputChange('phone', e.target.value)}
                    className={`input-editorial ${formErrors.phone ? 'border-red-500' : ''}`}
                    required
                  />
                  {formErrors.phone && (
                    <p className="text-red-500 text-xs mt-1" role="alert">{formErrors.phone}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="specialRequests" className="label-editorial">Special Requests</label>
                  <textarea
                    id="specialRequests"
                    name="specialRequests"
                    value={formData.specialRequests}
                    onChange={(e) => handleInputChange('specialRequests', e.target.value)}
                    className="input-editorial"
                    rows="3"
                    placeholder="Any special requests or notes..."
                  />
                </div>

                <button
                  type="submit"
                  disabled={bookingLoading || !pricing || !availability?.cabinType.available}
                  className="w-full bg-sage text-white py-3 px-4 rounded-lg font-semibold hover:bg-sage-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {bookingLoading ? 'Submitting...' : 'Book Now'}
                </button>
              </form>
            )}
          </div>
        </aside>
      </section>

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

