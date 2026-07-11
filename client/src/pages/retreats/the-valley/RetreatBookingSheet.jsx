import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../../../i18n/ns/valley';

const RetreatBookingCalendar = lazy(() => import('./RetreatBookingCalendar'));

const BODY_LOCK_CLASS = 'retreat-booking-sheet-open';

function CalendarSheetFallback() {
  return (
    <div className="px-4 pb-6 animate-pulse space-y-4" aria-hidden="true">
      <div className="h-4 bg-gray-200 rounded w-2/5" />
      <div className="min-h-[320px] grid grid-cols-7 gap-2">
        {Array.from({ length: 35 }, (_, index) => (
          <div key={index} className="h-9 bg-gray-100 rounded-md" />
        ))}
      </div>
    </div>
  );
}

/**
 * Mobile bottom sheet for whole-Valley buyout booking (Phase 5).
 * Stays mounted once opened so hook state persists across close/reopen.
 */
const RetreatBookingSheet = ({ open, onClose, inventory, triggerRef }) => {
  const { t: tv } = useTranslation('valley');
  const closeBtnRef = useRef(null);
  const prevOpenRef = useRef(false);
  const [checkoutStepActive, setCheckoutStepActive] = useState(false);

  const title = tv('retreat.hero.calendar.title');
  const closeLabel = tv('retreat.hero.calendar.closeSheet');

  const requestClose = useCallback(
    (options = {}) => {
      const { force = false } = options;
      if (!force && checkoutStepActive) return;
      onClose();
    },
    [checkoutStepActive, onClose]
  );

  useEffect(() => {
    if (!open) {
      document.body.classList.remove(BODY_LOCK_CLASS);
      if (prevOpenRef.current && triggerRef?.current) {
        triggerRef.current.focus();
      }
      prevOpenRef.current = false;
      return undefined;
    }

    prevOpenRef.current = true;
    document.body.classList.add(BODY_LOCK_CLASS);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      requestClose();
    };

    document.addEventListener('keydown', onKeyDown);
    closeBtnRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      document.body.classList.remove(BODY_LOCK_CLASS);
    };
  }, [open, requestClose, triggerRef]);

  useEffect(
    () => () => {
      document.body.style.overflow = '';
      document.body.classList.remove(BODY_LOCK_CLASS);
    },
    []
  );

  return (
    <div
      className={`retreat-booking-sheet fixed inset-0 z-[110] lg:hidden ${
        open ? '' : 'invisible pointer-events-none'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      aria-hidden={!open}
    >
      {open ? (
        <button
          type="button"
          aria-label={closeLabel}
          onClick={() => requestClose()}
          className="retreat-booking-sheet-backdrop absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        />
      ) : null}

      <div className="retreat-booking-sheet-panel absolute inset-x-0 bottom-0 rounded-t-2xl bg-white shadow-[0_-8px_30px_rgba(0,0,0,0.18)] max-h-[90vh] overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="retreat-booking-sheet-header sticky top-0 z-10 flex items-center justify-between gap-3 bg-white/95 backdrop-blur-md px-4 pt-4 pb-3 border-b border-gray-200/80">
          <h2 className="font-serif text-lg text-gray-900 pr-2">{title}</h2>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={() => requestClose({ force: true })}
            className="shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A] touch-manipulation"
            aria-label={closeLabel}
          >
            <span className="text-2xl leading-none" aria-hidden="true">
              ×
            </span>
          </button>
        </div>

        <div className="retreat-booking-sheet-calendar">
          <Suspense fallback={<CalendarSheetFallback />}>
            <RetreatBookingCalendar
              variant="sheet"
              slug="the-valley"
              inventory={inventory}
              hideHeader
              onCheckoutStepChange={setCheckoutStepActive}
              onClose={() => requestClose({ force: true })}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
};

export default RetreatBookingSheet;
