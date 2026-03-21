import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const BookingDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [emailEvents, setEmailEvents] = useState([]);
  const [emailLoading, setEmailLoading] = useState(false);

  const fetchEmailEvents = async (bookingId) => {
    try {
      setEmailLoading(true);
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/email-events?bookingId=${bookingId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setEmailEvents(data.data.events || []);
      }
    } catch (err) {
      console.error('Failed to fetch email events:', err);
    } finally {
      setEmailLoading(false);
    }
  };

  useEffect(() => {
    const fetchBooking = async () => {
      try {
        const token = localStorage.getItem('adminToken');
        const response = await fetch(`/api/admin/bookings/${id}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          setBooking(data.data.booking);
          setError('');
          // Fetch email events for this booking
          fetchEmailEvents(data.data.booking._id);
        } else if (response.status === 401) {
          localStorage.removeItem('adminToken');
          navigate('/admin/login');
        } else if (response.status === 404) {
          setError('Booking not found');
        } else {
          setError('Failed to load booking');
        }
      } catch (err) {
        console.error('Fetch booking error:', err);
        setError('Network error loading booking');
      } finally {
        setLoading(false);
      }
    };

    fetchBooking();
  }, [id, navigate]);

  const handleStatusUpdate = async (newStatus) => {
    setUpdatingStatus(true);
    setSaveMessage('');
    
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/bookings/${id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (response.ok) {
        const data = await response.json();
        setBooking(data.data.booking);
        setSaveMessage('Status updated successfully');
        setTimeout(() => setSaveMessage(''), 3000);
      } else if (response.status === 401) {
        localStorage.removeItem('adminToken');
        navigate('/admin/login');
      } else {
        setError('Failed to update status');
      }
    } catch (err) {
      console.error('Status update error:', err);
      setError('Failed to update status');
    } finally {
      setUpdatingStatus(false);
    }
  };

  if (loading) {
    return (
      <div className="px-4 sm:px-0">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#81887A] mx-auto"></div>
            <p className="mt-2 text-sm text-gray-600">Loading booking...</p>
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

  if (!booking) {
    return (
      <div className="px-4 sm:px-0">
        <div className="rounded-md bg-yellow-50 p-4">
          <div className="text-sm text-yellow-700">Booking not found</div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-0 max-w-3xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <button
              onClick={() => navigate('/admin/bookings')}
              className="text-sm text-gray-500 hover:text-gray-800 mb-2 block"
            >
              ← Back to Bookings
            </button>
            <h1 className="text-xl font-semibold tracking-tight text-gray-900">
              Booking
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              <span className="font-mono text-[12px]">{booking._id}</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saveMessage && (
              <span className="text-xs text-green-700">{saveMessage}</span>
            )}
            <label htmlFor="status" className="text-xs font-medium text-gray-500">
              Status
            </label>
            <select
              id="status"
              value={booking.status}
              onChange={(e) => handleStatusUpdate(e.target.value)}
              disabled={updatingStatus}
              className="px-3 py-2.5 text-sm border border-gray-200 rounded-lg bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A] transition-colors"
            >
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </header>

        <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          <div className="px-6 py-5">
            <h3 className="text-sm font-semibold text-gray-900">
              Booking Information
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              Complete booking details and guest information.
            </p>
          </div>
          <div className="border-t border-gray-100">
            <dl>
              <div className="bg-gray-50/50 px-6 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
                <dt className="text-sm font-medium text-gray-500">Status</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    booking.status === 'confirmed' 
                      ? 'bg-green-100 text-green-800'
                      : booking.status === 'cancelled'
                      ? 'bg-red-100 text-red-800'
                      : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {booking.status}
                  </span>
                </dd>
              </div>
              <div className="bg-white px-6 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
                <dt className="text-sm font-medium text-gray-500">Created</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {new Date(booking.createdAt).toLocaleString()}
                </dd>
              </div>
              <div className="bg-gray-50/50 px-6 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
                <dt className="text-sm font-medium text-gray-500">Check-in</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {new Date(booking.checkIn).toLocaleDateString()}
                </dd>
              </div>
              <div className="bg-white px-6 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
                <dt className="text-sm font-medium text-gray-500">Check-out</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {new Date(booking.checkOut).toLocaleDateString()}
                </dd>
              </div>
              <div className="bg-gray-50/50 px-6 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
                <dt className="text-sm font-medium text-gray-500">Cabin</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {booking.cabinId?.name} • {booking.cabinId?.location}
                </dd>
              </div>
              <div className="bg-white px-6 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
                <dt className="text-sm font-medium text-gray-500">Guests</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {booking.adults} Adults, {booking.children} Children
                </dd>
              </div>
              <div className="bg-gray-50/50 px-6 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
                <dt className="text-sm font-medium text-gray-500">Trip Type</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {booking.craft?.tripType || booking.tripType || 'Not specified'}
                  {booking.craft?.extras?.customTripType && (
                    <span className="text-gray-500"> • {booking.craft.extras.customTripType}</span>
                  )}
                </dd>
              </div>
              <div className="bg-white px-6 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
                <dt className="text-sm font-medium text-gray-500">Transport</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {booking.craft?.transportMethod || booking.transportMethod?.type || 'Not specified'}
                  {booking.transportMethod?.pricePerPerson && (
                    <span className="text-gray-500"> • €{booking.transportMethod.pricePerPerson} per person</span>
                  )}
                </dd>
              </div>
              <div className="bg-gray-50/50 px-6 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
                <dt className="text-sm font-medium text-gray-500">Romantic Setup</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {booking.craft?.extras?.romanticSetup || booking.romanticSetup ? 'Yes' : 'No'}
                </dd>
              </div>
              <div className="bg-white px-6 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
                <dt className="text-sm font-medium text-gray-500">Total Price</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  €{booking.totalPrice}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Guest Information */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          <div className="px-6 py-5">
            <h3 className="text-sm font-semibold text-gray-900">
              Guest Information
            </h3>
          </div>
          <div className="border-t border-gray-100">
            <dl>
              <div className="bg-gray-50/50 px-6 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
                <dt className="text-sm font-medium text-gray-500">Name</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {booking.guestInfo.firstName} {booking.guestInfo.lastName}
                </dd>
              </div>
              <div className="bg-white px-6 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
                <dt className="text-sm font-medium text-gray-500">Email</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {booking.guestInfo.email}
                </dd>
              </div>
              <div className="bg-gray-50/50 px-6 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
                <dt className="text-sm font-medium text-gray-500">Phone</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {booking.guestInfo.phone || 'Not provided'}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Email Activity Panel */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          <div className="px-6 py-5">
            <h3 className="text-sm font-semibold text-gray-900">
              Email Activity
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              Email delivery and engagement events for this booking.
            </p>
          </div>
          <div className="border-t border-gray-100">
            {emailLoading ? (
              <div className="px-6 py-5">
                <div className="text-sm text-gray-500">Loading email events...</div>
              </div>
            ) : emailEvents.length === 0 ? (
              <div className="px-6 py-5">
                <div className="text-sm text-gray-500">No email events found for this booking.</div>
              </div>
            ) : (
              <div className="px-6 py-5">
                <div className="space-y-4">
                  {emailEvents.map((event, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <div className={`w-2 h-2 rounded-full ${
                          event.type === 'Delivered' ? 'bg-green-500' :
                          event.type === 'Opened' ? 'bg-blue-500' :
                          event.type === 'Clicked' ? 'bg-purple-500' :
                          event.type === 'Bounce' ? 'bg-red-500' :
                          event.type === 'SpamComplaint' ? 'bg-red-600' :
                          'bg-gray-400'
                        }`}></div>
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {event.type}
                          </div>
                          <div className="text-xs text-gray-500">
                            {event.subject && `Subject: ${event.subject}`}
                            {event.details?.Description && ` - ${event.details.Description}`}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-gray-500">
                        {new Date(event.createdAt).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
  );
};

export default BookingDetail;
