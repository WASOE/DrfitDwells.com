import { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { startOfDay, isBefore } from 'date-fns';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Minus, Plus } from 'lucide-react';
import { useBookingSearch } from '../../../context/BookingSearchContext';
import { useSiteLanguage } from '../../../hooks/useSiteLanguage';
import GuestSelect from '../../../components/GuestSelect';
import { StayLodgingPriceBlock } from '../../../components/booking/StayLodgingPriceBlock';
import PriceDetailsModal from '../../../components/booking/PriceDetailsModal';
import {
  locationCheckoutAPI,
  locationQuoteAPI,
  isLocationHoldExpiredError
} from '../../../services/locationApi';
import { formatDateOnlyLocal } from '../../../utils/dateOnly';
import { formatStayRangeSummary, getDateFnsLocale } from '../../../utils/localeDates';
import { getMinSelectableStayDate } from '../../../utils/bookingMinStayDate';
import '../../../styles/daypicker-theme.css';
import '../../../i18n/ns/booking';
import '../../../i18n/ns/valley';

const DayPicker = lazy(() =>
  import('react-day-picker').then((m) => {
    import('react-day-picker/dist/style.css');
    return { default: m.DayPicker };
  })
);

const stripePk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise = stripePk ? loadStripe(stripePk) : null;

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

function LocationPaymentForm({
  onSubmit,
  loading,
  disabled = false
}) {
  const { t } = useTranslation('booking');
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
        className="w-full py-3.5 rounded-xl bg-[#81887A] text-white font-semibold text-sm hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? t('confirm.processingPayment') : t('cta.confirmAndPay')}
      </button>
    </form>
  );
}

