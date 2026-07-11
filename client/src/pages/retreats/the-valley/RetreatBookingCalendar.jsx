import { useCallback, useEffect, useMemo, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { Minus, Plus, X } from 'lucide-react';
import LocationPaymentForm from './LocationPaymentForm';
import useLocationRetreatBooking from '../../../hooks/useLocationRetreatBooking';
import { useBookingSearch } from '../../../context/BookingSearchContext';
import { useSiteLanguage } from '../../../hooks/useSiteLanguage';
import { StayLodgingPriceBlock } from '../../../components/booking/StayLodgingPriceBlock';
import {
  isRetreatStayRangeComplete,
  isRetreatStaySelectingCheckout,
  isRetreatStayCalendarDateDisabled,
  normalizeRetreatStayRangeSelection,
  maxCheckoutDateForCheckIn,
  lastFreeNightOfRun,
  minCheckoutDateForCheckIn,
  isValidCheckoutForCheckIn
} from '../../../utils/stayWindows';
import { formatStayDay, formatStayRangeSummary, getDateFnsLocale } from '../../../utils/localeDates';
import {
  addDaysDateOnly,
  compareDateOnly,
  formatDateOnlyLocal,
  parseDateOnlyLocal
} from '../../../utils/dateOnly';
import '../../../styles/daypicker-theme.css';
import '../../../i18n/ns/booking';
import '../../../i18n/ns/valley';

const RETREAT_DAYPICKER_MODIFIERS = {
  blockedNight: 'rdp-retreat_blocked',
  constraintDisabled: 'rdp-retreat_constraint',
  prospectiveStay: 'rdp-retreat_prospective'
};

function isRetreatProspectiveStayNight(dateOnly, checkInOnly, blockedSet) {
  if (!dateOnly || !checkInOnly) return false;
  if (compareDateOnly(dateOnly, checkInOnly) <= 0) return false;
  if (blockedSet.has(dateOnly)) return false;

  const lastFree = lastFreeNightOfRun(checkInOnly, blockedSet);
  const maxCheckout = maxCheckoutDateForCheckIn(checkInOnly, blockedSet);
  if (!lastFree || !maxCheckout) return false;
  if (compareDateOnly(dateOnly, maxCheckout) >= 0) return false;

  return compareDateOnly(dateOnly, lastFree) <= 0;
}

function listValidCheckoutsForCheckIn(checkInOnly, blockedSet, minNights) {
  const minCheckout = minCheckoutDateForCheckIn(checkInOnly, minNights);
  const maxCheckout = maxCheckoutDateForCheckIn(checkInOnly, blockedSet);
  if (!minCheckout || !maxCheckout) return [];

  const valid = [];
  let cursor = minCheckout;
  while (compareDateOnly(cursor, maxCheckout) <= 0) {
    if (isValidCheckoutForCheckIn(cursor, checkInOnly, blockedSet, minNights)) {
      valid.push(cursor);
    }
    cursor = addDaysDateOnly(cursor, 1);
  }
  return valid;
}

const AVAILABILITY_WINDOW_MONTHS = 12;
const CALENDAR_MIN_HEIGHT = 'min-h-[320px]';
const QUOTE_PANEL_ID = 'retreat-quote-panel';

const DayPicker = lazy(() =>
  import('react-day-picker').then((m) => {
    import('react-day-picker/dist/style.css');
    return { default: m.DayPicker };
  })
);

const stripePk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise = stripePk ? loadStripe(stripePk) : null;

function formatEuroAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function resolveMinNights(inventory) {
  if (inventory?.maxMinNights != null && Number.isFinite(Number(inventory.maxMinNights))) {
    return Number(inventory.maxMinNights);
  }
  if (inventory?.fromPrice?.nights != null && Number.isFinite(Number(inventory.fromPrice.nights))) {
    return Number(inventory.fromPrice.nights);
  }
  return 2;
}

function CalendarSkeleton({ label }) {
  return (
    <div
      className={`${CALENDAR_MIN_HEIGHT} flex flex-col`}
      aria-busy="true"
      aria-live="polite"
      aria-label={label}
    >
      <div className="animate-pulse flex-1 space-y-4">
        <div className="h-6 bg-gray-200 rounded w-1/2 mx-auto" />
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 35 }, (_, index) => (
            <div key={index} className="h-9 bg-gray-100 rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}

function CompactGuestStepper({
  label,
  value,
  min,
  onDecrease,
  onIncrease,
  decreaseLabel,
  increaseLabel,
  isSheet
}) {
  const buttonClass = isSheet
    ? 'w-10 h-10 rounded-full border border-gray-300 flex items-center justify-center text-gray-700 touch-manipulation'
    : 'w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-700';

  return (
    <div className="flex-1 min-w-0">
      <p className="text-[10px] uppercase tracking-[0.25em] text-gray-500 mb-2">{label}</p>
      <div className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 py-2">
        <button
          type="button"
          onClick={onDecrease}
          disabled={value <= min}
          className={`${buttonClass} disabled:opacity-30 disabled:cursor-not-allowed`}
          aria-label={decreaseLabel}
        >
          <Minus className="w-4 h-4" />
        </button>
        <span className="text-base font-medium tabular-nums text-gray-900 min-w-[1.5rem] text-center">
          {value}
        </span>
        <button
          type="button"
          onClick={onIncrease}
          className={buttonClass}
          aria-label={increaseLabel}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function scrollToQuotePanel(onClose) {
  const panel = document.getElementById(QUOTE_PANEL_ID);
  if (panel) {
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  onClose?.();
}

/**
 * Inline hero / sheet booking calendar for whole-Valley buyout.
 * Not wired to any page until Phase 4+.
 */
const RetreatBookingCalendar = ({
  variant = 'hero-card',
  slug = 'the-valley',
  inventory = null,
  onClose,
  hideHeader = false,
  onCheckoutStepChange
}) => {
  const { t: tb } = useTranslation('booking');
  const { t: tv } = useTranslation('valley');
  const { language } = useSiteLanguage();
  const { updateDates } = useBookingSearch();
  const isSheet = variant === 'sheet';
  const minNights = resolveMinNights(inventory);

  const {
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
    checkoutStep,
    checkoutLoading,
    checkoutError,
    holdExpired,
    startCheckout,
    clientSecret,
    handlePay,
    payLoading,
    success,
    formData,
    setFormData,
    dateSummary,
    guestFormValid,
    showUnavailable,
    showAvailablePrice,
    availabilityStatus,
    blockedNights,
    loadAvailability
  } = useLocationRetreatBooking({
    autoQuote: true,
    minNights
  });

  useEffect(() => {
    loadAvailability(slug, { months: AVAILABILITY_WINDOW_MONTHS });
  }, [slug, loadAvailability]);

  useEffect(() => {
    onCheckoutStepChange?.(checkoutStep);
  }, [checkoutStep, onCheckoutStepChange]);

  const blockedDateSet = useMemo(() => {
    if (!Array.isArray(blockedNights)) return new Set();
    return new Set(blockedNights);
  }, [blockedNights]);

  const isCalendarLoading =
    availabilityStatus === 'idle' || availabilityStatus === 'loading';
  const isCalendarError = availabilityStatus === 'error';
  const isCalendarReady = availabilityStatus === 'loaded';

  const isDateDisabled = useCallback(
    (date) =>
      isRetreatStayCalendarDateDisabled(date, {
        minStayDate,
        blockedSet: blockedDateSet,
        minNights,
        rangeFrom: range?.from ?? null,
        rangeTo: range?.to ?? null,
        calendarReady: isCalendarReady
      }),
    [minStayDate, isCalendarReady, blockedDateSet, minNights, range?.from, range?.to]
  );

  const selectingCheckout = isRetreatStaySelectingCheckout(range?.from, range?.to);
  const rangeFromOnly = range?.from ? formatDateOnlyLocal(range.from) : null;

  const calendarModifiers = useMemo(() => {
    const calendarOptions = {
      minStayDate,
      blockedSet: blockedDateSet,
      minNights,
      rangeFrom: range?.from ?? null,
      rangeTo: range?.to ?? null,
      calendarReady: isCalendarReady
    };

    const isProspectiveStay = (date) => {
      if (!selectingCheckout || !rangeFromOnly || !isCalendarReady) return false;
      return isRetreatProspectiveStayNight(
        formatDateOnlyLocal(date),
        rangeFromOnly,
        blockedDateSet
      );
    };

    return {
      blockedNight: (date) => {
        if (!isCalendarReady) return false;
        return blockedDateSet.has(formatDateOnlyLocal(date));
      },
      prospectiveStay: isProspectiveStay,
      constraintDisabled: (date) => {
        if (!isRetreatStayCalendarDateDisabled(date, calendarOptions)) return false;
        const dateOnly = formatDateOnlyLocal(date);
        if (blockedDateSet.has(dateOnly)) return false;
        if (isProspectiveStay(date)) return false;
        return true;
      }
    };
  }, [
    selectingCheckout,
    rangeFromOnly,
    isCalendarReady,
    blockedDateSet,
    minStayDate,
    minNights,
    range?.from,
    range?.to
  ]);

  const singleCheckoutHint = useMemo(() => {
    if (!selectingCheckout || !range?.from || !isCalendarReady) return null;

    const validCheckouts = listValidCheckoutsForCheckIn(
      rangeFromOnly,
      blockedDateSet,
      minNights
    );
    if (validCheckouts.length !== 1) return null;

    const checkoutDate = parseDateOnlyLocal(validCheckouts[0]);
    if (!checkoutDate) return null;

    return tv('retreat.hero.calendar.singleCheckoutHint', {
      date: formatStayDay(checkoutDate, language)
    });
  }, [
    selectingCheckout,
    range?.from,
    rangeFromOnly,
    isCalendarReady,
    blockedDateSet,
    minNights,
    language,
    tv
  ]);

  const pickerSelected = useMemo(
    () => normalizeRetreatStayRangeSelection(range),
    [range]
  );

  const onCalendarSelect = useCallback(
    (selectedRange) => {
      if (selectedRange === undefined) {
        handleSelect(undefined);
        updateDates(null, null);
        return;
      }

      const normalized = normalizeRetreatStayRangeSelection(selectedRange);
      if (!normalized) {
        handleSelect(undefined);
        updateDates(null, null);
        return;
      }

      if (!normalized.to) {
        updateDates(null, null);
      }

      handleSelect(normalized);
    },
    [handleSelect, updateDates]
  );

  const calendarDateSummary = useMemo(() => {
    if (isRetreatStayRangeComplete(range?.from, range?.to)) {
      return formatStayRangeSummary(range.from, range.to, language);
    }
    if (isRetreatStaySelectingCheckout(range?.from, range?.to)) {
      return `${formatStayDay(range.from, language)} → ${tv('retreat.hero.calendar.selectCheckout')}`;
    }
    if (checkIn && checkOut) {
      return formatStayRangeSummary(checkIn, checkOut, language);
    }
    return dateSummary;
  }, [range?.from, range?.to, checkIn, checkOut, language, dateSummary, tv]);

  const hasCompleteRange = Boolean(
    isRetreatStayRangeComplete(range?.from, range?.to) || (checkIn && checkOut)
  );
  const isUnderMinStay = hasCompleteRange && nights > 0 && nights < minNights;
  const showPriceShimmer =
    quoteLoading && hasCompleteRange && !isUnderMinStay && availabilityStatus !== 'error';

  const canContinueToPayment =
    showAvailablePrice && !checkoutStep && !quoteLoading && !isUnderMinStay;

  const handleRetryAvailability = () => {
    loadAvailability(slug, { months: AVAILABILITY_WINDOW_MONTHS });
  };

  const handleScrollToQuotePanel = () => {
    scrollToQuotePanel(onClose);
  };

  const rootClassName = isSheet
    ? 'w-full max-w-2xl mx-auto px-4 py-5 md:py-6'
    : 'w-full max-w-md rounded-2xl border border-gray-200/80 bg-white shadow-lg p-5 md:p-6';

  const primaryButtonClass = isSheet
    ? 'w-full py-4 rounded-xl bg-[#81887A] text-white font-semibold text-base hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation'
    : 'w-full py-3.5 rounded-xl bg-[#81887A] text-white font-semibold text-sm hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed';

  const renderPriceRow = () => {
    if (showPriceShimmer) {
      return (
        <div
          className="h-9 w-44 bg-gray-200 rounded-lg animate-pulse"
          aria-hidden="true"
          role="presentation"
        />
      );
    }

    if (showAvailablePrice && quote?.totalPrice != null) {
      return (
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
      );
    }

    if (inventory?.fromPrice) {
      return (
        <div className="space-y-1">
          <p className="text-lg font-semibold text-gray-900 tabular-nums">
            {tv('retreat.hero.calendar.fromPrice', {
              nightly: formatEuroAmount(inventory.fromPrice.nightlyTotal)
            })}
          </p>
          <p className="text-sm text-gray-500">
            {tv('retreat.hero.calendar.fromPriceMinStay', {
              nights: inventory.fromPrice.nights ?? minNights
            })}
          </p>
        </div>
      );
    }

    return null;
  };

  const renderCalendarArea = () => {
    if (isCalendarLoading) {
      return (
        <CalendarSkeleton label={tv('retreat.hero.calendar.availabilityLoading')} />
      );
    }

    if (isCalendarError) {
      return (
        <div
          className={`${CALENDAR_MIN_HEIGHT} flex flex-col items-center justify-center text-center px-4`}
          role="alert"
        >
          <p className="text-sm text-gray-700 mb-4 max-w-sm">
            {tv('retreat.hero.calendar.availabilityError')}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
            <button
              type="button"
              onClick={handleRetryAvailability}
              className="flex-1 py-3 rounded-xl bg-[#81887A] text-white font-semibold text-sm hover:opacity-95 touch-manipulation"
            >
              {tv('retreat.hero.calendar.retryAvailability')}
            </button>
            <button
              type="button"
              onClick={handleScrollToQuotePanel}
              className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-900 font-semibold text-sm hover:bg-gray-50 touch-manipulation"
            >
              {tv('retreat.hero.calendar.useQuotePanel')}
            </button>
          </div>
        </div>
      );
    }

    return (
      <Suspense
        fallback={
          <CalendarSkeleton label={tv('retreat.hero.calendar.availabilityLoading')} />
        }
      >
        <DayPicker
          mode="range"
          selected={pickerSelected}
          onSelect={onCalendarSelect}
          numberOfMonths={1}
          pagedNavigation
          captionLayout="dropdown-buttons"
          locale={getDateFnsLocale(language)}
          fromDate={minStayDate}
          disabled={isDateDisabled}
          modifiers={calendarModifiers}
          modifiersClassNames={RETREAT_DAYPICKER_MODIFIERS}
          className="booking-modal-daypicker retreat-booking-daypicker w-full mx-auto"
          styles={{
            caption: { textAlign: 'left', fontFamily: 'Playfair Display' },
            months: { display: 'flex', flexDirection: 'column', gap: '1rem' }
          }}
        />
        {singleCheckoutHint && (
          <p className="text-xs text-gray-500 mt-2 max-w-md leading-relaxed">{singleCheckoutHint}</p>
        )}
      </Suspense>
    );
  };

  if (success) {
    return (
      <div className={rootClassName}>
        <div className="text-center py-4">
          <p className="text-xs uppercase tracking-[0.25em] text-[#81887A] mb-2">
            {tv('retreat.quote.confirmedEyebrow')}
          </p>
          <h3 className="font-serif text-2xl text-gray-900 mb-2">
            {tv('retreat.quote.confirmedTitle')}
          </h3>
          <p className="text-sm text-gray-600 mb-4">{tv('retreat.quote.confirmedBody')}</p>
          <p className="text-xs text-gray-500 tabular-nums">
            {tv('retreat.quote.reference', { id: success.locationBookingId })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={rootClassName}>
      {!hideHeader && (
        <div className={`flex items-start justify-between gap-3 ${isSheet ? 'mb-5' : 'mb-4'}`}>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500 mb-1">
              {tv('retreat.hero.calendar.eyebrow')}
            </p>
            <h2 className="font-serif text-xl md:text-2xl text-gray-900">
              {tv('retreat.hero.calendar.title')}
            </h2>
          </div>
          {isSheet && typeof onClose === 'function' && (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 touch-manipulation"
              aria-label={tv('retreat.hero.calendar.closeSheet')}
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      )}

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
            {tv('retreat.hero.calendar.datesLabel')}
          </p>
          <p className={`text-sm text-gray-700 mb-3 ${isSheet ? 'text-base' : ''}`}>
            {calendarDateSummary}
          </p>
          {renderCalendarArea()}
          {dateError && <p className="text-red-600 text-sm mt-2">{dateError}</p>}
        </div>

        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500 mb-2">
            {tv('retreat.hero.calendar.guestsLabel')}
          </p>
          <div className="flex gap-3">
            <CompactGuestStepper
              label={tb('guests.adults.label')}
              value={adults}
              min={1}
              onDecrease={() => updateGuests({ adults: Math.max(1, adults - 1) })}
              onIncrease={() => updateGuests({ adults: adults + 1 })}
              decreaseLabel={tb('guests.adults.label')}
              increaseLabel={tb('guests.adults.label')}
              isSheet={isSheet}
            />
            <CompactGuestStepper
              label={tb('guests.children.label')}
              value={children}
              min={0}
              onDecrease={() => updateGuests({ children: Math.max(0, children - 1) })}
              onIncrease={() => updateGuests({ children: children + 1 })}
              decreaseLabel={tb('guests.children.label')}
              increaseLabel={tb('guests.children.label')}
              isSheet={isSheet}
            />
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4">{renderPriceRow()}</div>

        {isUnderMinStay && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
            {tv('retreat.hero.calendar.minStayRequired', { count: minNights })}
          </p>
        )}

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
              {tv('retreat.quote.unavailableBuyout')}
            </p>
          </div>
        )}

        {canContinueToPayment && (
          <button
            type="button"
            data-booking-primary-cta="true"
            onClick={startCheckout}
            disabled={checkoutLoading}
            className={primaryButtonClass}
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
                <label htmlFor="hero-retreat-first-name" className="label-editorial">
                  {tb('confirm.firstName')}
                </label>
                <input
                  id="hero-retreat-first-name"
                  type="text"
                  value={formData.firstName}
                  onChange={(event) =>
                    setFormData((prev) => ({ ...prev, firstName: event.target.value }))
                  }
                  className="input-editorial"
                  autoComplete="given-name"
                />
              </div>
              <div>
                <label htmlFor="hero-retreat-last-name" className="label-editorial">
                  {tb('confirm.lastName')}
                </label>
                <input
                  id="hero-retreat-last-name"
                  type="text"
                  value={formData.lastName}
                  onChange={(event) =>
                    setFormData((prev) => ({ ...prev, lastName: event.target.value }))
                  }
                  className="input-editorial"
                  autoComplete="family-name"
                />
              </div>
              <div>
                <label htmlFor="hero-retreat-email" className="label-editorial">
                  {tb('confirm.email')}
                </label>
                <input
                  id="hero-retreat-email"
                  type="email"
                  value={formData.email}
                  onChange={(event) =>
                    setFormData((prev) => ({ ...prev, email: event.target.value }))
                  }
                  className="input-editorial"
                  autoComplete="email"
                />
              </div>
              <div>
                <label htmlFor="hero-retreat-phone" className="label-editorial">
                  {tb('confirm.phone')}
                </label>
                <input
                  id="hero-retreat-phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(event) =>
                    setFormData((prev) => ({ ...prev, phone: event.target.value }))
                  }
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
                isSheet={isSheet}
              />
            </Elements>
          </div>
        )}
      </div>
    </div>
  );
};

export default RetreatBookingCalendar;
