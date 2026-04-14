import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const TEMPLATE_KEYS = {
  BOOKING_RECEIVED: 'booking_received',
  BOOKING_CONFIRMED: 'booking_confirmed',
  BOOKING_CANCELLED: 'booking_cancelled'
};

const TEMPLATE_LABELS = {
  [TEMPLATE_KEYS.BOOKING_RECEIVED]: 'Booking received email',
  [TEMPLATE_KEYS.BOOKING_CONFIRMED]: 'Booking confirmation email',
  [TEMPLATE_KEYS.BOOKING_CANCELLED]: 'Booking cancellation email',
  booking_received_internal: 'Internal new-booking notification'
};

function resolveEffectiveRecipient(overrideInput, guestEmail) {
  const trimmed = (overrideInput || '').trim();
  if (trimmed) return trimmed;
  return (guestEmail || '').trim() || '';
}

function formatLifecycleSource(src) {
  if (src === 'manual_resend') return 'Manual resend';
  if (src === 'automatic') return 'Automatic';
  return src || '—';
}

function emailActivityDotClass(event) {
  if (event.type === 'LifecycleEmail') {
    if (event.sendStatus === 'success') return 'bg-emerald-500';
    if (event.sendStatus === 'failed') return 'bg-red-500';
    if (event.sendStatus === 'skipped') return 'bg-amber-500';
    return 'bg-gray-400';
  }
  if (event.type === 'Delivered') return 'bg-green-500';
  if (event.type === 'Opened') return 'bg-blue-500';
  if (event.type === 'Clicked') return 'bg-purple-500';
  if (event.type === 'Bounce') return 'bg-red-500';
  if (event.type === 'SpamComplaint') return 'bg-red-600';
  if (event.type === 'ArrivalSent' || event.type === 'ArrivalResent') return 'bg-teal-500';
  return 'bg-gray-400';
}

function emailActivityTitle(event) {
  if (event.type === 'LifecycleEmail' && event.templateKey) {
    return TEMPLATE_LABELS[event.templateKey] || event.templateKey;
  }
  if (event.type === 'ArrivalSent') return 'Arrival instructions sent';
  if (event.type === 'ArrivalResent') return 'Arrival instructions resent';
  return event.type || 'Email event';
}

function isInternalLifecycleEmail(event) {
  return event?.type === 'LifecycleEmail' && event?.templateKey === 'booking_received_internal';
}

