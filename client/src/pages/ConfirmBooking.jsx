import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { cabinAPI, bookingAPI } from '../services/api';
import ChangeDatesModal from '../components/booking/ChangeDatesModal';
import ChangeGuestsModal from '../components/booking/ChangeGuestsModal';
import PriceDetailsModal from '../components/booking/PriceDetailsModal';

const stripePk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise = stripePk ? loadStripe(stripePk) : null;

const DEFAULT_EXPERIENCES = [
  { key: 'atv_pickup', name: 'ATV pickup', price: 70, unit: 'flat_per_stay' },
  { key: 'horse_riding', name: 'Horse riding', price: 70, unit: 'per_guest' },
  { key: 'jeep_transfer', name: 'Jeep transfer', price: 60, unit: 'flat_per_stay' }
];

function normalizeSrc(u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/')) return u;
  return `/uploads/cabins/${u}`;
}

function formatDate(dateInput) {
  if (!dateInput) return '';
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function PaymentFormInner({ onSubmit, loading }) {
  const stripe = useStripe();
  const elements = useElements();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    await onSubmit(stripe, elements);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      <button
        type="submit"
        disabled={!stripe || loading}
        className="w-full h-12 rounded-xl bg-[#81887A] text-white font-semibold hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Processing...' : 'Confirm and pay'}
      </button>
    </form>
  );
}

