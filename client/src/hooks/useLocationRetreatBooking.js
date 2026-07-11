import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { startOfDay, isBefore } from 'date-fns';
import { useBookingSearch } from '../context/BookingSearchContext';
import { useSiteLanguage } from './useSiteLanguage';
import {
  locationCheckoutAPI,
  locationQuoteAPI,
  locationAvailabilityAPI,
  isLocationHoldExpiredError
} from '../services/locationApi';
import { formatDateOnlyLocal } from '../utils/dateOnly';
import { formatStayRangeSummary } from '../utils/localeDates';
import { getMinSelectableStayDate } from '../utils/bookingMinStayDate';

const AUTO_QUOTE_DEBOUNCE_MS = 350;
const DEFAULT_AVAILABILITY_WINDOW_MONTHS = 12;

function buildRoomAllocationPayload(notes, assignments) {
  const trimmedNotes = (notes || '').trim();
  const validAssignments = (assignments || [])
    .map((row) => ({
      accommodationName: (row.accommodationName || '').trim(),
      plannedGuests: row.plannedGuests == null ? null : Math.max(0, row.plannedGuests),
      notes: (row.notes || '').trim() || null
    }))
    .filter((row) => row.accommodationName);

  if (!trimmedNotes && validAssignments.length === 0) return undefined;
  return {
    ...(trimmedNotes ? { notes: trimmedNotes } : {}),
    assignments: validAssignments
  };
}

