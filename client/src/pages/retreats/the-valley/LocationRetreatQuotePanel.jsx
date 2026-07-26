import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { Minus, Plus } from 'lucide-react';
import GuestSelect from '../../../components/GuestSelect';
import { StayLodgingPriceBlock } from '../../../components/booking/StayLodgingPriceBlock';
import PriceDetailsModal from '../../../components/booking/PriceDetailsModal';
import LocationPaymentForm from './LocationPaymentForm';
import useLocationRetreatBooking from '../../../hooks/useLocationRetreatBooking';
import { formatDateOnlyLocal } from '../../../utils/dateOnly';
import '../../../i18n/ns/booking';
import '../../../i18n/ns/valley';

const stripePk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise = stripePk ? loadStripe(stripePk) : null;

function quoteMatchesContextDates(quote, checkIn, checkOut) {
  if (!quote?.checkIn || !quote?.checkOut || !checkIn || !checkOut) return false;
  return (
    quote.checkIn === formatDateOnlyLocal(checkIn) &&
    quote.checkOut === formatDateOnlyLocal(checkOut)
  );
}

const LocationRetreatQuotePanel = ({ onQuoteChange, panelRef }) => {
  const { t: tb } = useTranslation('booking');
  const { t: tv } = useTranslation('valley');
  const [showPriceDetails, setShowPriceDetails] = useState(false);
  const [roomAllocationOpen, setRoomAllocationOpen] = useState(false);

  const {
    checkIn,
    checkOut,
    nights,
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
    guestFormValid
  } = useLocationRetreatBooking({ onQuoteChange });

  const quoteIsCurrent = useMemo(
    () => quoteMatchesContextDates(quote, checkIn, checkOut),
    [quote, checkIn, checkOut]
  );

  const displayQuote = quoteIsCurrent ? quote : null;
  const showStaleQuoteHint = Boolean(quote && !quoteIsCurrent);
  const showPanelUnavailable = Boolean(displayQuote && displayQuote.available === false);
  const showPanelAvailablePrice = Boolean(displayQuote && displayQuote.available === true);

  useEffect(() => {
    if (quote && !quoteIsCurrent) {
      onQuoteChange?.(null);
    }
  }, [quote, quoteIsCurrent, onQuoteChange]);

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
              <p className="text-sm md:text-base text-gray-700">{dateSummary}</p>
              <p className="text-xs text-gray-500 mt-2 max-w-prose">{tv('retreat.quote.panelDateHint')}</p>
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

            {showStaleQuoteHint && (
              <p className="text-sm text-gray-600" role="status">
                {tv('retreat.quote.staleQuoteHint')}
              </p>
            )}

            {quoteError && (
              <p className="text-sm text-red-600" role="alert">
                {quoteError}
              </p>
            )}

            {showPanelUnavailable && (
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

            {showPanelAvailablePrice && (
              <div className="border-t border-gray-100 pt-4">
                <StayLodgingPriceBlock
                  finalAmount={displayQuote.totalPrice}
                  priceClassName="text-2xl font-semibold text-gray-900"
                  priceSuffix={
                    <span className="text-base font-normal text-gray-500 ml-1">
                      {tb('details.priceTotalSuffix')}
                    </span>
                  }
                  footnote={
                    <p className="text-sm text-gray-500 mt-0.5">
                      {tb('modal.nights', { count: displayQuote.nights || nights })}
                      {displayQuote.totalSleeps
                        ? ` · ${tv('retreat.quote.sleepsTotal', { count: displayQuote.totalSleeps })}`
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

            {showPanelAvailablePrice && !checkoutStep && (
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

                <div className="space-y-3 pt-1">
                  <p className="text-xs text-gray-500">
                    Optional contact preferences. Declining does not block booking.
                  </p>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!formData.quoteDeliveryRequested}
                      onChange={(e) =>
                        setFormData((f) => ({ ...f, quoteDeliveryRequested: e.target.checked }))
                      }
                      className="mt-0.5 w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                    />
                    <span className="text-xs text-gray-700 leading-relaxed">
                      Email me this quote. This only covers sending the quote I requested — not
                      marketing or booking reminders.
                    </span>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!formData.bookingReminderConsent}
                      onChange={(e) =>
                        setFormData((f) => ({ ...f, bookingReminderConsent: e.target.checked }))
                      }
                      className="mt-0.5 w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                    />
                    <span className="text-xs text-gray-700 leading-relaxed">
                      If I do not finish booking, you may email me a limited reminder about this stay.
                      This is not marketing consent.
                    </span>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!formData.marketingConsent}
                      onChange={(e) =>
                        setFormData((f) => ({ ...f, marketingConsent: e.target.checked }))
                      }
                      className="mt-0.5 w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                    />
                    <span className="text-xs text-gray-700 leading-relaxed">
                      Send me occasional offers and news from Drift & Dwells. I can unsubscribe at any
                      time.
                    </span>
                  </label>
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

            {showPanelAvailablePrice && (
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
                      <div
                        key={`${row.accommodationName}-${index}`}
                        className="rounded-lg border border-gray-100 p-3 space-y-2"
                      >
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
                                          plannedGuests: Math.max(0, (r.plannedGuests ?? 0) - 1)
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
            nights={displayQuote?.nights}
            totalPrice={displayQuote?.totalPrice}
            serverSubtotal={displayQuote?.lodgingSubtotal ?? displayQuote?.totalPrice}
            extras={quoteIsCurrent ? priceExtras : []}
          />
        </>
      )}
    </div>
  );
};

export default LocationRetreatQuotePanel;