const ConfirmBooking = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [cabin, setCabin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState(null);

  // From location.state (passed from CabinDetails) or sessionStorage (on refresh)
  const passedState = location.state || {};
  const getInitialState = () => {
    if (passedState.formData?.firstName || passedState.searchCriteria?.checkIn) {
      return passedState;
    }
    try {
      const stored = sessionStorage.getItem('confirm-booking-simple');
      if (!stored) return passedState;
      const data = JSON.parse(stored);
      const params = new URLSearchParams(window.location.search);
      if (params.get('payment_intent')) return passedState; // Stripe redirect, don't use simple storage
      if (data.cabinId !== id) return passedState;
      return data;
    } catch (e) {
      return passedState;
    }
  };
  const initialState = getInitialState();

  const [formData, setFormData] = useState(() => initialState.formData || {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    specialRequests: ''
  });

  const [checkIn, setCheckIn] = useState(() => {
    const s = initialState.searchCriteria?.checkIn || searchParams.get('checkIn');
    return s ? new Date(s) : null;
  });
  const [checkOut, setCheckOut] = useState(() => {
    const s = initialState.searchCriteria?.checkOut || searchParams.get('checkOut');
    return s ? new Date(s) : null;
  });
  const [adults, setAdults] = useState(() =>
    initialState.searchCriteria?.adults ?? (parseInt(searchParams.get('adults'), 10) || 2)
  );
  const [children, setChildren] = useState(() =>
    initialState.searchCriteria?.children ?? (parseInt(searchParams.get('children'), 10) || 0)
  );
  const [babies, setBabies] = useState(initialState.searchCriteria?.babies ?? 0);
  const [pets, setPets] = useState(initialState.searchCriteria?.pets ?? 0);
  const [selectedExpKeys, setSelectedExpKeys] = useState(() =>
    new Set(initialState.selectedExpKeys || [])
  );
  const [experiences, setExperiences] = useState(() =>
    initialState.experiences || DEFAULT_EXPERIENCES
  );

  const [datesModalOpen, setDatesModalOpen] = useState(false);
  const [guestsModalOpen, setGuestsModalOpen] = useState(false);
  const [priceModalOpen, setPriceModalOpen] = useState(false);
  const [clientSecret, setClientSecret] = useState(null);
  const [stripeError, setStripeError] = useState(null);

  const maxGuests = cabin?.capacity ?? 4;
  const allowPets = cabin?.allowPets ?? false;

  const pricing = useMemo(() => {
    if (!cabin || !checkIn || !checkOut || !cabin.pricePerNight) return null;
    try {
      const totalNights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
      if (totalNights < 1) return null;
      const totalGuests = adults + children;
      let totalPrice = totalNights * cabin.pricePerNight;
      if ((cabin.pricingModel || 'per_night') === 'per_person') {
        totalPrice *= Math.max(totalGuests, 1);
      }
      return { totalNights, totalPrice, pricePerNight: cabin.pricePerNight };
    } catch {
      return null;
    }
  }, [cabin, checkIn, checkOut, adults, children]);

  const experienceTotal = useMemo(() => {
    const guests = adults + children;
    return experiences.reduce((sum, exp) => {
      if (!selectedExpKeys.has(exp.key)) return sum;
      const qty = exp.unit === 'per_guest' ? Math.max(guests, 1) : 1;
      return sum + (exp.price || 0) * qty;
    }, 0);
  }, [experiences, selectedExpKeys, adults, children]);
  const grandTotal = (pricing?.totalPrice ?? 0) + experienceTotal;
  const experienceExtras = useMemo(() => {
    const guests = adults + children;
    return experiences
      .filter((e) => selectedExpKeys.has(e.key))
      .map((e) => ({
        label: e.name,
        amount: (e.unit === 'per_guest' ? Math.max(guests, 1) : 1) * (e.price || 0)
      }));
  }, [experiences, selectedExpKeys, adults, children]);

  const guestSummary = useMemo(() => {
    const parts = [];
    if (adults) parts.push(`${adults} ${adults === 1 ? 'adult' : 'adults'}`);
    if (children) parts.push(`${children} ${children === 1 ? 'child' : 'children'}`);
    if (babies) parts.push(`${babies} ${babies === 1 ? 'infant' : 'infants'}`);
    if (pets) parts.push(`${pets} ${pets === 1 ? 'pet' : 'pets'}`);
    return parts.length ? parts.join(', ') : 'Add guests';
  }, [adults, children, babies, pets]);

  useEffect(() => {
    if (!id) return;
    cabinAPI
      .getById(id)
      .then((res) => {
        if (res.data.success) setCabin(res.data.data.cabin);
      })
      .catch(() => setError('Failed to load cabin'))
      .finally(() => setLoading(false));
  }, [id]);

  // Sync URL when we have dates but URL lacks them (e.g. after restore from sessionStorage)
  useEffect(() => {
    if (!checkIn || !checkOut) return;
    const current = searchParams.get('checkIn');
    const expected = checkIn.toISOString().split('T')[0];
    if (current === expected) return;
    const params = new URLSearchParams(searchParams);
    params.set('checkIn', expected);
    params.set('checkOut', checkOut.toISOString().split('T')[0]);
    params.set('adults', String(adults));
    params.set('children', String(children));
    setSearchParams(params, { replace: true });
  }, [checkIn, checkOut, adults, children, searchParams]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentIntentId = params.get('payment_intent');
    const redirectStatus = params.get('redirect_status');
    if (paymentIntentId && redirectStatus === 'succeeded') {
      const stored = sessionStorage.getItem('confirm-booking-pending');
      if (stored) {
        try {
          const data = JSON.parse(stored);
          sessionStorage.removeItem('confirm-booking-pending');
          setSubmitLoading(true);
          const fd = data.formData || {};
          const bookingData = {
            cabinId: data.cabinId || id,
            checkIn: data.checkIn,
            checkOut: data.checkOut,
            adults: data.adults ?? 2,
            children: data.children ?? 0,
            paymentIntentId,
            experienceKeys: (data.experiences || []).map((e) => e.key).filter(Boolean),
            guestInfo: {
              firstName: fd.firstName || '',
              lastName: fd.lastName || '',
              email: fd.email || '',
              phone: fd.phone || ''
            },
            specialRequests: fd.specialRequests || ''
          };
          bookingAPI.create(bookingData)
            .then((res) => {
              if (res.data.success && res.data.data?.booking?._id) {
                navigate(`/booking-success/${res.data.data.booking._id}`, { replace: true });
              } else {
                setError('Booking completed but could not retrieve confirmation');
              }
            })
            .catch((err) => {
              if (err.response?.status === 409 && err.response?.data?.refundInitiated && err.response?.data?.paymentIntentId) {
                const d = err.response.data;
                const params = new URLSearchParams();
                params.set('payment_intent', d.paymentIntentId);
                if (d.guestEmail) params.set('email', d.guestEmail);
                if (d.checkIn) params.set('checkIn', d.checkIn);
                if (d.checkOut) params.set('checkOut', d.checkOut);
                if (d.adults != null) params.set('adults', String(d.adults));
                if (d.children != null) params.set('children', String(d.children));
                navigate(`/booking-refund?${params.toString()}`, { replace: true });
              } else {
                setError(err.response?.data?.message || err.message || 'Booking failed');
              }
            })
            .finally(() => setSubmitLoading(false));
        } catch (e) {
          setError('Could not complete booking');
        }
      }
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [id, navigate]);

  useEffect(() => {
    if (!stripePromise || !id || !checkIn || !checkOut || grandTotal < 0.5 || clientSecret) return;
    const checkInStr = checkIn instanceof Date ? checkIn.toISOString().split('T')[0] : checkIn;
    const checkOutStr = checkOut instanceof Date ? checkOut.toISOString().split('T')[0] : checkOut;
    bookingAPI
      .createPaymentIntent({
        cabinId: id,
        checkIn: checkInStr,
        checkOut: checkOutStr,
        adults,
        children,
        experienceKeys: Array.from(selectedExpKeys)
      })
      .then((res) => {
        if (res.data.success && res.data.clientSecret) {
          setClientSecret(res.data.clientSecret);
        }
      })
      .catch(() => setStripeError('Payment setup failed'));
  }, [stripePromise, id, checkIn, checkOut, adults, children, selectedExpKeys, grandTotal, clientSecret]);

  const handleDatesSave = useCallback((from, to) => {
    setCheckIn(from);
    setCheckOut(to);
    const params = new URLSearchParams(searchParams);
    params.set('checkIn', from.toISOString().split('T')[0]);
    params.set('checkOut', to.toISOString().split('T')[0]);
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  const handleGuestsSave = useCallback((g) => {
    setAdults(g.adults);
    setChildren(g.children);
    setBabies(g.babies);
    setPets(g.pets);
    const params = new URLSearchParams(searchParams);
    params.set('adults', String(g.adults));
    params.set('children', String(g.children));
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  const createBooking = useCallback(async (paymentIntentId = null) => {
    const bookingData = {
        cabinId: id,
        checkIn: checkIn.toISOString().split('T')[0],
        checkOut: checkOut.toISOString().split('T')[0],
        adults,
        children,
        experienceKeys: Array.from(selectedExpKeys),
        guestInfo: {
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          email: formData.email.trim(),
          phone: formData.phone.trim()
        },
        specialRequests: formData.specialRequests.trim()
      };
    if (paymentIntentId) {
      bookingData.paymentIntentId = paymentIntentId;
    }
    const response = await bookingAPI.create(bookingData);
    if (response.data.success) {
      try {
        sessionStorage.removeItem('confirm-booking-simple');
      } catch (e) { /* ignore */ }
      const bookingId = response.data.data?.booking?._id;
      if (bookingId) {
        navigate(`/booking-success/${bookingId}`, { replace: true });
      } else {
        navigate('/');
      }
    } else {
      throw new Error(response.data.message || 'Booking failed');
    }
  }, [id, checkIn, checkOut, adults, children, formData, selectedExpKeys, experiences, navigate]);

  const handleConfirmAndPay = useCallback(async () => {
    if (!id || !checkIn || !checkOut || !pricing) return;
    setSubmitLoading(true);
    setError(null);
    try {
      await createBooking(null);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Booking failed');
    } finally {
      setSubmitLoading(false);
    }
  }, [id, checkIn, checkOut, pricing, createBooking]);

  const handleStripeSubmit = useCallback(async (stripe, elements) => {
    if (!id || !checkIn || !checkOut || !pricing) return;
    setSubmitLoading(true);
    setError(null);
    setStripeError(null);
    try {
      sessionStorage.setItem('confirm-booking-pending', JSON.stringify({
        cabinId: id,
        checkIn: checkIn.toISOString().split('T')[0],
        checkOut: checkOut.toISOString().split('T')[0],
        adults,
        children,
        formData: { ...formData },
        experiences: Array.from(selectedExpKeys).map((key) => {
          const exp = experiences.find((e) => e.key === key);
          const qty = exp?.unit === 'per_guest' ? adults + children : 1;
          return { key, quantity: qty, priceAtBooking: exp?.price || 0, currency: 'BGN' };
        })
      }));
      const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/cabin/${id}/confirm`,
          payment_method_data: {
            billing_details: {
              name: `${formData.firstName} ${formData.lastName}`,
              email: formData.email,
              phone: formData.phone
            }
          }
        }
      });
      if (stripeError) {
        setStripeError(stripeError.message || 'Payment failed');
        setSubmitLoading(false);
        return;
      }
      if (paymentIntent?.status === 'succeeded') {
        try {
          await createBooking(paymentIntent.id);
        } catch (bookErr) {
          if (bookErr.response?.status === 409 && bookErr.response?.data?.refundInitiated && bookErr.response?.data?.paymentIntentId) {
            const d = bookErr.response.data;
            const params = new URLSearchParams();
            params.set('payment_intent', d.paymentIntentId);
            if (d.guestEmail) params.set('email', d.guestEmail);
            if (d.checkIn) params.set('checkIn', d.checkIn);
            if (d.checkOut) params.set('checkOut', d.checkOut);
            if (d.adults != null) params.set('adults', String(d.adults));
            if (d.children != null) params.set('children', String(d.children));
            navigate(`/booking-refund?${params.toString()}`, { replace: true });
            return;
          }
          throw bookErr;
        }
      }
    } catch (err) {
      if (err.response?.status === 409 && err.response?.data?.refundInitiated && err.response?.data?.paymentIntentId) {
        const d = err.response.data;
        const params = new URLSearchParams();
        params.set('payment_intent', d.paymentIntentId);
        if (d.guestEmail) params.set('email', d.guestEmail);
        if (d.checkIn) params.set('checkIn', d.checkIn);
        if (d.checkOut) params.set('checkOut', d.checkOut);
        if (d.adults != null) params.set('adults', String(d.adults));
        if (d.children != null) params.set('children', String(d.children));
        navigate(`/booking-refund?${params.toString()}`, { replace: true });
        return;
      }
      setError(err.response?.data?.message || err.message || 'Payment failed');
    } finally {
      setSubmitLoading(false);
    }
  }, [id, checkIn, checkOut, pricing, adults, children, formData, selectedExpKeys, experiences, createBooking]);

  if (loading || !cabin) {
    return (
      <div className="min-h-screen bg-[#F7F4EE] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#81887A]" />
      </div>
    );
  }

  const hasGuestInfo = formData.firstName?.trim() && formData.lastName?.trim() && formData.email?.trim() && formData.phone?.trim();
  if (!hasGuestInfo) {
    const params = new URLSearchParams();
    if (checkIn) params.set('checkIn', checkIn instanceof Date ? checkIn.toISOString().split('T')[0] : checkIn);
    if (checkOut) params.set('checkOut', checkOut instanceof Date ? checkOut.toISOString().split('T')[0] : checkOut);
    params.set('adults', String(adults));
    params.set('children', String(children));
    navigate(`/cabin/${id}?${params.toString()}`, { replace: true });
    return null;
  }

  const coverImage = cabin.images?.[0]?.url || cabin.imageUrl;
  const cabinName = cabin.name || 'Cabin';

  return (
    <div className="min-h-screen bg-[#F7F4EE] pb-32 md:pb-0">
      <div className="max-w-2xl mx-auto px-4 py-6 md:py-10">
        {/* Header */}
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-gray-900">Confirm and pay</h1>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-10 h-10 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
            {error}
          </div>
        )}

        {/* Cabin card */}
        <div className="flex gap-4 p-4 bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
          <div className="w-24 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100">
            {coverImage && (
              <img
                src={normalizeSrc(coverImage)}
                alt={cabinName}
                className="w-full h-full object-cover"
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-gray-900 truncate">{cabinName}</p>
            {cabin.averageRating > 0 && (
              <p className="text-sm text-gray-600 flex items-center gap-1 mt-0.5">
                <span className="text-amber-500">★</span> {cabin.averageRating.toFixed(2)}
                {cabin.reviewsCount > 0 && (
                  <span> ({cabin.reviewsCount})</span>
                )}
              </p>
            )}
            {cabin.badges?.guestFavorite?.enabled && (
              <span className="inline-flex items-center gap-1 mt-1 text-xs text-gray-500">
                Guest favorite
              </span>
            )}
          </div>
        </div>

        {/* Dates row */}
        <div className="flex items-center justify-between py-4 border-b border-gray-200">
          <div>
            <p className="text-sm text-gray-600">Dates</p>
            <p className="font-medium text-gray-900">
              {checkIn && checkOut
                ? `${formatDate(checkIn)} – ${formatDate(checkOut)}`
                : 'Select dates'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDatesModalOpen(true)}
            className="text-sm font-medium text-gray-700 underline"
          >
            Change
          </button>
        </div>

        {/* Guests row */}
        <div className="flex items-center justify-between py-4 border-b border-gray-200">
          <div>
            <p className="text-sm text-gray-600">Guests</p>
            <p className="font-medium text-gray-900">{guestSummary}</p>
          </div>
          <button
            type="button"
            onClick={() => setGuestsModalOpen(true)}
            className="text-sm font-medium text-gray-700 underline"
          >
            Change
          </button>
        </div>

        {/* Total row */}
        <div className="flex items-center justify-between py-4 border-b border-gray-200">
          <div>
            <p className="text-sm text-gray-600">Total price</p>
            <p className="font-medium text-gray-900">
              €{grandTotal.toLocaleString()} EUR
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPriceModalOpen(true)}
            className="text-sm font-medium text-gray-700 underline"
          >
            Details
          </button>
        </div>

        {/* Cancellation */}
        <div className="py-4">
          <p className="font-medium text-gray-900">Free cancellation</p>
          <p className="text-sm text-gray-600 mt-0.5">
            Cancel before {checkIn && formatDate(new Date(checkIn.getTime() - 5 * 24 * 60 * 60 * 1000))} for a full refund.
          </p>
          <a href="/cancellation-policy" className="text-sm text-gray-700 underline mt-1 inline-block">
            Full policy
          </a>
        </div>

        {/* Payment - Stripe when configured, else pay on arrival */}
        <div className="mt-6 p-6 bg-white rounded-xl border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Payment</h2>
          {stripePromise && clientSecret ? (
            <>
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <PaymentFormInner onSubmit={handleStripeSubmit} loading={submitLoading} />
              </Elements>
              {stripeError && (
                <p className="mt-2 text-sm text-red-600">{stripeError}</p>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600 mb-4">
                You'll pay when you arrive. We'll contact you within 24 hours to confirm your booking.
              </p>
              <button
                type="button"
                onClick={handleConfirmAndPay}
                disabled={submitLoading || !pricing}
                className="w-full h-12 rounded-xl bg-[#81887A] text-white font-semibold hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitLoading ? 'Submitting...' : `Confirm and pay €${grandTotal.toLocaleString()}`}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Modals */}
      <ChangeDatesModal
        isOpen={datesModalOpen}
        onClose={() => setDatesModalOpen(false)}
        checkIn={checkIn}
        checkOut={checkOut}
        onSave={handleDatesSave}
      />
      <ChangeGuestsModal
        isOpen={guestsModalOpen}
        onClose={() => setGuestsModalOpen(false)}
        adults={adults}
        children={children}
        babies={babies}
        pets={pets}
        maxGuests={maxGuests}
        allowPets={allowPets}
        onSave={handleGuestsSave}
      />
      <PriceDetailsModal
        isOpen={priceModalOpen}
        onClose={() => setPriceModalOpen(false)}
        nights={pricing?.totalNights}
        pricePerNight={pricing?.pricePerNight}
        totalPrice={grandTotal}
        extras={experienceExtras}
      />
    </div>
  );
}

export default ConfirmBooking;