const LocationRetreatQuotePanel = ({ onQuoteChange, panelRef }) => {
  const { t: tb } = useTranslation('booking');
  const { t: tv } = useTranslation('valley');
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
  const [isMobile, setIsMobile] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [dateError, setDateError] = useState('');
  const [showPriceDetails, setShowPriceDetails] = useState(false);

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
  const [roomAllocationOpen, setRoomAllocationOpen] = useState(false);

  useEffect(() => {
    setRange({
      from: checkIn ? startOfDay(checkIn) : null,
      to: checkOut ? startOfDay(checkOut) : null
    });
  }, [checkIn, checkOut]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const minStayDate = getMinSelectableStayDate();

  const handleSelect = (selectedRange) => {
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
  };

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

  return (
    <div
      ref={panelRef}
      id="retreat-quote-panel"
      data-booking-anchor
      className="booking-card-compact rounded-2xl border border-gray-200/80 shadow-sm bg-white p-5 md:p-6 scroll-mt-[var(--header-offset,5.5rem)]"
    >
      {success ? (
        <div className="text-center py-4">
          <p className="text-xs uppercase tracking-[0.25em] text-[#81887A] mb-2">
            {tv('retreat.quote.confirmedEyebrow')}
          </p>
          <h3 className="font-serif text-2xl text-gray-900 mb-2">{tv('retreat.quote.confirmedTitle')}</h3>
          <p className="text-sm text-gray-600 mb-4">{tv('retreat.quote.confirmedBody')}</p>
          <p className="text-xs text-gray-500 tabular-nums">
            {tv('retreat.quote.reference', { id: success.locationBookingId })}
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4">
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500 mb-1">
              {tv('retreat.quote.panelEyebrow')}
            </p>
            <h3 className="font-serif text-xl md:text-2xl text-gray-900">
              {tv('retreat.quote.panelTitle')}
            </h3>
          </div>

          {holdExpired && (
            <div
              className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              role="alert"
            >
              <p className="font-semibold mb-1">{tv('retreat.quote.holdExpiredTitle')}</p>
              <p>{tv('retreat.quote.holdExpiredBody')}</p>
            </div>
          )}

          <div className="space-y-5">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-gray-500 mb-2">
                {tb('mobile.datesLabel')}
              </p>
              <p className="text-sm text-gray-700 mb-3">{dateSummary}</p>
              <Suspense
                fallback={
                  <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
                    {tb('modal.loadingCalendar')}
                  </div>
                }
              >
                <DayPicker
                  mode="range"
                  selected={range}
                  onSelect={handleSelect}
                  numberOfMonths={isMobile ? 1 : 2}
                  pagedNavigation
                  captionLayout="dropdown-buttons"
                  locale={getDateFnsLocale(language)}
                  fromDate={minStayDate}
                  disabled={{ before: minStayDate }}
                  className="booking-modal-daypicker w-full mx-auto"
                  styles={{
                    caption: { textAlign: 'left', fontFamily: 'Playfair Display' },
                    months: {
                      display: 'flex',
                      flexDirection: isMobile ? 'column' : 'row',
                      flexWrap: 'nowrap',
                      gap: isMobile ? '1rem' : '1.5rem'
                    }
                  }}
                />
              </Suspense>
              {dateError && <p className="text-red-600 text-sm mt-2">{dateError}</p>}
            </div>

            <GuestSelect label={tb('fields.guests')} />

            <button
              type="button"
              onClick={runQuote}
              disabled={quoteLoading}
              className="w-full py-3 rounded-xl border border-gray-300 text-gray-900 font-semibold text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              {quoteLoading ? `${tb('cta.checkAvailability')}…` : tb('cta.checkAvailability')}
            </button>

            {quoteError && (
              <p className="text-sm text-red-600" role="alert">
                {quoteError}
              </p>
            )}

            {showUnavailable && (
              <div
                className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-5 text-center"
                role="status"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-600 mb-2">
                  {tb('search.unavailableForDates')}
                </p>
                <p className="text-sm text-stone-700 leading-relaxed">
                  {quote.unavailableReason || tb('search.unavailableForDates')}
                </p>
              </div>
            )}

            {showAvailablePrice && (
              <div className="border-t border-gray-100 pt-4">
                <StayLodgingPriceBlock
                  finalAmount={quote.totalPrice}
                  priceClassName="text-2xl font-semibold text-gray-900"
                  priceSuffix={
                    <span className="text-base font-normal text-gray-500 ml-1">
                      {tb('details.priceTotalSuffix')}
                    </span>
                  }
                  footnote={
                    <p className="text-sm text-gray-500 mt-0.5">
                      {tb('modal.nights', { count: quote.nights || nights })}
                      {quote.totalSleeps
                        ? ` · ${tv('retreat.quote.sleepsTotal', { count: quote.totalSleeps })}`
                        : ''}
                    </p>
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowPriceDetails(true)}
                  className="text-sm text-gray-600 underline hover:text-gray-900 mt-2"
                >
                  {tb('confirm.priceDetailsModalTitle')}
                </button>
              </div>
            )}

            {showAvailablePrice && !checkoutStep && (
              <button
                type="button"
                data-booking-primary-cta="true"
                onClick={startCheckout}
                disabled={checkoutLoading}
                className="w-full py-3.5 rounded-xl bg-[#81887A] text-white font-semibold text-sm hover:opacity-95 disabled:opacity-50"
              >
                {checkoutLoading
                  ? tb('confirm.processingPayment')
                  : tb('details.continueToPaymentShort')}
              </button>
            )}

            {checkoutError && (
              <p className="text-sm text-red-600" role="alert">
                {checkoutError}
              </p>
            )}

            {checkoutStep && clientSecret && stripePromise && (
              <div className="border-t border-gray-100 pt-4 space-y-4">
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label htmlFor="retreat-first-name" className="label-editorial">
                      {tb('confirm.firstName')}
                    </label>
                    <input
                      id="retreat-first-name"
                      type="text"
                      value={formData.firstName}
                      onChange={(e) => setFormData((f) => ({ ...f, firstName: e.target.value }))}
                      className="input-editorial"
                      autoComplete="given-name"
                    />
                  </div>
                  <div>
                    <label htmlFor="retreat-last-name" className="label-editorial">
                      {tb('confirm.lastName')}
                    </label>
                    <input
                      id="retreat-last-name"
                      type="text"
                      value={formData.lastName}
                      onChange={(e) => setFormData((f) => ({ ...f, lastName: e.target.value }))}
                      className="input-editorial"
                      autoComplete="family-name"
                    />
                  </div>
                  <div>
                    <label htmlFor="retreat-email" className="label-editorial">
                      {tb('confirm.email')}
                    </label>
                    <input
                      id="retreat-email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData((f) => ({ ...f, email: e.target.value }))}
                      className="input-editorial"
                      autoComplete="email"
                    />
                  </div>
                  <div>
                    <label htmlFor="retreat-phone" className="label-editorial">
                      {tb('confirm.phone')}
                    </label>
                    <input
                      id="retreat-phone"
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData((f) => ({ ...f, phone: e.target.value }))}
                      className="input-editorial"
                      autoComplete="tel"
                    />
                  </div>
                </div>

                <Elements stripe={stripePromise} options={{ clientSecret }}>
                  <LocationPaymentForm
                    onSubmit={handlePay}
                    loading={payLoading}
                    disabled={!guestFormValid}
                  />
                </Elements>
              </div>
            )}

            {showAvailablePrice && (
              <div className="border-t border-gray-100 pt-4">
                <button
                  type="button"
                  onClick={() => setRoomAllocationOpen((v) => !v)}
                  className="text-sm text-gray-600 underline hover:text-gray-900"
                >
                  {tv('retreat.quote.roomAllocationToggle')}
                </button>
                {roomAllocationOpen && (
                  <div className="mt-3 space-y-3">
                    <p className="text-xs text-gray-500">{tv('retreat.quote.roomAllocationHint')}</p>
                    <div>
                      <label htmlFor="retreat-room-notes" className="label-editorial">
                        {tv('retreat.quote.roomNotesLabel')}
                      </label>
                      <textarea
                        id="retreat-room-notes"
                        value={roomNotes}
                        onChange={(e) => setRoomNotes(e.target.value)}
                        className="input-editorial min-h-[72px] resize-y"
                        rows={3}
                      />
                    </div>
                    {roomAssignments.map((row, index) => (
                      <div key={`${row.accommodationName}-${index}`} className="rounded-lg border border-gray-100 p-3 space-y-2">
                        <p className="text-sm font-medium text-gray-900">{row.accommodationName}</p>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-gray-500">
                            {tv('retreat.quote.plannedGuests')}
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setRoomAssignments((rows) =>
                                  rows.map((r, i) =>
                                    i === index
                                      ? {
                                          ...r,
                                          plannedGuests: Math.max(
                                            0,
                                            (r.plannedGuests ?? 0) - 1
                                          )
                                        }
                                      : r
                                  )
                                )
                              }
                              className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center text-gray-700"
                              aria-label={tv('retreat.quote.decreaseGuests')}
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                            <span className="text-sm tabular-nums min-w-[1.5rem] text-center">
                              {row.plannedGuests ?? '—'}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setRoomAssignments((rows) =>
                                  rows.map((r, i) =>
                                    i === index
                                      ? {
                                          ...r,
                                          plannedGuests: (r.plannedGuests ?? 0) + 1
                                        }
                                      : r
                                  )
                                )
                              }
                              className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center text-gray-700"
                              aria-label={tv('retreat.quote.increaseGuests')}
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <PriceDetailsModal
            isOpen={showPriceDetails}
            onClose={() => setShowPriceDetails(false)}
            nights={quote?.nights}
            totalPrice={quote?.totalPrice}
            serverSubtotal={quote?.lodgingSubtotal ?? quote?.totalPrice}
            extras={priceExtras}
          />
        </>
      )}
    </div>
  );
};

export default LocationRetreatQuotePanel;
