import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { cabinAPI, cabinTypeAPI, bookingAPI } from '../services/api';
import { CONFIRM_BOOKING_SIMPLE_KEY } from '../hooks/useBookingNavigation';
import ChangeDatesModal from '../components/booking/ChangeDatesModal';
import ChangeGuestsModal from '../components/booking/ChangeGuestsModal';
import PriceDetailsModal from '../components/booking/PriceDetailsModal';
import Seo from '../components/Seo';
import { daysBetweenDateOnly, formatDateOnlyLocal, parseDateOnlyLocal } from '../utils/dateOnly';
import { getAttributionPayload } from '../tracking/attribution';
import { readGuestPromo, writeGuestPromo } from '../utils/guestPromo';

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
  const d = parseDateOnlyLocal(dateInput);
  if (!d || isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function PaymentFormInner({ onSubmit, loading, disabled = false }) {
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
        disabled={!stripe || loading || disabled}
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
      const stored = sessionStorage.getItem(CONFIRM_BOOKING_SIMPLE_KEY);
      const pending = sessionStorage.getItem('confirm-booking-pending');
      const params = new URLSearchParams(window.location.search);
      if (params.get('payment_intent')) {
        if (!pending) return passedState;
        return JSON.parse(pending);
      }
      if (!stored) return passedState;
      const data = JSON.parse(stored);
      if (data.confirmPath && data.confirmPath !== window.location.pathname) return passedState;
      if (!data.confirmPath && id && data.cabinId !== id) return passedState;
      return data;
    } catch (e) {
      return passedState;
    }
  };
  const initialState = getInitialState();

  const promoSeed = (() => {
    try {
      const u = new URLSearchParams(window.location.search).get('promoCode');
      if (u?.trim()) return u.trim().toUpperCase();
    } catch {
      /* ignore */
    }
    const s = initialState.promoCode;
    if (s && String(s).trim()) return String(s).trim().toUpperCase();
    const g = readGuestPromo();
    return g?.trim().toUpperCase() || null;
  })();

  const bookingEntityType = initialState.bookingEntityType || 'cabin';
  const bookingEntityId = initialState.bookingEntityId || initialState.cabinId || id || null;
  const bookingEntitySlug = initialState.bookingEntitySlug || null;
  const confirmPath = initialState.confirmPath || window.location.pathname;

  const [formData, setFormData] = useState(() => initialState.formData || {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    specialRequests: ''
  });

  const [checkIn, setCheckIn] = useState(() => {
    const s = initialState.searchCriteria?.checkIn || searchParams.get('checkIn');
    return parseDateOnlyLocal(s);
  });
  const [checkOut, setCheckOut] = useState(() => {
    const s = initialState.searchCriteria?.checkOut || searchParams.get('checkOut');
    return parseDateOnlyLocal(s);
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
  const [stripeEnabled, setStripeEnabled] = useState(false);

  const [serverQuote, setServerQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const [lockedPromoCode, setLockedPromoCode] = useState(promoSeed);
  const [promoDraft, setPromoDraft] = useState(promoSeed || '');
  const [promoMessage, setPromoMessage] = useState(null);

  const handleFormChange = useCallback((field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const maxGuests = cabin?.capacity ?? 4;
  const allowPets = cabin?.allowPets ?? false;

  const pricing = useMemo(() => {
    if (!cabin || !checkIn || !checkOut || !cabin.pricePerNight) return null;
    try {
      const totalNights = daysBetweenDateOnly(checkIn, checkOut);
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
  const experienceKeysSorted = useMemo(
    () => Array.from(selectedExpKeys).sort(),
    [selectedExpKeys]
  );

  const displayTotal = serverQuote?.totalPrice ?? grandTotal;
  const displaySubtotal = serverQuote?.subtotalPrice;
  const displayDiscount = serverQuote?.discountAmount ?? 0;

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
    setClientSecret(null);
  }, [checkIn, checkOut, adults, children, experienceKeysSorted, bookingEntityId, bookingEntityType]);

  const quoteFingerprint = useMemo(() => {
    if (!serverQuote) return '';
    return [
      serverQuote.subtotalPrice,
      serverQuote.discountAmount,
      serverQuote.totalPrice,
      lockedPromoCode || '',
      checkIn ? formatDateOnlyLocal(checkIn) : '',
      checkOut ? formatDateOnlyLocal(checkOut) : '',
      adults,
      children,
      experienceKeysSorted.join(',')
    ].join('|');
  }, [serverQuote, lockedPromoCode, checkIn, checkOut, adults, children, experienceKeysSorted]);

  const quoteTotalFromFingerprint = useMemo(() => {
    if (!quoteFingerprint) return null;
    const t = Number(quoteFingerprint.split('|')[2]);
    return Number.isFinite(t) ? t : null;
  }, [quoteFingerprint]);

  useEffect(() => {
    if (!bookingEntityId || !checkIn || !checkOut || !cabin) return;
    let cancelled = false;
    (async () => {
      setQuoteLoading(true);
      setQuoteError(null);
      try {
        const payload = {
          checkIn: formatDateOnlyLocal(checkIn),
          checkOut: formatDateOnlyLocal(checkOut),
          adults,
          children,
          experienceKeys: experienceKeysSorted
        };
        if (bookingEntityType === 'cabinType') {
          payload.cabinTypeId = bookingEntityId;
        } else {
          payload.cabinId = bookingEntityId;
        }
        if (lockedPromoCode) {
          payload.promoCode = lockedPromoCode;
        }
        const res = await bookingAPI.quote(payload);
        if (cancelled) return;
        if (res.data.success) {
          const d = res.data.data;
          setServerQuote((prev) => {
            if (
              prev &&
              prev.subtotalPrice === d.subtotalPrice &&
              prev.discountAmount === d.discountAmount &&
              prev.totalPrice === d.totalPrice &&
              prev.promo?.applied === d.promo?.applied &&
              prev.promo?.invalidReason === d.promo?.invalidReason
            ) {
              return prev;
            }
            return d;
          });
          if (lockedPromoCode && d.promo?.invalidReason) {
            setPromoMessage(d.promo.invalidReason);
            setLockedPromoCode(null);
            setPromoDraft('');
            writeGuestPromo('');
          } else if (lockedPromoCode && d.promo?.applied) {
            setPromoMessage(null);
          } else if (!lockedPromoCode) {
            setPromoMessage(null);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setQuoteError(e.response?.data?.message || 'Could not load price');
          setServerQuote(null);
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    bookingEntityId,
    bookingEntityType,
    checkIn,
    checkOut,
    adults,
    children,
    experienceKeysSorted,
    lockedPromoCode,
    cabin
  ]);

  const handleApplyPromo = useCallback(() => {
    setClientSecret(null);
    const t = promoDraft.trim();
    if (!t) {
      setLockedPromoCode(null);
      setPromoMessage(null);
      writeGuestPromo('');
      return;
    }
    const u = t.toUpperCase();
    setLockedPromoCode(u);
    setPromoMessage(null);
    writeGuestPromo(u);
  }, [promoDraft]);

  useEffect(() => {
    const loadStay = async () => {
      try {
        if (bookingEntityType === 'cabinType') {
          if (!bookingEntitySlug) {
            throw new Error('Missing cabin type slug');
          }
          const res = await cabinTypeAPI.getBySlug(bookingEntitySlug);
          if (res.data.success) {
            setCabin(res.data.data.cabinType);
            return;
          }
          throw new Error('Failed to load stay');
        }

        if (!bookingEntityId) {
          throw new Error('Missing cabin id');
        }

        const res = await cabinAPI.getById(bookingEntityId);
        if (res.data.success) {
          setCabin(res.data.data.cabin);
          return;
        }
        throw new Error('Failed to load cabin');
      } catch (err) {
        setError(err.message || 'Failed to load stay');
      } finally {
        setLoading(false);
      }
    };

    loadStay();
  }, [bookingEntityId, bookingEntitySlug, bookingEntityType]);

  useEffect(() => {
    bookingAPI.getConfig()
      .then((res) => {
        if (res.data?.success && res.data?.data?.stripeEnabled === true) {
          setStripeEnabled(true);
        }
      })
      .catch(() => { /* keep stripeEnabled false */ });
  }, []);

  // Sync URL when we have dates but URL lacks them (e.g. after restore from sessionStorage)
  useEffect(() => {
    if (!checkIn || !checkOut) return;
    const current = searchParams.get('checkIn');
    const expected = formatDateOnlyLocal(checkIn);
    if (current === expected) return;
    const params = new URLSearchParams(searchParams);
    params.set('checkIn', expected);
    params.set('checkOut', formatDateOnlyLocal(checkOut));
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
          const attr = getAttributionPayload();
          const bookingData = {
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
            specialRequests: fd.specialRequests || '',
            ...(data.promoCode ? { promoCode: data.promoCode } : {}),
            ...(attr && Object.values(attr).some(Boolean) ? { attribution: attr } : {})
          };
          if ((data.bookingEntityType || 'cabin') === 'cabinType') {
            bookingData.cabinTypeId = data.bookingEntityId || data.cabinId;
          } else {
            bookingData.cabinId = data.bookingEntityId || data.cabinId || id;
          }
          bookingAPI.create(bookingData)
            .then((res) => {
              if (res.data.success && res.data.data?.booking?._id) {
                const bid = res.data.data.booking._id;
                const em = (fd.email || '').trim().toLowerCase();
                if (em) {
                  try {
                    sessionStorage.setItem(`dd_booking_guest_${bid}`, em);
                  } catch (e) { /* ignore */ }
                }
                navigate(`/booking-success/${bid}`, { replace: true, state: { guestEmail: em } });
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
  }, [bookingEntityId, bookingEntityType, id, navigate]);

  useEffect(() => {
    if (
      !stripeEnabled ||
      !stripePromise ||
      !bookingEntityId ||
      !checkIn ||
      !checkOut ||
      !quoteFingerprint ||
      quoteTotalFromFingerprint == null ||
      quoteTotalFromFingerprint < 0.5 ||
      quoteLoading ||
      quoteError
    ) {
      return;
    }
    let cancelled = false;
    setStripeError(null);
    const payload = {
      checkIn: formatDateOnlyLocal(checkIn),
      checkOut: formatDateOnlyLocal(checkOut),
      adults,
      children,
      experienceKeys: experienceKeysSorted
    };
    if (bookingEntityType === 'cabinType') {
      payload.cabinTypeId = bookingEntityId;
    } else {
      payload.cabinId = bookingEntityId;
    }
    if (lockedPromoCode) {
      payload.promoCode = lockedPromoCode;
    }
    bookingAPI
      .createPaymentIntent(payload)
      .then((res) => {
        if (cancelled) return;
        if (res.data.success && res.data.clientSecret) {
          setClientSecret(res.data.clientSecret);
        }
      })
      .catch(() => {
        if (!cancelled) setStripeError('Payment setup failed');
      });
    return () => {
      cancelled = true;
      setClientSecret(null);
    };
  }, [
    stripeEnabled,
    stripePromise,
    bookingEntityId,
    bookingEntityType,
    checkIn,
    checkOut,
    adults,
    children,
    experienceKeysSorted,
    lockedPromoCode,
    quoteFingerprint,
    quoteTotalFromFingerprint,
    quoteLoading,
    quoteError
  ]);

  const handleDatesSave = useCallback((from, to) => {
    setCheckIn(from);
    setCheckOut(to);
    const params = new URLSearchParams(searchParams);
    params.set('checkIn', formatDateOnlyLocal(from));
    params.set('checkOut', formatDateOnlyLocal(to));
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
    const attr = getAttributionPayload();
    const bookingData = {
        checkIn: formatDateOnlyLocal(checkIn),
        checkOut: formatDateOnlyLocal(checkOut),
        adults,
        children,
        experienceKeys: Array.from(selectedExpKeys),
        guestInfo: {
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          email: formData.email.trim(),
          phone: formData.phone.trim()
        },
        specialRequests: formData.specialRequests.trim(),
        ...(attr && Object.values(attr).some(Boolean) ? { attribution: attr } : {})
      };
    if (bookingEntityType === 'cabinType') {
      bookingData.cabinTypeId = bookingEntityId;
    } else {
      bookingData.cabinId = bookingEntityId;
    }
    if (paymentIntentId) {
      bookingData.paymentIntentId = paymentIntentId;
    }
    if (lockedPromoCode) {
      bookingData.promoCode = lockedPromoCode;
    }
    const response = await bookingAPI.create(bookingData);
    if (response.data.success) {
      try {
        sessionStorage.removeItem(CONFIRM_BOOKING_SIMPLE_KEY);
      } catch (e) { /* ignore */ }
      const bookingId = response.data.data?.booking?._id;
      if (bookingId) {
        const em = formData.email.trim().toLowerCase();
        try {
          sessionStorage.setItem(`dd_booking_guest_${bookingId}`, em);
        } catch (e) { /* ignore */ }
        navigate(`/booking-success/${bookingId}`, { replace: true, state: { guestEmail: em } });
      } else {
        navigate('/');
      }
    } else {
      throw new Error(response.data.message || 'Booking failed');
    }
  }, [bookingEntityId, bookingEntityType, checkIn, checkOut, adults, children, formData, selectedExpKeys, experiences, navigate, lockedPromoCode]);

  const handleConfirmAndPay = useCallback(async () => {
    if (!bookingEntityId || !checkIn || !checkOut || !pricing || !serverQuote || serverQuote.totalPrice < 0.5) return;
    setSubmitLoading(true);
    setError(null);
    try {
      await createBooking(null);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Booking failed');
    } finally {
      setSubmitLoading(false);
    }
  }, [bookingEntityId, checkIn, checkOut, pricing, serverQuote, createBooking]);

  const handleStripeSubmit = useCallback(async (stripe, elements) => {
    if (!bookingEntityId || !checkIn || !checkOut || !pricing || !serverQuote || serverQuote.totalPrice < 0.5) return;
    setSubmitLoading(true);
    setError(null);
    setStripeError(null);
    try {
      sessionStorage.setItem('confirm-booking-pending', JSON.stringify({
        cabinId: bookingEntityId,
        bookingEntityId,
        bookingEntityType,
        bookingEntitySlug,
        confirmPath,
        checkIn: formatDateOnlyLocal(checkIn),
        checkOut: formatDateOnlyLocal(checkOut),
        adults,
        children,
        promoCode: lockedPromoCode || undefined,
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
          return_url: `${window.location.origin}${confirmPath}`,
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
  }, [
    bookingEntityId,
    bookingEntitySlug,
    bookingEntityType,
    checkIn,
    checkOut,
    pricing,
    serverQuote,
    adults,
    children,
    formData,
    selectedExpKeys,
    experiences,
    createBooking,
    confirmPath,
    lockedPromoCode
  ]);

  if (loading || !cabin) {
    return (
      <>
        <Seo
          title="Confirm and pay | Drift & Dwells"
          description="Review your stay details and complete your Drift & Dwells booking."
          canonicalPath={confirmPath}
          noindex
        />
        <div className="min-h-screen bg-[#F7F4EE] flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#81887A]" />
        </div>
      </>
    );
  }

  const hasGuestInfo =
    !!formData.firstName?.trim() &&
    !!formData.lastName?.trim() &&
    !!formData.email?.trim() &&
    !!formData.phone?.trim();
  const hasValidGuestInfo = hasGuestInfo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim());

  const coverImage = cabin.images?.[0]?.url || cabin.imageUrl;
  const cabinName = cabin.name || 'Cabin';

  return (
    <>
      <Seo
        title={`Confirm ${cabinName} booking | Drift & Dwells`}
        description={`Review dates, guests, and payment details for your ${cabinName} stay.`}
        canonicalPath={confirmPath}
        noindex
      />
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

        {/* Guest details */}
        <div className="mb-6 p-6 bg-white rounded-xl border border-gray-200 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Guest details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label htmlFor="confirm-first-name" className="label-editorial">First name</label>
              <input
                id="confirm-first-name"
                type="text"
                value={formData.firstName}
                onChange={(e) => handleFormChange('firstName', e.target.value)}
                className="input-editorial"
                autoComplete="given-name"
                placeholder="First name"
              />
            </div>
            <div>
              <label htmlFor="confirm-last-name" className="label-editorial">Last name</label>
              <input
                id="confirm-last-name"
                type="text"
                value={formData.lastName}
                onChange={(e) => handleFormChange('lastName', e.target.value)}
                className="input-editorial"
                autoComplete="family-name"
                placeholder="Last name"
              />
            </div>
            <div>
              <label htmlFor="confirm-email" className="label-editorial">Email</label>
              <input
                id="confirm-email"
                type="email"
                value={formData.email}
                onChange={(e) => handleFormChange('email', e.target.value)}
                className="input-editorial"
                autoComplete="email"
                placeholder="Email"
              />
            </div>
            <div>
              <label htmlFor="confirm-phone" className="label-editorial">Phone</label>
              <input
                id="confirm-phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => handleFormChange('phone', e.target.value)}
                className="input-editorial"
                autoComplete="tel"
                placeholder="Phone number"
              />
            </div>
          </div>
          <div className="mt-5">
            <label htmlFor="confirm-special-requests" className="label-editorial">Special requests</label>
            <textarea
              id="confirm-special-requests"
              value={formData.specialRequests}
              onChange={(e) => handleFormChange('specialRequests', e.target.value)}
              className="input-editorial min-h-[96px] resize-y"
              placeholder="Anything we should know before your stay?"
            />
          </div>
          {!hasValidGuestInfo && (
            <p className="mt-4 text-sm text-amber-700">
              Add your guest details before continuing to payment.
            </p>
          )}
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

        {/* Promo code — mobile: stacked control; md+: same row rhythm as Dates / Guests / Total (text link right) */}
        <div className="py-4 border-b border-gray-200">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 flex-1 w-full">
              <p className="text-sm text-gray-600 mb-2">Promo code</p>
              <input
                type="text"
                value={promoDraft}
                onChange={(e) => setPromoDraft(e.target.value)}
                autoComplete="off"
                placeholder="Optional"
                className="w-full min-w-0 h-12 border-b border-black/15 bg-transparent px-0 text-[16px] outline-none focus:border-black/30 placeholder:text-black/40"
              />
            </div>
            <button
              type="button"
              onClick={handleApplyPromo}
              className="h-12 w-full shrink-0 rounded-2xl border border-gray-300 text-sm font-medium text-gray-800 hover:bg-gray-50 md:h-auto md:w-auto md:min-w-0 md:rounded-none md:border-0 md:bg-transparent md:p-0 md:hover:bg-transparent md:text-sm md:font-medium md:text-gray-700 md:underline"
            >
              Apply
            </button>
          </div>
          {promoMessage && (
            <p className="text-sm text-amber-800 mt-3">{promoMessage}</p>
          )}
          {quoteError && (
            <p className="text-sm text-red-600 mt-3">{quoteError}</p>
          )}
        </div>

        {/* Total row */}
        <div className="flex items-center justify-between py-4 border-b border-gray-200">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-gray-600">Total price</p>
            {quoteLoading ? (
              <p className="font-medium text-gray-500 mt-0.5">Updating…</p>
            ) : quoteError ? (
              <p className="font-medium text-gray-500 mt-0.5">—</p>
            ) : (
              <div className="mt-0.5 space-y-0.5">
                {displaySubtotal != null && displayDiscount > 0 && (
                  <p className="text-xs text-gray-400 line-through decoration-gray-400/80 tabular-nums">
                    Was €{Number(displaySubtotal).toLocaleString()}
                  </p>
                )}
                {displayDiscount > 0 && (
                  <p className="text-xs text-gray-600 tabular-nums">
                    Promo −€{Number(displayDiscount).toLocaleString()}
                  </p>
                )}
                <p className="font-medium text-gray-900 tabular-nums">
                  €{Number(displayTotal).toLocaleString()} EUR
                </p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setPriceModalOpen(true)}
            className="text-sm font-medium text-gray-700 underline shrink-0 ml-3"
          >
            Details
          </button>
        </div>

        {/* Cancellation */}
        <div className="py-4">
          <p className="font-medium text-gray-900">Free cancellation</p>
          <p className="text-sm text-gray-600 mt-0.5">
            Cancel before {checkIn && formatDate(new Date(checkIn.getFullYear(), checkIn.getMonth(), checkIn.getDate() - 5))} for a full refund.
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
                <PaymentFormInner
                  onSubmit={handleStripeSubmit}
                  loading={submitLoading}
                  disabled={
                    !hasValidGuestInfo || quoteLoading || !!quoteError || !serverQuote || serverQuote.totalPrice < 0.5
                  }
                />
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
                disabled={
                  submitLoading ||
                  !pricing ||
                  !hasValidGuestInfo ||
                  quoteLoading ||
                  !!quoteError ||
                  !serverQuote ||
                  serverQuote.totalPrice < 0.5
                }
                className="w-full h-12 rounded-xl bg-[#81887A] text-white font-semibold hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitLoading
                  ? 'Submitting...'
                  : `Confirm and pay €${Number(displayTotal).toLocaleString()}`}
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
          totalPrice={displayTotal}
          serverSubtotal={displaySubtotal != null ? displaySubtotal : undefined}
          discountAmount={displayDiscount}
          extras={experienceExtras}
        />
      </div>
    </>
  );
}

export default ConfirmBooking;