function addMonthsLocal(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

/**
 * Shared booking state machine for whole-Valley retreat buyout (hero + quote panel).
 *
 * @param {object} options
 * @param {(quote: object|null) => void} [options.onQuoteChange]
 * @param {boolean} [options.autoQuote=false] — debounced quote after complete range (not used by panel)
 * @param {number} [options.minNights=2] — minimum nights for auto-quote
 */
export function useLocationRetreatBooking({
  onQuoteChange,
  autoQuote = false,
  minNights = 2
} = {}) {
  const { t: tb } = useTranslation('booking');
  const { language } = useSiteLanguage();
  const {
    checkIn,
    checkOut,
    adults,
    children,
    nights,
    updateDates,
    updateGuests
  } = useBookingSearch();

  const [range, setRange] = useState({
    from: checkIn ? startOfDay(checkIn) : null,
    to: checkOut ? startOfDay(checkOut) : null
  });
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [dateError, setDateError] = useState('');

  const [checkoutStep, setCheckoutStep] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);
  const [holdExpired, setHoldExpired] = useState(false);
  const [checkoutSessionId, setCheckoutSessionId] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [paymentIntentId, setPaymentIntentId] = useState(null);
  const [payLoading, setPayLoading] = useState(false);
  const [success, setSuccess] = useState(null);

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: ''
  });
  const [roomNotes, setRoomNotes] = useState('');
  const [roomAssignments, setRoomAssignments] = useState([]);

  /** @type {'idle'|'loading'|'loaded'|'error'} */
  const [availabilityStatus, setAvailabilityStatus] = useState('idle');
  /** null = not loaded or fetch failed; [] = loaded with no blocked nights */
  const [blockedNights, setBlockedNights] = useState(null);
  const [availabilityError, setAvailabilityError] = useState(null);

  const autoQuoteTimerRef = useRef(null);

  useEffect(() => {
    setRange({
      from: checkIn ? startOfDay(checkIn) : null,
      to: checkOut ? startOfDay(checkOut) : null
    });
  }, [checkIn, checkOut]);

  const minStayDate = getMinSelectableStayDate();

  const handleSelect = useCallback(
    (selectedRange) => {
      const today = getMinSelectableStayDate();
      const next = selectedRange
        ? {
            from: selectedRange.from ? startOfDay(selectedRange.from) : null,
            to: selectedRange.to ? startOfDay(selectedRange.to) : null
          }
        : { from: null, to: null };
      if (next.from && isBefore(next.from, today)) return;
      if (next.to && isBefore(next.to, today)) return;
      setRange(next);
      if (next.from && next.to) {
        updateDates(next.from, next.to);
        setDateError('');
        setQuote(null);
        setHoldExpired(false);
        setCheckoutStep(false);
        setClientSecret(null);
        onQuoteChange?.(null);
      }
    },
    [updateDates, onQuoteChange]
  );

  const roomAllocationPayload = useMemo(
    () => buildRoomAllocationPayload(roomNotes, roomAssignments),
    [roomNotes, roomAssignments]
  );

  const syncAssignmentsFromQuote = useCallback((nextQuote) => {
    const targets = nextQuote?.includedTargets;
    if (!Array.isArray(targets) || targets.length === 0) return;
    setRoomAssignments((prev) => {
      if (prev.length > 0) return prev;
      return targets.map((target) => ({
        accommodationName:
          target.unitCount > 1 ? `${target.name} × ${target.unitCount}` : target.name,
        plannedGuests: null,
        notes: ''
      }));
    });
  }, []);

  const runQuote = useCallback(async () => {
    if (!checkIn || !checkOut) {
      setDateError(tb('errors.datesRequired'));
      return null;
    }
    const today = getMinSelectableStayDate();
    if (isBefore(startOfDay(checkIn), today)) {
      setDateError(tb('errors.checkInPast'));
      return null;
    }

    setQuoteLoading(true);
    setQuoteError(null);
    setHoldExpired(false);
    setCheckoutStep(false);
    setClientSecret(null);
    setCheckoutSessionId(null);
    setPaymentIntentId(null);
    setSuccess(null);

    try {
      const payload = {
        checkIn: formatDateOnlyLocal(checkIn),
        checkOut: formatDateOnlyLocal(checkOut),
        adults,
        children,
        ...(roomAllocationPayload ? { roomAllocation: roomAllocationPayload } : {})
      };
      const res = await locationQuoteAPI.quoteTheValley(payload);
      if (!res.data?.success) {
        throw new Error(res.data?.message || tb('errors.quoteFailed', { defaultValue: 'Could not fetch quote' }));
      }
      const nextQuote = res.data.data;
      setQuote(nextQuote);
      syncAssignmentsFromQuote(nextQuote);
      onQuoteChange?.(nextQuote);
      return nextQuote;
    } catch (err) {
      const message =
        err.response?.data?.message ||
        err.message ||
        tb('errors.quoteFailed', { defaultValue: 'Could not fetch quote' });
      setQuoteError(message);
      setQuote(null);
      onQuoteChange?.(null);
      return null;
    } finally {
      setQuoteLoading(false);
    }
  }, [
    checkIn,
    checkOut,
    adults,
    children,
    roomAllocationPayload,
    syncAssignmentsFromQuote,
    onQuoteChange,
    tb
  ]);

  useEffect(() => {
    if (!autoQuote) return undefined;
    if (!checkIn || !checkOut || nights < minNights) return undefined;

    if (autoQuoteTimerRef.current) {
      clearTimeout(autoQuoteTimerRef.current);
    }
    autoQuoteTimerRef.current = setTimeout(() => {
      runQuote();
    }, AUTO_QUOTE_DEBOUNCE_MS);

    return () => {
      if (autoQuoteTimerRef.current) {
        clearTimeout(autoQuoteTimerRef.current);
        autoQuoteTimerRef.current = null;
      }
    };
  }, [autoQuote, checkIn, checkOut, nights, minNights, runQuote]);

  const loadAvailability = useCallback(
    async (locationKeyOrSlug = 'the-valley', { months = DEFAULT_AVAILABILITY_WINDOW_MONTHS } = {}) => {
      setAvailabilityStatus('loading');
      setAvailabilityError(null);

      const fromDate = getMinSelectableStayDate();
      const from = formatDateOnlyLocal(fromDate);
      const to = formatDateOnlyLocal(addMonthsLocal(fromDate, months));

      try {
        const body = await locationAvailabilityAPI.getAvailability(locationKeyOrSlug, { from, to });
        if (!body?.success) {
          throw new Error(body?.message || 'Could not load location availability');
        }
        setBlockedNights(Array.isArray(body.data?.blockedNights) ? body.data.blockedNights : []);
        setAvailabilityStatus('loaded');
        return body.data;
      } catch (err) {
        setBlockedNights(null);
        setAvailabilityStatus('error');
        setAvailabilityError(err);
        return null;
      }
    },
    []
  );

  const startCheckout = useCallback(async () => {
    if (!quote?.available) return;
    setCheckoutLoading(true);
    setCheckoutError(null);
    setHoldExpired(false);

    try {
      const payload = {
        checkIn: formatDateOnlyLocal(checkIn),
        checkOut: formatDateOnlyLocal(checkOut),
        adults,
        children,
        ...(roomAllocationPayload ? { roomAllocation: roomAllocationPayload } : {})
      };
      const res = await locationCheckoutAPI.createPaymentIntent(payload);
      if (!res.data?.success) {
        throw new Error(res.data?.message || tb('confirm.paymentSetupFailed'));
      }
      const data = res.data.data;
      setCheckoutSessionId(data.checkoutSessionId);
      setClientSecret(data.clientSecret);
      setPaymentIntentId(data.paymentIntentId);
      if (data.quote) {
        setQuote(data.quote);
        onQuoteChange?.(data.quote);
      }
      setCheckoutStep(true);
    } catch (err) {
      if (isLocationHoldExpiredError(err)) {
        setHoldExpired(true);
        setCheckoutStep(false);
        setClientSecret(null);
      } else {
        setCheckoutError(
          err.response?.data?.message || err.message || tb('confirm.paymentSetupFailed')
        );
      }
    } finally {
      setCheckoutLoading(false);
    }
  }, [
    quote,
    checkIn,
    checkOut,
    adults,
    children,
    roomAllocationPayload,
    onQuoteChange,
    tb
  ]);

  const handlePay = useCallback(
    async (stripe, elements) => {
      if (!checkoutSessionId || !paymentIntentId) return;
      setPayLoading(true);
      setCheckoutError(null);

      try {
        const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
          elements,
          confirmParams: {
            payment_method_data: {
              billing_details: {
                name: `${formData.firstName.trim()} ${formData.lastName.trim()}`,
                email: formData.email.trim(),
                phone: formData.phone.trim() || undefined
              }
            }
          },
          redirect: 'if_required'
        });

        if (stripeError) {
          setCheckoutError(stripeError.message || tb('confirm.paymentFailed'));
          return;
        }

        const resolvedIntentId = paymentIntent?.id || paymentIntentId;
        if (paymentIntent?.status !== 'succeeded' && paymentIntent?.status !== 'processing') {
          setCheckoutError(tb('confirm.paymentFailed'));
          return;
        }

        const finalizeRes = await locationCheckoutAPI.finalize({
          checkoutSessionId,
          paymentIntentId: resolvedIntentId,
          adults,
          children,
          guestInfo: {
            firstName: formData.firstName.trim(),
            lastName: formData.lastName.trim(),
            email: formData.email.trim(),
            phone: formData.phone.trim() || undefined
          },
          ...(roomAllocationPayload ? { roomAllocation: roomAllocationPayload } : {})
        });

        if (!finalizeRes.data?.success) {
          throw new Error(finalizeRes.data?.message || tb('confirm.paymentFailed'));
        }

        setSuccess(finalizeRes.data.data);
        setCheckoutStep(false);
        setClientSecret(null);
      } catch (err) {
        if (isLocationHoldExpiredError(err)) {
          setHoldExpired(true);
          setCheckoutStep(false);
          setClientSecret(null);
          setCheckoutSessionId(null);
          setPaymentIntentId(null);
        } else {
          setCheckoutError(
            err.response?.data?.message || err.message || tb('confirm.paymentFailed')
          );
        }
      } finally {
        setPayLoading(false);
      }
    },
    [
      checkoutSessionId,
      paymentIntentId,
      formData,
      adults,
      children,
      roomAllocationPayload,
      tb
    ]
  );

  const dateSummary = useMemo(() => {
    if (checkIn && checkOut) {
      return formatStayRangeSummary(checkIn, checkOut, language);
    }
    return tb('modal.selectYourStay');
  }, [checkIn, checkOut, language, tb]);

  const priceExtras = useMemo(() => {
    if (!quote?.includedTargets) return [];
    return quote.includedTargets.map((target) => ({
      label: `${target.unitCount > 1 ? `${target.name} × ${target.unitCount}` : target.name}`,
      amount: target.lodgingSubtotal
    }));
  }, [quote]);

  const guestFormValid =
    !!formData.firstName.trim() &&
    !!formData.lastName.trim() &&
    !!formData.email.trim();

  const showUnavailable = quote && quote.available === false;
  const showAvailablePrice = quote && quote.available === true;

  const hasBlockedNightsData = availabilityStatus === 'loaded' && blockedNights !== null;

  return {
    checkIn,
    checkOut,
    adults,
    children,
    nights,
    updateGuests,
    range,
    handleSelect,
    minStayDate,
    quote,
    quoteLoading,
    quoteError,
    dateError,
    runQuote,
    checkoutStep,
    checkoutLoading,
    checkoutError,
    holdExpired,
    startCheckout,
    clientSecret,
    paymentIntentId,
    handlePay,
    payLoading,
    success,
    formData,
    setFormData,
    roomNotes,
    setRoomNotes,
    roomAssignments,
    setRoomAssignments,
    dateSummary,
    priceExtras,
    guestFormValid,
    showUnavailable,
    showAvailablePrice,
    availabilityStatus,
    blockedNights,
    availabilityError,
    hasBlockedNightsData,
    loadAvailability
  };
}

export default useLocationRetreatBooking;
