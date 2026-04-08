import { useEffect, lazy, Suspense, useMemo, useState } from 'react';
import '../i18n/ns/booking';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { startOfDay, isBefore } from 'date-fns';
import '../styles/daypicker-theme.css';
import { getMinSelectableStayDate } from '../utils/bookingMinStayDate';

const DayPicker = lazy(() =>
  import('react-day-picker').then((m) => {
    import('react-day-picker/dist/style.css');
    return { default: m.DayPicker };
  })
);
import { X, Minus, Plus } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { localizePath } from '../utils/localizedRoutes';
import { useSiteLanguage } from '../hooks/useSiteLanguage';
import { useBookingSearch } from '../context/BookingSearchContext';
import { formatDateOnlyLocal } from '../utils/dateOnly';
import { formatStayRangeSummary, getDateFnsLocale } from '../utils/localeDates';

function bookingModalDevLog(...args) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.info('[booking-modal]', ...args);
  }
}

const BookingModal = () => {
  const { t } = useTranslation('booking');
  const { language } = useSiteLanguage();
  const navigate = useNavigate();
  const { search: locationSearch } = useLocation();
  const {
    checkIn,
    checkOut,
    adults,
    children,
    nights,
    updateDates,
    updateGuests,
    resetSearch,
    isModalOpen,
    closeModal,
    guestPromoCode,
    setGuestPromoCode
  } = useBookingSearch();

  const [promoUiOpen, setPromoUiOpen] = useState(false);
  const [promoDraft, setPromoDraft] = useState('');
  useEffect(() => {
    setPromoDraft(guestPromoCode);
    if (guestPromoCode) setPromoUiOpen(true);
  }, [guestPromoCode]);

  const [range, setRange] = useState({ from: checkIn ? startOfDay(checkIn) : null, to: checkOut ? startOfDay(checkOut) : null });
  const [error, setError] = useState('');
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setRange({
      from: checkIn ? startOfDay(checkIn) : null,
      to: checkOut ? startOfDay(checkOut) : null
    });
  }, [checkIn, checkOut]);

  useEffect(() => {
    if (!isModalOpen) return;
    const today = getMinSelectableStayDate();
    const from = checkIn ? startOfDay(checkIn) : null;
    if (from && isBefore(from, today)) {
      setRange({ from: null, to: null });
      updateDates(null, null);
      setError(t('modal.pastDatesUnavailable'));
    }
  }, [isModalOpen, checkIn, checkOut, updateDates, t]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!isModalOpen) return undefined;
    bookingModalDevLog('BookingModal mounted — full-screen layer visible');
    return () => {
      bookingModalDevLog('BookingModal unmounted');
    };
  }, [isModalOpen]);

  useEffect(() => {
    if (!isModalOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isModalOpen, closeModal]);

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
      setError('');
    }
  };

  const adjustGuests = (field, delta) => {
    if (field === 'adults') {
      updateGuests({ adults: adults + delta });
    } else {
      updateGuests({ children: children + delta });
    }
  };

  const handleClear = () => {
    setRange({ from: null, to: null });
    resetSearch();
    setError('');
  };

  const handleSearch = () => {
    if (!checkIn || !checkOut) {
      setError(t('errors.datesRequired'));
      return;
    }
    const today = getMinSelectableStayDate();
    if (isBefore(startOfDay(checkIn), today)) {
      setError(t('errors.checkInPast'));
      return;
    }

    const searchParams = new URLSearchParams({
      checkIn: formatDateOnlyLocal(checkIn),
      checkOut: formatDateOnlyLocal(checkOut),
      adults: adults.toString(),
      children: children.toString()
    });
    const p = promoDraft.trim().toUpperCase();
    setGuestPromoCode(p);
    if (p) searchParams.set('promoCode', p);

    const preserved = new URLSearchParams(locationSearch);
    for (const key of ['returnTo', 'draft']) {
      const v = preserved.get(key);
      if (v) searchParams.set(key, v);
    }

    closeModal();
    const searchPath = localizePath('/search', language);
    navigate(`${searchPath}?${searchParams.toString()}`);
  };

  const dateSummary = useMemo(() => {
    if (checkIn && checkOut) {
      return formatStayRangeSummary(checkIn, checkOut, language);
    }
    return t('modal.selectYourStay');
  }, [checkIn, checkOut, language, t]);

  const minStayDate = getMinSelectableStayDate();

  /** Plain DOM root (no Framer on this layer) — portaled to document.body via BookingModalLazy. */
  const modalRootStyle = {
    position: 'fixed',
    inset: 0,
    width: '100%',
    height: '100%',
    zIndex: 9999,
    pointerEvents: 'auto',
    paddingLeft: 'env(safe-area-inset-left, 0px)',
    paddingRight: 'env(safe-area-inset-right, 0px)'
  };

  return (
    <AnimatePresence
      onExitComplete={() => {
        bookingModalDevLog('AnimatePresence exit complete — layers removed');
      }}
    >
      {isModalOpen && (
        <>
          {/* Desktop backdrop — plain div (no motion) */}
          <div
            key="booking-modal-backdrop"
            className="fixed inset-0 z-[9998] hidden bg-black/50 backdrop-blur-sm md:block"
            onClick={closeModal}
            role="presentation"
            aria-hidden
          />

          {/* Full-screen host: fixed to viewport; not a motion component */}
          <div
            key="booking-modal-root"
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-modal-title"
            className="flex flex-col bg-[#F7F4EE] md:flex-row md:items-center md:justify-center md:bg-transparent md:p-8"
            style={modalRootStyle}
          >
            {/* Inner panel only: motion (slide on mobile, scale on desktop) */}
            <motion.div
              key="booking-modal-panel"
              className="flex min-h-0 w-full flex-1 flex-col bg-white shadow-none md:h-auto md:max-h-[calc(100vh-4rem)] md:max-w-[980px] lg:max-w-[1040px] md:w-full md:flex-none md:overflow-hidden md:rounded-[28px] md:shadow-2xl"
              initial={isMobile ? { y: '100%' } : { scale: 0.96, opacity: 0 }}
              animate={isMobile ? { y: 0, opacity: 1 } : { scale: 1, opacity: 1 }}
              exit={isMobile ? { y: '100%' } : { scale: 0.96, opacity: 0 }}
              transition={
                isMobile
                  ? { type: 'spring', damping: 28, stiffness: 220 }
                  : { type: 'spring', damping: 30, stiffness: 400 }
              }
            >
              {/* Header */}
              <header
                className="flex min-h-16 shrink-0 items-center justify-between border-b border-stone-200/80 bg-white px-6 md:min-h-[76px] md:px-8 lg:px-10"
                style={{
                  paddingTop: 'max(0px, env(safe-area-inset-top, 0px))'
                }}
              >
                <button
                  type="button"
                  onClick={closeModal}
                  className="w-10 h-10 rounded-full border border-stone-200 flex items-center justify-center text-stone-700 hover:bg-stone-50 transition-colors"
                  aria-label={t('modal.closeAria')}
                >
                  <X className="w-5 h-5" />
                </button>
                <h2
                  id="booking-modal-title"
                  className="font-['Playfair_Display'] text-lg md:text-xl text-stone-900"
                >
                  {t('mobile.planYourStay')}
                </h2>
                <button
                  type="button"
                  onClick={handleClear}
                  className="text-xs uppercase tracking-[0.3em] text-stone-500 hover:text-stone-900 transition-colors"
                >
                  {t('modal.clear')}
                </button>
              </header>

              {/* Content — min-h-0 so this region shrinks inside the flex column; without it,
                  overflow-y-auto never clips and the footer can sit on top of the last controls (e.g. Promo code). */}
              <div className="min-h-0 flex-1 overflow-y-auto p-6 md:flex-none md:overflow-visible md:px-8 md:pt-8 md:pb-7 lg:px-10">
                <div className="mx-auto w-full pb-4 md:pb-0">
                  <div className="flex flex-col gap-10 md:grid md:grid-cols-[minmax(0,1fr)_280px] lg:grid-cols-[minmax(0,1fr)_300px] md:gap-8 lg:gap-10 md:items-start">
                  {/* Dates Section */}
                  <section className="min-w-0">
                    <div className="mb-5 md:mb-6">
                      <p className="text-xs uppercase tracking-[0.4em] text-stone-500 mb-3">
                        {t('mobile.datesLabel')}
                      </p>
                      <h3 className="font-['Playfair_Display'] text-2xl md:text-3xl text-stone-900 mb-2">
                        {t('modal.when')}
                      </h3>
                      <p className="text-sm md:text-base text-stone-600">{dateSummary}</p>
                    </div>

                    <div className="mt-6 md:mt-7">
                      <Suspense fallback={<div className="h-64 flex items-center justify-center text-gray-400">{t('modal.loadingCalendar')}</div>}>
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
                        modifiersClassNames={{
                          today: 'text-stone-900 font-semibold'
                        }}
                        className="booking-modal-daypicker w-full"
                        styles={{
                          caption: { textAlign: 'left', fontFamily: 'Playfair Display' },
                          months: {
                            display: 'flex',
                            flexDirection: isMobile ? 'column' : 'row',
                            flexWrap: 'nowrap',
                            alignItems: 'flex-start',
                            justifyContent: 'space-between',
                            gap: isMobile ? '1.5rem' : '2.5rem'
                          }
                        }}
                      />
                      </Suspense>
                      {error && (
                        <p className="text-red-500 text-sm mt-4">{error}</p>
                      )}
                    </div>
                  </section>

                  {/* Guests Section */}
                  <section className="min-w-0 md:pt-1">
                    <div className="mb-5 md:mb-6">
                      <p className="text-xs uppercase tracking-[0.4em] text-stone-500 mb-3">
                        {t('fields.guests')}
                      </p>
                      <h3 className="font-['Playfair_Display'] text-2xl md:text-3xl text-stone-900">
                        {t('modal.who')}
                      </h3>
                    </div>

                    <div className="mt-6 md:mt-7 space-y-3 md:space-y-4">
                      {[
                        {
                          label: t('guests.adults.label'),
                          description: t('guests.adults.description'),
                          field: 'adults',
                          value: adults,
                          min: 1
                        },
                        {
                          label: t('guests.children.label'),
                          description: t('guests.children.description'),
                          field: 'children',
                          value: children,
                          min: 0
                        }
                      ].map(({ label, description, field, value, min }) => (
                        <div key={field} className="flex items-center justify-between bg-stone-50/80 rounded-2xl border border-stone-200 px-5 py-4 hover:border-stone-300 transition-colors">
                          <div>
                            <p className="text-base font-semibold text-stone-900">{label}</p>
                            <p className="text-xs md:text-sm text-stone-500">{description}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => adjustGuests(field, -1)}
                              disabled={value <= min}
                              className="w-9 h-9 rounded-full border border-stone-300 flex items-center justify-center text-stone-700 hover:border-stone-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                              <Minus className="w-5 h-5" />
                            </button>
                            <span className="w-6 text-center text-base font-semibold text-stone-900">{value}</span>
                            <button
                              type="button"
                              onClick={() => adjustGuests(field, 1)}
                              className="w-9 h-9 rounded-full border border-stone-900 bg-stone-900 text-white flex items-center justify-center hover:bg-stone-800 transition-colors"
                            >
                              <Plus className="w-5 h-5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="mt-8 border-t border-stone-200 pt-6 pb-2">
                    <button
                      type="button"
                      onClick={() => setPromoUiOpen((o) => !o)}
                      className="touch-manipulation text-left text-sm text-stone-600 underline underline-offset-2 py-2 -my-2 min-h-[44px] inline-flex items-center"
                    >
                      {t('fields.promoCode')}
                    </button>
                    {promoUiOpen && (
                      <input
                        type="text"
                        value={promoDraft}
                        onChange={(e) => setPromoDraft(e.target.value)}
                        placeholder={t('fields.optional')}
                        autoComplete="off"
                        className="mt-3 w-full border-b border-stone-300 bg-transparent py-2 text-base text-stone-900 outline-none focus:border-stone-600 placeholder:text-stone-400"
                      />
                    )}
                  </section>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <footer
                className="flex shrink-0 items-center justify-between border-t border-stone-200/80 bg-white px-6 py-5 md:px-8 md:py-5 lg:px-10"
                style={{
                  paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom, 0px))'
                }}
              >
                <div>
                  <p className="text-xs md:text-sm text-stone-500 uppercase tracking-[0.3em]">
                    {nights ? t('modal.nights', { count: nights }) : t('modal.footerSelectDates')}
                  </p>
                  <p className="text-base md:text-lg text-stone-900 font-serif mt-1">
                    {t('guestSummary', { count: adults + children })}
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="booking-modal-submit-search"
                  onClick={handleSearch}
                  disabled={!checkIn || !checkOut}
                  className={`h-12 md:h-14 px-8 md:px-12 rounded-full bg-black text-white font-semibold text-sm uppercase tracking-[0.3em] hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all ${
                    !checkIn || !checkOut ? '' : 'shadow-lg hover:shadow-xl'
                  }`}
                >
                  {t('actions.search')}
                </button>
              </footer>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};

export default BookingModal;






