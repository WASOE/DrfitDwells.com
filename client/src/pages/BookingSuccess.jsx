import { useState, useEffect } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { bookingAPI } from '../services/api';
import Seo from '../components/Seo';
import { localizePath } from '../utils/localizedRoutes';
import { getGuideCtaLabel } from './guides/guideUtils';
import { daysBetweenDateOnly, parseDateOnlyLocal } from '../utils/dateOnly';

const BookingSuccess = () => {
  const { id } = useParams();
  const location = useLocation();
  const routeLanguage = location.pathname.startsWith('/bg') ? 'bg' : 'en';
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showPackingModal, setShowPackingModal] = useState(false);

  // Fetch booking data
  useEffect(() => {
    const fetchBooking = async () => {
      try {
        setLoading(true);
        const response = await bookingAPI.getById(id);
        
        if (response.data.success) {
          setBooking(response.data.data.booking);
        } else {
          setError('Booking not found');
        }
      } catch (err) {
        console.error('Fetch booking error:', err);
        setError('Error loading booking details');
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchBooking();
    } else {
      setError('Invalid booking ID');
      setLoading(false);
    }
  }, [id]);

  // Generate booking reference number
  const generateBookingRef = (bookingId, checkInDate) => {
    const date = parseDateOnlyLocal(checkInDate);
    if (!date) return `DW-UNKNOWN-${bookingId.slice(-3)}`;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const shortId = bookingId.slice(-3);
    return `DW-${year}${month}${day}-${shortId}`;
  };

  // Format trip type display
  const getTripTypeDisplay = (tripType) => {
    if (!tripType) return 'Custom Experience';
    
    const tripTypeMap = {
      'Romantic Getaway': 'Romantic Getaway',
      'Family Retreat': 'Family Retreat',
      'Solo Reset': 'Solo Reset',
      'Digital Detox': 'Digital Detox',
      'Creative Escape': 'Creative Escape',
      'Nature Exploration': 'Nature Exploration',
      'Adventure Weekend': 'Adventure Weekend'
    };
    
    return tripTypeMap[tripType] || tripType;
  };

  // Calculate total nights
  const getTotalNights = (checkIn, checkOut) => {
    return daysBetweenDateOnly(checkIn, checkOut);
  };

  // Generate ICS file for calendar
  const generateICS = () => {
    if (!booking || !booking.cabinId) return;
    
    const cabin = booking.cabinId;
    const checkIn = new Date(booking.checkIn);
    const checkOut = new Date(booking.checkOut);
    
    // Set default times
    checkIn.setHours(12, 0, 0, 0); // 12:00 PM check-in
    checkOut.setHours(11, 0, 0, 0); // 11:00 AM check-out
    
    const formatDate = (date) => {
      return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };
    
    let location = cabin.meetingPoint?.label || cabin.location;
    if (cabin.meetingPoint?.lat && cabin.meetingPoint?.lng) {
      location += ` (GPS: ${cabin.meetingPoint.lat}, ${cabin.meetingPoint.lng})`;
    }
    
    let description = `Drift & Dwells - ${cabin.name}\n\n`;
    if (cabin.meetingPoint?.googleMapsUrl) {
      description += `Directions: ${cabin.meetingPoint.googleMapsUrl}\n`;
    }
    if (cabin.meetingPoint?.what3words) {
      description += `What3Words: ///${cabin.meetingPoint.what3words}\n`;
    }
    if (cabin.emergencyContact) {
      description += `Emergency: ${cabin.emergencyContact}\n`;
    }
    
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Drift & Dwells//Booking Calendar//EN
BEGIN:VEVENT
UID:${booking._id}@driftdwells.com
DTSTAMP:${formatDate(new Date())}
DTSTART:${formatDate(checkIn)}
DTEND:${formatDate(checkOut)}
SUMMARY:Drift & Dwells — ${cabin.name}
DESCRIPTION:${description.replace(/\n/g, '\\n')}
LOCATION:${location}
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `drift-dwells-${cabin.name.toLowerCase().replace(/\s+/g, '-')}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <>
        <Seo
          title="Booking confirmation | Drift & Dwells"
          description="Your Drift & Dwells booking confirmation and arrival details."
          canonicalPath={`/booking-success/${id}`}
          noindex
        />
        <div className="min-h-screen bg-gradient-to-br from-drift-green/5 to-drift-light-green/5">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-drift-green"></div>
              <p className="mt-4 text-gray-600">Loading your booking confirmation...</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (error || !booking) {
    return (
      <>
        <Seo
          title="Booking confirmation unavailable | Drift & Dwells"
          description="This booking confirmation could not be loaded."
          canonicalPath={`/booking-success/${id}`}
          noindex
        />
        <div className="min-h-screen bg-gradient-to-br from-drift-green/5 to-drift-light-green/5">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <div className="text-center">
              <div className="text-red-500 text-6xl mb-4">⚠️</div>
              <h1 className="text-3xl font-bold text-gray-900 mb-4">Booking Not Found</h1>
              <p className="text-gray-600 mb-8">{error || 'The booking you\'re looking for could not be found.'}</p>
              <Link
                to="/"
                className="btn-primary px-8 py-3"
              >
                Back to Home
              </Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  const bookingRef = generateBookingRef(booking._id, booking.checkIn);
  const totalNights = getTotalNights(booking.checkIn, booking.checkOut);

  return (
    <>
      <Seo
        title={`Booking confirmed for ${booking.cabinId?.name || 'your stay'} | Drift & Dwells`}
        description="Your Drift & Dwells booking is confirmed. Review your itinerary, pre-arrival guidance, and trip details."
        canonicalPath={`/booking-success/${id}`}
        noindex
      />
      <div className="min-h-screen bg-drift-bg">
      {/* Inspirational Header */}
      <div className="bg-gradient-to-r from-drift-primary to-drift-light-green text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="text-center">
            <div className="w-28 h-28 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-8">
              <svg className="w-16 h-16 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            
            <h1 className="text-6xl font-bold mb-6 tracking-widest uppercase">
              Your retreat is booked!
            </h1>
            
            <p className="text-xl text-green-100 mb-8 max-w-3xl mx-auto leading-relaxed">
              Thank you for choosing Drift & Dwells. We're preparing your off-grid experience.
            </p>
            
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 inline-block">
              <p className="text-lg font-semibold tracking-wide">Booking Reference: {bookingRef}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Booking Summary */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-lg p-8 border border-gray-100 mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-6">Booking Summary</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Cabin & Dates */}
                <div className="space-y-4">
                  <div>
                    <span className="text-sm text-gray-500 block">Cabin</span>
                    <h3 className="text-xl font-semibold text-gray-900">{booking.cabinId.name}</h3>
                    <p className="text-gray-600">📍 {booking.cabinId.location}</p>
                  </div>
                  
                  <div>
                    <span className="text-sm text-gray-500 block">Check-in</span>
                    <p className="font-medium">
                      {parseDateOnlyLocal(booking.checkIn)?.toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      })}
                    </p>
                  </div>
                  
                  <div>
                    <span className="text-sm text-gray-500 block">Check-out</span>
                    <p className="font-medium">
                      {parseDateOnlyLocal(booking.checkOut)?.toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      })}
                    </p>
                  </div>
                  
                  <div>
                    <span className="text-sm text-gray-500 block">Duration</span>
                    <p className="font-medium">{totalNights} {totalNights === 1 ? 'night' : 'nights'}</p>
                  </div>
                </div>

                {/* Experience & Guest Info */}
                <div className="space-y-4">
                  <div>
                    <span className="text-sm text-gray-500 block">Trip Type</span>
                    <p className="font-medium">{getTripTypeDisplay(booking.tripType)}</p>
                  </div>
                  
                  {booking.transportMethod && booking.transportMethod !== 'Not selected' && (
                    <div>
                      <span className="text-sm text-gray-500 block">Arrival Method</span>
                      <p className="font-medium">{booking.transportMethod}</p>
                    </div>
                  )}
                  
                  <div>
                    <span className="text-sm text-gray-500 block">Guest</span>
                    <p className="font-medium">{booking.guestInfo.firstName} {booking.guestInfo.lastName}</p>
                    <p className="text-sm text-gray-600">{booking.guestInfo.email}</p>
                  </div>
                  
                  <div>
                    <span className="text-sm text-gray-500 block">Guests</span>
                    <p className="font-medium">
                      {booking.adults} {booking.adults === 1 ? 'Adult' : 'Adults'}
                      {booking.children > 0 && `, ${booking.children} ${booking.children === 1 ? 'Child' : 'Children'}`}
                    </p>
                  </div>
                  
                  {booking.romanticSetup && (
                    <div className="bg-pink-50 border border-pink-200 rounded-lg p-3">
                      <div className="flex items-center text-pink-700">
                        <span className="text-lg mr-2">💕</span>
                        <span className="text-sm font-medium">Romantic setup included</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Special Requests */}
              {booking.specialRequests && (
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <span className="text-sm text-gray-500 block">Special Requests</span>
                  <p className="text-gray-700 mt-1">{booking.specialRequests}</p>
                </div>
              )}
            </div>

            {/* Pre-Arrival Guidance */}
            <div className="bg-white rounded-xl shadow-lg p-8 border border-gray-100">
              <h2 className="text-2xl font-semibold text-gray-900 mb-6">Pre-Arrival Guidance</h2>
              
              {/* Directions */}
              {booking.cabinId.meetingPoint?.googleMapsUrl && (
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 mb-3">📍 Directions</h3>
                  <div className="flex flex-wrap gap-3">
                    <a
                      href={booking.cabinId.meetingPoint.googleMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg transition-colors duration-200"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      Open in Google Maps
                    </a>
                    
                    {booking.cabinId.meetingPoint.lat && booking.cabinId.meetingPoint.lng && (
                      <div className="inline-flex items-center px-4 py-2 bg-gray-100 rounded-lg">
                        <span className="text-sm text-gray-600">
                          GPS: {booking.cabinId.meetingPoint.lat}, {booking.cabinId.meetingPoint.lng}
                        </span>
                      </div>
                    )}
                    
                    {booking.cabinId.meetingPoint.what3words && (
                      <a
                        href={`https://what3words.com/${booking.cabinId.meetingPoint.what3words}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center px-4 py-2 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg transition-colors duration-200"
                      >
                        <span className="text-sm">///{booking.cabinId.meetingPoint.what3words}</span>
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Valley Guide Link */}
              {(booking.cabinId?.location || booking.cabinTypeId?.location) && 
               ['The Valley', 'Valley'].some(loc => 
                 (booking.cabinId?.location || booking.cabinTypeId?.location || '').toLowerCase().includes(loc.toLowerCase())
               ) && (
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 mb-3">🗺️ Interactive Welcome Guide</h3>
                  <Link
                    to={`/my-trip/${booking._id}/valley-guide`}
                    className="inline-flex items-center px-4 py-2 bg-drift-green hover:bg-drift-light-green text-white rounded-lg transition-colors duration-200"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Open Valley Welcome Guide
                  </Link>
                  <p className="text-sm text-gray-600 mt-2">Complete your trip checklist and prepare for arrival</p>
                </div>
              )}

              {/* Offline Guide */}
              {booking.cabinId?.arrivalGuideUrl && (
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 mb-3">📄 Arrival Guide</h3>
                  <a
                    href={booking.cabinId.arrivalGuideUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-4 py-2 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg transition-colors duration-200"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {getGuideCtaLabel(booking.cabinId.arrivalGuideUrl)}
                  </a>
                </div>
              )}

              {/* Packing & Safety */}
              <div className="mb-6">
                <h3 className="font-semibold text-gray-900 mb-3">🎒 Packing & Safety</h3>
                <div className="flex flex-wrap gap-3">
                  {booking.cabinId.packingList && booking.cabinId.packingList.length > 0 && (
                    <button
                      onClick={() => setShowPackingModal(true)}
                      className="inline-flex items-center px-4 py-2 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-lg transition-colors duration-200"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                      View Packing List
                    </button>
                  )}
                  
                  {booking.cabinId.safetyNotes && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 w-full">
                      <div className="flex items-start">
                        <span className="text-yellow-600 mr-2">⚠️</span>
                        <div>
                          <h4 className="text-sm font-medium text-yellow-800">Safety & House Rules</h4>
                          <p className="text-sm text-yellow-700 mt-1">{booking.cabinId.safetyNotes}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Arrival Window & Contact */}
              <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                {booking.cabinId.arrivalWindowDefault && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="flex items-center">
                      <span className="text-blue-600 mr-2">🕐</span>
                      <div>
                        <h4 className="text-sm font-medium text-blue-800">Arrival Window</h4>
                        <p className="text-sm text-blue-700">{booking.cabinId.arrivalWindowDefault}</p>
                      </div>
                    </div>
                  </div>
                )}
                
                {booking.cabinId.emergencyContact && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <div className="flex items-center">
                      <span className="text-red-600 mr-2">🚨</span>
                      <div>
                        <h4 className="text-sm font-medium text-red-800">Emergency Contact</h4>
                        <p className="text-sm text-red-700">{booking.cabinId.emergencyContact}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button 
                  onClick={generateICS}
                  className="flex items-center justify-center px-4 py-3 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors duration-200"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Add to Calendar
                </button>
                
                <a 
                  href="https://wa.me/359881234567" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center justify-center px-4 py-3 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg transition-colors duration-200"
                >
                  <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.885 3.488"/>
                  </svg>
                  WhatsApp Group
                </a>
              </div>
            </div>
          </div>

          {/* Inspiration & Total */}
          <div className="lg:col-span-1">
            {/* Total Cost */}
            <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100 mb-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Total Cost</h3>
              <div className="text-center">
                <div className="text-3xl font-bold text-drift-green mb-2">€{booking.totalPrice}</div>
                <p className="text-sm text-gray-500">Payment due on arrival</p>
              </div>
            </div>

            {/* Inspiration Section */}
            <div className="bg-gradient-to-br from-drift-green to-drift-light-green text-white rounded-xl p-8">
              <div className="text-center">
                <div className="text-4xl mb-4">🌲</div>
                <blockquote className="text-lg italic mb-6">
                  "Sometimes the best way forward is to go offline for a while..."
                </blockquote>
                <p className="text-green-100 text-sm">
                  Your digital detox journey begins soon. We can't wait to welcome you to nature.
                </p>
              </div>
            </div>

            {/* Contact Info */}
            <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100 mt-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Need Help?</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-center">
                  <svg className="w-4 h-4 mr-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span>info@driftdwells.com</span>
                </div>
                <div className="flex items-center">
                  <svg className="w-4 h-4 mr-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  <span>+359 88 123 4567</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="text-center mt-12">
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to={localizePath('/', routeLanguage)}
              className="btn-primary px-8 py-3"
            >
              Back to Home
            </Link>
            <Link
              to={localizePath('/search', routeLanguage)}
              className="btn-secondary px-8 py-3"
            >
              Explore More Cabins
            </Link>
          </div>
          
          <p className="text-sm text-gray-500 mt-6">
            We're excited to welcome you to our eco-retreat! 
            <br />
            Follow us on social media for updates and special offers.
          </p>
        </div>
      </div>

      {/* Packing List Modal */}
      {showPackingModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full max-h-96 overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Packing List</h3>
              <button
                onClick={() => setShowPackingModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-64">
              <ul className="space-y-2">
                {booking.cabinId.packingList.map((item, index) => (
                  <li key={index} className="flex items-center">
                    <span className="text-green-500 mr-2">✓</span>
                    <span className="text-gray-700">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
};

export default BookingSuccess;