function EmailActivityEventCard({ event }) {
  return (
    <div className="p-3 bg-gray-50 rounded-lg border border-gray-100/80">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`mt-1.5 w-2 h-2 shrink-0 rounded-full ${emailActivityDotClass(event)}`} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900">{emailActivityTitle(event)}</div>
            {event.type === 'LifecycleEmail' ? (
              <div className="mt-1 space-y-0.5 text-xs text-gray-600">
                <div>
                  <span className="text-gray-500">When:</span>{' '}
                  {event.createdAt ? new Date(event.createdAt).toLocaleString() : '—'}
                </div>
                <div>
                  <span className="text-gray-500">Result:</span>{' '}
                  <span className="font-medium text-gray-800">{event.sendStatus || '—'}</span>
                  {event.deliveryMethod ? (
                    <span className="text-gray-500"> ({event.deliveryMethod})</span>
                  ) : null}
                </div>
                <div>
                  <span className="text-gray-500">Source:</span> {formatLifecycleSource(event.lifecycleSource)}
                </div>
                <div>
                  <span className="text-gray-500">To:</span> {event.to || '—'}
                </div>
                {event.overrideRecipientUsed ? (
                  <div>
                    <span className="text-gray-500">Override:</span> yes (guest on file:{' '}
                    {event.guestEmailAtSend || '—'})
                  </div>
                ) : null}
                {event.lifecycleSource === 'manual_resend' && (event.actorId || event.actorRole) ? (
                  <div>
                    <span className="text-gray-500">Actor:</span>{' '}
                    {[event.actorRole, event.actorId].filter(Boolean).join(' · ')}
                  </div>
                ) : null}
                {event.subject ? (
                  <div className="truncate" title={event.subject}>
                    <span className="text-gray-500">Subject:</span> {event.subject}
                  </div>
                ) : null}
                {event.errorMessage ? (
                  <div className="text-red-700">
                    <span className="text-gray-500">Error:</span> {event.errorMessage}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-1 text-xs text-gray-500 space-y-0.5">
                <div>
                  {event.subject && <span>Subject: {event.subject}</span>}
                  {event.details?.Description && (
                    <span>
                      {event.subject ? ' — ' : ''}
                      {event.details.Description}
                    </span>
                  )}
                </div>
                {event.to && (
                  <div>
                    <span className="text-gray-500">To:</span> {event.to}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {event.type !== 'LifecycleEmail' && (
          <div className="text-xs text-gray-500 shrink-0 sm:pt-0.5">
            {event.createdAt ? new Date(event.createdAt).toLocaleString() : ''}
          </div>
        )}
      </div>
    </div>
  );
}

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
  const [overrideRecipient, setOverrideRecipient] = useState('');
  const [resendLoadingKey, setResendLoadingKey] = useState(null);
  const [emailActionsMessage, setEmailActionsMessage] = useState({ tone: '', text: '' });

  const fetchEmailEvents = useCallback(async (bookingId) => {
    try {
      setEmailLoading(true);
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/email-events?bookingId=${bookingId}`, {
        headers: {
          Authorization: `Bearer ${token}`
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
  }, []);

  useEffect(() => {
    const fetchBooking = async () => {
      try {
        const token = localStorage.getItem('adminToken');
        const response = await fetch(`/api/admin/bookings/${id}`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          setBooking(data.data.booking);
          setError('');
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
  }, [id, navigate, fetchEmailEvents]);

  const handleStatusUpdate = async (newStatus) => {
    setUpdatingStatus(true);
    setSaveMessage('');

    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/bookings/${id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (response.ok) {
        const data = await response.json();
        setBooking(data.data.booking);
        setSaveMessage('Status updated successfully');
        setTimeout(() => setSaveMessage(''), 3000);
        fetchEmailEvents(data.data.booking._id);
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

  const handleResendTemplate = async (templateKey) => {
    if (!booking) return;
    const guestEmail = booking.guestInfo?.email || '';
    const effective = resolveEffectiveRecipient(overrideRecipient, guestEmail);
    if (!effective) {
      setEmailActionsMessage({
        tone: 'error',
        text: 'No recipient: enter an override email or ensure this booking has a guest email on file.'
      });
      return;
    }

    const label = TEMPLATE_LABELS[templateKey] || templateKey;
    const usingOverride = Boolean((overrideRecipient || '').trim());
    const ok = window.confirm(
      `Send "${label}" now?\n\nTo: ${effective}${usingOverride ? '\n(using override address)' : '\n(guest email on file)'}`
    );
    if (!ok) return;

    setResendLoadingKey(templateKey);
    setEmailActionsMessage({ tone: '', text: '' });

    try {
      const token = localStorage.getItem('adminToken');
      const body = { templateKey };
      const trimmedOverride = (overrideRecipient || '').trim();
      if (trimmedOverride) {
        body.overrideRecipient = trimmedOverride;
      }

      const response = await fetch(`/api/admin/bookings/${id}/email-actions/resend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      const payload = await response.json().catch(() => ({}));

      if (response.status === 401) {
        localStorage.removeItem('adminToken');
        navigate('/admin/login');
        return;
      }

      if (!response.ok) {
        setEmailActionsMessage({
          tone: 'error',
          text: payload.message || 'Request failed'
        });
        return;
      }

      if (payload.success) {
        setEmailActionsMessage({
          tone: 'success',
          text: `Sent. Status: ${payload.data?.sendStatus || 'success'}. Recipient: ${payload.data?.recipient || effective}.`
        });
      } else {
        setEmailActionsMessage({
          tone: 'error',
          text: `Send completed with provider issue. Status: ${payload.data?.sendStatus || 'unknown'}. ${
            payload.data?.emailEvent?.errorMessage || ''
          }`.trim()
        });
      }

      fetchEmailEvents(booking._id);
    } catch (err) {
      console.error('Resend email error:', err);
      setEmailActionsMessage({ tone: 'error', text: 'Network error while sending' });
    } finally {
      setResendLoadingKey(null);
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

  const guestEmail = booking.guestInfo?.email || '';
  const previewRecipient = resolveEffectiveRecipient(overrideRecipient, guestEmail) || '—';
  const mainActivityEvents = emailEvents.filter((e) => !isInternalLifecycleEmail(e));
  const internalLifecycleEvents = emailEvents.filter(isInternalLifecycleEmail);

  return (
    <div className="px-4 sm:px-0 max-w-3xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => navigate('/admin/bookings')}
            className="text-sm text-gray-500 hover:text-gray-800 mb-2 block"
          >
            ← Back to Bookings
          </button>
          <h1 className="text-xl font-semibold tracking-tight text-gray-900">Booking</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            <span className="font-mono text-[12px]">{booking._id}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saveMessage && <span className="text-xs text-green-700">{saveMessage}</span>}
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
          <h3 className="text-sm font-semibold text-gray-900">Booking Information</h3>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Complete booking details and guest information.
          </p>
        </div>
        <div className="border-t border-gray-100">
          <dl>
            <div className="bg-gray-50/50 px-6 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
              <dt className="text-sm font-medium text-gray-500">Status</dt>
              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                <span
                  className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    booking.status === 'confirmed'
                      ? 'bg-green-100 text-green-800'
                      : booking.status === 'cancelled'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-yellow-100 text-yellow-800'
                  }`}
                >
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
            {booking.subtotalPrice != null && (
              <div className="bg-white px-6 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
                <dt className="text-sm font-medium text-gray-500">Subtotal</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">€{booking.subtotalPrice}</dd>
              </div>
            )}
            {(booking.discountAmount ?? 0) > 0 && (
              <div className="bg-gray-50/50 px-6 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
                <dt className="text-sm font-medium text-gray-500">Promo discount</dt>
                <dd className="mt-1 text-sm text-emerald-900 sm:mt-0 sm:col-span-2">
                  −€{booking.discountAmount}
                  {booking.promoCode ? ` (${booking.promoCode})` : ''}
                </dd>
              </div>
            )}
            {booking.promoSnapshot?.internalName && (
              <div className="bg-white px-6 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
                <dt className="text-sm font-medium text-gray-500">Promo (internal)</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {booking.promoSnapshot.internalName}
                </dd>
              </div>
            )}
            <div className="bg-white px-6 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
              <dt className="text-sm font-medium text-gray-500">Total Price</dt>
              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">€{booking.totalPrice}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
        <div className="px-6 py-5">
          <h3 className="text-sm font-semibold text-gray-900">Guest Information</h3>
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
              <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{booking.guestInfo.email}</dd>
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

      <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
        <div className="px-6 py-5">
          <h3 className="text-sm font-semibold text-gray-900">Booking Email Actions</h3>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Resend standard booking emails using current booking data. This does not change booking status, guest
            contact on the booking, or payments. Leave override blank to use the guest email on file (
            <span className="font-medium text-gray-700">{guestEmail || 'none'}</span>
            ). Next send will go to:{' '}
            <span className="font-medium text-gray-900">{previewRecipient}</span>.
          </p>
        </div>
        <div className="border-t border-gray-100 px-6 py-5 space-y-4">
          <div>
            <label htmlFor="overrideRecipient" className="block text-xs font-medium text-gray-500 mb-1.5">
              Optional override recipient
            </label>
            <input
              id="overrideRecipient"
              type="email"
              autoComplete="off"
              placeholder="Leave blank for guest email"
              value={overrideRecipient}
              onChange={(e) => setOverrideRecipient(e.target.value)}
              className="w-full max-w-md px-3 py-2.5 text-sm border border-gray-200 rounded-lg bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#81887A]/20 focus:border-[#81887A]"
            />
          </div>
          {emailActionsMessage.text && (
            <div
              className={`rounded-md px-3 py-2 text-sm ${
                emailActionsMessage.tone === 'success'
                  ? 'bg-emerald-50 text-emerald-900'
                  : 'bg-red-50 text-red-800'
              }`}
            >
              {emailActionsMessage.text}
            </div>
          )}
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
            <button
              type="button"
              disabled={!!resendLoadingKey}
              onClick={() => handleResendTemplate(TEMPLATE_KEYS.BOOKING_RECEIVED)}
              className="inline-flex justify-center items-center px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resendLoadingKey === TEMPLATE_KEYS.BOOKING_RECEIVED ? 'Sending…' : 'Resend booking email'}
            </button>
            <button
              type="button"
              disabled={!!resendLoadingKey}
              onClick={() => handleResendTemplate(TEMPLATE_KEYS.BOOKING_CONFIRMED)}
              className="inline-flex justify-center items-center px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resendLoadingKey === TEMPLATE_KEYS.BOOKING_CONFIRMED ? 'Sending…' : 'Resend confirmation email'}
            </button>
            <button
              type="button"
              disabled={!!resendLoadingKey}
              onClick={() => handleResendTemplate(TEMPLATE_KEYS.BOOKING_CANCELLED)}
              className="inline-flex justify-center items-center px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resendLoadingKey === TEMPLATE_KEYS.BOOKING_CANCELLED ? 'Sending…' : 'Resend cancellation email'}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
        <div className="px-6 py-5">
          <h3 className="text-sm font-semibold text-gray-900">Email Activity</h3>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Guest-facing booking emails, arrival instructions, and provider delivery events for this booking.
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
            <div className="px-6 py-5 space-y-6">
              <div>
                {mainActivityEvents.length === 0 ? (
                  <div className="text-sm text-gray-500">
                    No guest-facing lifecycle emails or delivery events for this booking.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {mainActivityEvents.map((event) => (
                      <EmailActivityEventCard
                        key={event._id || `${event.createdAt}-${event.type}-${event.templateKey || ''}`}
                        event={event}
                      />
                    ))}
                  </div>
                )}
              </div>
              {internalLifecycleEvents.length > 0 ? (
                <div className="pt-4 border-t border-gray-100">
                  <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">
                    Internal notifications
                  </h4>
                  <p className="text-xs text-gray-500 mb-3 max-w-2xl">
                    Staff inbox alerts for this booking (not sent to the guest).
                  </p>
                  <div className="space-y-3">
                    {internalLifecycleEvents.map((event) => (
                      <EmailActivityEventCard
                        key={event._id || `${event.createdAt}-${event.type}-${event.templateKey || ''}`}
                        event={event}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookingDetail;
