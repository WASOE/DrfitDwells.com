import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBookingContext } from '../../context/BookingContext';
import { cabinAPI, bookingAPI } from '../../services/api';

const Step4Summary = () => {
  const navigate = useNavigate();
  const { 
    cabinId,
    checkIn,
    checkOut,
    adults,
    children,
    tripType,
    customTripType,
    transportMethod,
    guestInfo,
    setCurrentStep
  } = useBookingContext();
  
  const [cabin, setCabin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Load cabin data
  useEffect(() => {
    const loadCabin = async () => {
      if (!cabinId) {
        // No cabin selected - redirect to search with soft prompt
        const searchParams = new URLSearchParams();
        if (checkIn) searchParams.set('checkIn', checkIn);
        if (checkOut) searchParams.set('checkOut', checkOut);
        if (adults) searchParams.set('adults', adults.toString());
        if (children) searchParams.set('children', children.toString());
        navigate(`/search?${searchParams.toString()}`);
        return;
      }

      try {
        setLoading(true);
        const response = await cabinAPI.getById(cabinId);
        
        if (response.data.success) {
          setCabin(response.data.data.cabin);
        } else {
          setError('Cabin not found');
        }
      } catch (err) {
        console.error('Load cabin error:', err);
        setError('Error loading cabin details');
      } finally {
        setLoading(false);
      }
    };

    loadCabin();
  }, [cabinId, navigate, checkIn, checkOut, adults, children]);

  // Calculate pricing
  const calculatePricing = () => {
    if (!cabin || !checkIn || !checkOut) return null;

    const timeDiff = new Date(checkOut).getTime() - new Date(checkIn).getTime();
    const totalNights = Math.ceil(timeDiff / (1000 * 3600 * 24));
    const totalGuests = adults + children;
    
    const cabinCost = cabin.pricePerNight * totalNights;
    const transportCost = transportMethod ? transportMethod.pricePerPerson * totalGuests : 0;
    const romanticSetupCost = guestInfo.romanticSetup ? 30 : 0;
    
    const totalCost = cabinCost + transportCost + romanticSetupCost;

    return {
      totalNights,
      totalGuests,
      cabinCost,
      transportCost,
      romanticSetupCost,
      totalCost
    };
  };

  const pricing = calculatePricing();

  // Format trip type display
  const getTripTypeDisplay = () => {
    if (tripType === 'other') {
      return customTripType || 'Custom Experience';
    }
    
    const tripTypeMap = {
      'romantic': 'Romantic Getaway',
      'family': 'Family Retreat',
      'solo': 'Solo Reset',
      'digital-detox': 'Digital Detox',
      'creative': 'Creative Escape',
      'nature': 'Nature Exploration',
      'adventure': 'Adventure Weekend'
    };
    
    return tripTypeMap[tripType] || tripType;
  };

  // Split full name into first and last name
  const splitFullName = (fullName) => {
    const nameParts = fullName.trim().split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    return { firstName, lastName };
  };

  const handleConfirmBooking = async () => {
    // Guard: don't POST without cabinId
    if (!cabinId) {
      const searchParams = new URLSearchParams();
      if (checkIn) searchParams.set('checkIn', checkIn);
      if (checkOut) searchParams.set('checkOut', checkOut);
      if (adults) searchParams.set('adults', adults.toString());
      if (children) searchParams.set('children', children.toString());
      navigate(`/search?${searchParams.toString()}`, { replace: true });
      return;
    }

    if (!cabin || !pricing) return;

    try {
      setSubmitting(true);
      setError(null);

      const { firstName, lastName } = splitFullName(guestInfo.fullName);

      const bookingData = {
        cabinId,
        checkIn: new Date(checkIn),
        checkOut: new Date(checkOut),
        adults,
        children,
        guestInfo: {
          firstName,
          lastName,
          email: guestInfo.email,
          phone: guestInfo.phone || 'Not provided'
        },
        totalPrice: pricing.totalCost,
        specialRequests: guestInfo.specialRequests || '',
        // Legacy fields for backward compatibility
        tripType: getTripTypeDisplay(),
        transportMethod: transportMethod?.type || 'Not selected',
        romanticSetup: guestInfo.romanticSetup || false,
        // Future-proof craft object
        craft: {
          version: 1,
          tripType: getTripTypeDisplay(),
          transportMethod: transportMethod?.type || 'Not selected',
          extras: {
            romanticSetup: guestInfo.romanticSetup || false,
            customTripType: customTripType || '',
            specialRequests: guestInfo.specialRequests || ''
          }
        },
        status: 'pending'
      };

      console.log('[Step4] Submitting booking data:', {
        cabinId,
        hasCabin: !!cabin,
        hasPricing: !!pricing,
        bookingDataKeys: Object.keys(bookingData),
        guestInfo: bookingData.guestInfo,
        craft: bookingData.craft
      });

      const response = await bookingAPI.create(bookingData);
      
      console.log('[Step4] Booking API response:', {
        status: response?.status,
        success: response?.data?.success,
        hasData: !!response?.data?.data,
        hasBooking: !!response?.data?.data?.booking,
        fullResponse: response?.data
      });
      
      if (response.data.success) {
        // Tolerant bookingId extraction (handle multiple response shapes)
        const bookingObj = 
          response?.data?.data?.booking ?? 
          response?.data?.booking ?? 
          response?.data;
        
        const bookingId = 
          bookingObj?._id ?? 
          bookingObj?.id ?? 
          bookingObj?.bookingId ?? 
          null;

        console.log('[Step4] Extracted bookingId:', {
          bookingId,
          bookingObjKeys: bookingObj ? Object.keys(bookingObj) : null,
          attemptedPaths: [
            'response?.data?.data?.booking?._id',
            'response?.data?.booking?._id',
            'response?.data?._id'
          ]
        });

        if (!bookingId) {
          console.error('[Step4] Booking created but no ID in response', {
            responseData: response?.data,
            responseStatus: response?.status,
            bookingObj: bookingObj
          });
          // Fallback: go home with a flag so we see the error visibly
          setError('Booking was created but we could not retrieve the booking ID. Please check your bookings in the admin panel.');
          return;
        }

        console.log('[Step4] Navigating to success page with bookingId:', bookingId);
        setCurrentStep(1); // Reset for next booking
        navigate(`/booking-success/${bookingId}`, { replace: true });
      } else {
        console.error('[Step4] Booking creation failed:', response.data.message);
        setError(response.data.message || 'Failed to create booking');
      }
    } catch (err) {
      console.error('[Step4] Booking creation exception:', err);
      // Log full error details for debugging
      console.error('[Step4] Error details:', {
        message: err.message,
        response: err.response?.data,
        status: err.response?.status,
        statusText: err.response?.statusText,
        fullError: err
      });
      
      const errorMessage = err.response?.data?.message || 
                          err.response?.data?.error ||
                          err.message || 
                          'Failed to create booking. Please try again.';
      
      setError(errorMessage);
      // Don't navigate away - show error to user
    } finally {
      setSubmitting(false);
    }
  };

  const handleBack = () => {
    navigate('/craft/step-3');
  };

  const handleEditStep = (step) => {
    navigate(`/craft/step-${step}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-drift-green/5 to-drift-light-green/5">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center py-16">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-drift-green"></div>
            <p className="mt-4 text-gray-600">Loading your retreat summary...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error && !cabin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-drift-green/5 to-drift-light-green/5">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center py-16">
            <div className="text-red-500 text-6xl mb-4">⚠️</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Error</h2>
            <p className="text-gray-600 mb-8">{error}</p>
            <button
              onClick={() => navigate('/')}
              className="btn-primary"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!cabin || !pricing) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-drift-green/5 to-drift-light-green/5">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center py-16">
            <div className="text-gray-500 text-6xl mb-4">📋</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Missing Information</h2>
            <p className="text-gray-600 mb-8">Please complete all booking steps first.</p>
            <button
              onClick={() => navigate('/craft/step-1')}
              className="btn-primary"
            >
              Start Over
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto px-6 py-20">
        {/* Header */}
        <div className="text-center mb-20">
          <div className="flex items-center justify-center mb-12">
            <div className="w-8 h-8 bg-sage rounded-full flex items-center justify-center mr-6">
              <span className="text-white font-light text-sm">1</span>
            </div>
            <div className="h-px w-20 bg-sage"></div>
            <div className="w-8 h-8 bg-sage rounded-full flex items-center justify-center mx-6">
              <span className="text-white font-light text-sm">2</span>
            </div>
            <div className="h-px w-20 bg-sage"></div>
            <div className="w-8 h-8 bg-sage rounded-full flex items-center justify-center mx-6">
              <span className="text-white font-light text-sm">3</span>
            </div>
            <div className="h-px w-20 bg-sage"></div>
            <div className="w-8 h-8 bg-sage rounded-full flex items-center justify-center ml-6">
              <span className="text-white font-light text-sm">4</span>
            </div>
          </div>
          
          <h1 className="headline-section mb-8">
            Your retreat is almost ready
          </h1>
          <p className="text-editorial text-gray-600 mb-6">
            Just one more step to confirm your stay
          </p>
          <p className="text-sm text-gray-500 tracking-wide uppercase">
            Review your details and confirm your booking
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-16">
          {/* Booking Details */}
          <div className="lg:col-span-2 space-y-12">
            {/* Cabin & Dates */}
            <div className="card-editorial p-8">
              <div className="flex items-center justify-between mb-8">
                <h2 className="headline-subsection">Your Retreat</h2>
                <button
                  onClick={() => handleEditStep(1)}
                  className="btn-underline"
                >
                  edit
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                <div>
                  <h3 className="font-serif text-2xl font-bold text-black mb-4">{cabin.name}</h3>
                  <p className="text-body text-gray-600 mb-4 flex items-center">
                    <span className="w-2 h-2 bg-sage rounded-full mr-3"></span>
                    {cabin.location}
                  </p>
                  <p className="text-body text-gray-600">{cabin.description}</p>
                </div>
                
                <div className="space-y-6">
                  <div>
                    <span className="text-xs text-gray-600 uppercase tracking-wide">Check-in:</span>
                    <p className="font-light text-black mt-1">{new Date(checkIn).toLocaleDateString('en-US', { 
                      weekday: 'long', 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    })}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-600 uppercase tracking-wide">Check-out:</span>
                    <p className="font-light text-black mt-1">{new Date(checkOut).toLocaleDateString('en-US', { 
                      weekday: 'long', 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    })}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-600 uppercase tracking-wide">Duration:</span>
                    <p className="font-light text-black mt-1">{pricing.totalNights} {pricing.totalNights === 1 ? 'night' : 'nights'}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Trip Type & Transport */}
            <div className="card-editorial p-8">
              <div className="flex items-center justify-between mb-8">
                <h2 className="headline-subsection">Experience Details</h2>
                <button
                  onClick={() => handleEditStep(1)}
                  className="btn-underline"
                >
                  edit
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                <div>
                  <span className="text-xs text-gray-600 uppercase tracking-wide">Trip Type:</span>
                  <p className="font-light text-black text-lg mt-1">{getTripTypeDisplay()}</p>
                </div>
                
                {transportMethod && (
                  <div>
                    <span className="text-xs text-gray-600 uppercase tracking-wide">Arrival Method:</span>
                    <p className="font-light text-black mt-1">{transportMethod.type}</p>
                    <p className="text-body text-gray-600 mt-1">{transportMethod.duration}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Guest Information */}
            <div className="card-editorial p-8">
              <div className="flex items-center justify-between mb-8">
                <h2 className="headline-subsection">Guest Information</h2>
                <button
                  onClick={() => handleEditStep(3)}
                  className="btn-underline"
                >
                  edit
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                <div className="space-y-6">
                  <div>
                    <span className="text-xs text-gray-600 uppercase tracking-wide">Name:</span>
                    <p className="font-light text-black mt-1">{guestInfo.fullName}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-600 uppercase tracking-wide">Email:</span>
                    <p className="font-light text-black mt-1">{guestInfo.email}</p>
                  </div>
                  {guestInfo.phone && (
                    <div>
                      <span className="text-xs text-gray-600 uppercase tracking-wide">Phone:</span>
                      <p className="font-light text-black mt-1">{guestInfo.phone}</p>
                    </div>
                  )}
                </div>
                
                <div className="space-y-6">
                  <div>
                    <span className="text-xs text-gray-600 uppercase tracking-wide">Guests:</span>
                    <p className="font-light text-black mt-1">
                      {adults} {adults === 1 ? 'Adult' : 'Adults'}
                      {children > 0 && `, ${children} ${children === 1 ? 'Child' : 'Children'}`}
                    </p>
                  </div>
                  
                  {guestInfo.romanticSetup && (
                    <div className="p-4 bg-sage/5 border border-sage/20">
                      <div className="flex items-center text-sage">
                        <span className="text-sm font-light">Romantic setup requested</span>
                      </div>
                    </div>
                  )}
                  
                  {guestInfo.specialRequests && (
                    <div>
                      <span className="text-xs text-gray-600 uppercase tracking-wide">Special Requests:</span>
                      <p className="text-body text-gray-700 mt-2">{guestInfo.specialRequests}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Pricing Summary */}
          <div className="lg:col-span-1">
            <div className="card-editorial p-8 sticky top-8">
              <h3 className="headline-subsection mb-8">Booking Summary</h3>
              
              <div className="space-y-8">
                {/* Cabin Cost */}
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-body text-gray-600">Cabin ({pricing.totalNights} {pricing.totalNights === 1 ? 'night' : 'nights'})</p>
                    <p className="text-sm text-gray-500 font-light">€{cabin.pricePerNight}/night</p>
                  </div>
                  <span className="font-light text-black">€{pricing.cabinCost}</span>
                </div>

                {/* Transport Cost */}
                {transportMethod && (
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-body text-gray-600">Transport ({pricing.totalGuests} {pricing.totalGuests === 1 ? 'guest' : 'guests'})</p>
                      <p className="text-sm text-gray-500 font-light">{transportMethod.type}</p>
                    </div>
                    <span className="font-light text-black">
                      {pricing.transportCost === 0 ? 'Free' : `€${pricing.transportCost}`}
                    </span>
                  </div>
                )}

                {/* Romantic Setup */}
                {guestInfo.romanticSetup && (
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-body text-gray-600">Romantic Setup</p>
                      <p className="text-sm text-gray-500 font-light">Special touches</p>
                    </div>
                    <span className="font-light text-black">€{pricing.romanticSetupCost}</span>
                  </div>
                )}

                {/* Total */}
                <div className="border-t border-gray-200 pt-8">
                  <div className="flex justify-between items-center">
                    <span className="font-serif text-xl font-bold text-black">Total</span>
                    <span className="font-serif text-2xl font-bold text-sage">€{pricing.totalCost}</span>
                  </div>
                  <p className="text-sm text-gray-500 font-light mt-2">Payment due on arrival</p>
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              {/* Confirm Button */}
              <button
                onClick={handleConfirmBooking}
                disabled={submitting}
                className={`w-full mt-8 btn-pill text-lg py-4 ${
                  submitting ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                {submitting ? 'confirming...' : 'confirm my stay →'}
              </button>

              <p className="text-xs text-gray-500 text-center mt-4 font-light">
                By confirming, you agree to our terms and conditions
              </p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex justify-between items-center max-w-2xl mx-auto mt-20">
          <button
            onClick={handleBack}
            className="btn-underline"
          >
            ← back
          </button>
          
          <div className="text-center">
            <p className="text-sm text-gray-500 font-light">
              Step 4 of 4 • Confirmation
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Step4Summary;

