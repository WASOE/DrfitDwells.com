import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import '../i18n/ns/booking';
import { useBookingSearch } from '../context/BookingSearchContext';
import { useLanguage } from '../context/LanguageContext.jsx';
import GuestSelect from './GuestSelect';
import { localizePath } from '../utils/localizedRoutes';
import { startOfDay, isBefore, addDays } from 'date-fns';
import { formatDateOnlyLocal, parseDateOnlyLocal } from '../utils/dateOnly';
import { getMinSelectableStayDate } from '../utils/bookingMinStayDate';

const SearchBar = ({ initialData = {}, buttonTheme = 'default', variant = 'default' }) => {
  const navigate = useNavigate();
  const isGlass = variant === 'glass';
  const {
    checkIn,
    checkOut,
    adults,
    children,
    babies = 0,
    pets = 0,
    updateDates,
    updateGuests,
    openModal,
    guestPromoCode,
    setGuestPromoCode
  } = useBookingSearch();

  const [promoUiOpen, setPromoUiOpen] = useState(false);
  const [promoDraft, setPromoDraft] = useState('');
  useEffect(() => {
    setPromoDraft(guestPromoCode);
    if (guestPromoCode) setPromoUiOpen(true);
  }, [guestPromoCode]);

  const promoTriggerLabel = useMemo(() => 'Promo code', []);

  const [errors, setErrors] = useState({});
  const { t } = useTranslation('booking');
  const { language } = useLanguage();
  const [openCheckIn, setOpenCheckIn] = useState(false);
  const [openCheckOut, setOpenCheckOut] = useState(false);
  const [DatePickerComponent, setDatePickerComponent] = useState(null);
  const [pendingOpen, setPendingOpen] = useState(null); // 'checkIn' | 'checkOut' when calendar should open after load

  const formData = { checkIn, checkOut, adults, children };

  const parseDate = (value) => {
    if (!value) return null;
    return parseDateOnlyLocal(value);
  };

  useEffect(() => {
    if (!initialData) return;
    const incomingCheckIn = parseDate(initialData.checkIn);
    const incomingCheckOut = parseDate(initialData.checkOut);
    const incomingAdults = initialData.adults ? parseInt(initialData.adults, 10) : undefined;
    const incomingChildren = initialData.children ? parseInt(initialData.children, 10) : undefined;

    if (incomingCheckIn || incomingCheckOut) {
      updateDates(incomingCheckIn || checkIn, incomingCheckOut || checkOut);
    }

    if (incomingAdults !== undefined || incomingChildren !== undefined) {
      updateGuests({
        adults: incomingAdults !== undefined ? incomingAdults : adults,
        children: incomingChildren !== undefined ? incomingChildren : children
      });
    }
  }, [initialData?.checkIn, initialData?.checkOut, initialData?.adults, initialData?.children]);

  useEffect(() => {
    const data = initialData || {};
    if (!Object.prototype.hasOwnProperty.call(data, 'promoCode')) return;
    const raw = data.promoCode;
    const next = raw != null && String(raw).trim() ? String(raw).trim().toUpperCase() : '';
    setGuestPromoCode(next);
  }, [initialData, setGuestPromoCode]);

  // Close datepickers on scroll on mobile only. On desktop, closing on any scroll prevented selecting dates (calendar closed as soon as it opened or on tiny scroll).
  useEffect(() => {
    const handleScroll = () => {
      const isMobile = window.matchMedia('(max-width: 767px)').matches;
      if (!isMobile) return;
      setOpenCheckIn(false);
      setOpenCheckOut(false);
    };
    window.addEventListener('scroll', handleScroll, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', handleScroll, { capture: true });
  }, []);

  // Load react-datepicker and its CSS. Preload on desktop so the real input is there when user clicks (fixes calendar not opening on first click).
  const loadDatePicker = useCallback(async () => {
    if (DatePickerComponent) return;
    await import('react-datepicker/dist/react-datepicker.css');
    await import('../styles/react-datepicker-theme.css');
    const mod = await import('./date/DatePickerLazy.jsx');
    setDatePickerComponent(() => mod.default);
  }, [DatePickerComponent]);

  // On desktop, preload the datepicker immediately so "Select date" shows the real input and calendar opens on first click
  useEffect(() => {
    if (DatePickerComponent) return;
    const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;
    if (!isDesktop) return;
    const t = setTimeout(loadDatePicker, 0);
    return () => clearTimeout(t);
  }, [DatePickerComponent, loadDatePicker]);

  // When DatePicker has just loaded and user had clicked to open, open the calendar (react-datepicker often needs open to *transition* to true after mount)
  useEffect(() => {
    if (!DatePickerComponent || !pendingOpen) return;
    if (pendingOpen === 'checkIn') {
      setOpenCheckIn(false);
      const t = setTimeout(() => {
        setOpenCheckIn(true);
        setPendingOpen(null);
      }, 0);
      return () => clearTimeout(t);
    }
    if (pendingOpen === 'checkOut') {
      setOpenCheckOut(false);
      const t = setTimeout(() => {
        setOpenCheckOut(true);
        setPendingOpen(null);
      }, 0);
      return () => clearTimeout(t);
    }
  }, [DatePickerComponent, pendingOpen]);

  const handleDateChange = (field, date) => {
    const minStay = getMinSelectableStayDate();
    if (field === 'checkIn') {
      if (date && isBefore(startOfDay(date), minStay)) return;
      const nextCheckOut = checkOut && date && checkOut <= date ? null : checkOut;
      updateDates(date, nextCheckOut);
      setErrors(prev => ({ ...prev, checkIn: null, checkOut: null }));
    } else {
      if (date && isBefore(startOfDay(date), minStay)) return;
      if (date && checkIn && date <= checkIn) {
        setErrors(prev => ({ ...prev, checkOut: t('errors.checkOutAfterCheckIn') }));
        return;
      }
      updateDates(checkIn, date);
      setErrors(prev => ({ ...prev, checkOut: null }));
    }
  };


  const validateForm = () => {
    const newErrors = {};

    if (!checkIn) {
      newErrors.checkIn = t('errors.checkInRequired');
    } else if (isBefore(startOfDay(checkIn), getMinSelectableStayDate())) {
      newErrors.checkIn = t('errors.checkInPast');
    }

    if (!checkOut) {
      newErrors.checkOut = t('errors.checkOutRequired');
    } else if (checkIn && checkOut <= checkIn) {
      newErrors.checkOut = t('errors.checkOutAfterCheckIn');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    const searchParams = new URLSearchParams({
      checkIn: formatDateOnlyLocal(checkIn) || '',
      checkOut: formatDateOnlyLocal(checkOut) || '',
      adults: adults.toString(),
      children: children.toString(),
      babies: (babies || 0).toString(),
      pets: (pets || 0).toString()
    });
    const p = promoDraft.trim().toUpperCase();
    setGuestPromoCode(p);
    if (p) searchParams.set('promoCode', p);

    navigate(`${localizePath('/search', language)}?${searchParams.toString()}`);
  };

  const summaryDates = checkIn && checkOut
    ? `${checkIn.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} → ${checkOut.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : t('mobile.summaryTapToChoose');

  const totalGuests = adults + children;
  const guestSummary = t('guestSummary', { count: totalGuests });

  const minStayDate = getMinSelectableStayDate();
  const checkOutMinDate = formData.checkIn
    ? addDays(startOfDay(formData.checkIn), 1)
    : minStayDate;

  const checkInLabel = formData.checkIn
    ? formData.checkIn.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : t('fields.selectDate');

  const checkOutLabel = formData.checkOut
    ? formData.checkOut.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : t('fields.selectDate');

  // Unified field styling - all fields look identical
  const fieldContainerClass = 'flex flex-col';
  const fieldLabelClass = isGlass
    ? 'text-[9px] uppercase tracking-[0.3em] font-serif text-white/70 mb-1.5'
    : 'text-[9px] uppercase tracking-[0.3em] font-serif text-gray-500 mb-1.5';
  const fieldInputClass = isGlass
    ? 'w-full h-12 lg:h-14 bg-transparent text-sm lg:text-base font-serif text-white placeholder:text-white border-b border-white/40 focus:border-white focus:outline-none transition-colors duration-150 pb-1'
    : 'w-full h-12 lg:h-14 bg-transparent text-sm lg:text-base font-serif text-gray-900 border-b border-gray-300 focus:border-gray-900 focus:outline-none transition-colors duration-150 pb-1';
  const _fieldSelectClass = `${fieldInputClass} appearance-none cursor-pointer`;
  const dividerClass = isGlass ? 'hidden' : 'hidden md:block w-px h-12 lg:h-14 bg-gray-300 self-end mb-3';
  const errorTextClass = isGlass ? 'text-white/80 text-xs mt-1.5' : 'text-red-500 text-xs mt-1.5';

  return (
    <form onSubmit={handleSubmit} className="w-full" autoComplete="off">
      {/* Mobile View — dates/guests open the same BookingModal + DayPicker flow as the homepage */}
      <div className="md:hidden space-y-3">
        <button
          type="button"
          onClick={openModal}
          className="w-full text-left bg-[#2a2a2a] rounded-2xl p-4 text-white focus:outline-none focus:ring-2 focus:ring-[#F1ECE2]/40 active:scale-[0.99] transition-transform touch-manipulation"
          aria-label={t('mobile.openDatesModalAria')}
        >
          <p className="text-[9px] uppercase tracking-[0.3em] text-white/60">{t('mobile.datesLabel')}</p>
          <p className="font-serif text-base mt-2">{summaryDates}</p>
        </button>
        <button
          type="button"
          onClick={openModal}
          className="w-full text-left bg-[#2a2a2a] rounded-2xl p-4 text-white focus:outline-none focus:ring-2 focus:ring-[#F1ECE2]/40 active:scale-[0.99] transition-transform touch-manipulation"
          aria-label={t('mobile.openGuestsModalAria')}
        >
          <p className="text-[9px] uppercase tracking-[0.3em] text-white/60">{t('mobile.guestsLabel')}</p>
          <p className="font-serif text-base mt-2">{guestSummary}</p>
        </button>
        <button
          type="button"
          onClick={openModal}
          className="w-full bg-[#F1ECE2] text-stone-900 py-3 rounded-2xl uppercase tracking-[0.2em] text-xs font-bold focus:outline-none focus:ring-2 focus:ring-[#F1ECE2]/50 active:scale-[0.98] transition-all duration-150 touch-manipulation"
        >
          {t('mobile.planYourStay')}
        </button>
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setPromoUiOpen((o) => !o)}
            className="text-xs text-white/70 underline underline-offset-2"
          >
            {promoTriggerLabel}
          </button>
          {promoUiOpen && (
            <input
              type="text"
              value={promoDraft}
              onChange={(e) => setPromoDraft(e.target.value)}
              placeholder="Optional"
              autoComplete="off"
              className="mt-2 w-full bg-white/10 border border-white/25 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/50"
            />
          )}
        </div>
      </div>

      {/* Desktop View - Redesigned with consistent field structure */}
      <div className={`hidden md:flex flex-row items-end gap-6 w-full ${isGlass ? 'text-white' : ''}`}>
        {/* Check-in Date */}
        <div className={fieldContainerClass} style={{ width: '180px' }}>
          <label htmlFor="checkIn-desktop" className={fieldLabelClass}>
            {t('fields.checkIn')}
          </label>
          {DatePickerComponent ? (
            <DatePickerComponent
              id="checkIn-desktop"
              name="dw-search-check-in"
              selected={formData.checkIn}
              onChange={(date) => handleDateChange('checkIn', date)}
              open={openCheckIn}
              onCalendarOpen={() => setOpenCheckIn(true)}
              onCalendarClose={() => setOpenCheckIn(false)}
              onClickOutside={() => setOpenCheckIn(false)}
              selectsStart
              startDate={formData.checkIn}
              endDate={formData.checkOut}
              minDate={minStayDate}
              filterDate={(d) => !isBefore(startOfDay(d), minStayDate)}
              placeholderText={t('fields.selectDate')}
              className={`${fieldInputClass} ${errors.checkIn ? (isGlass ? 'border-white' : 'border-red-400') : ''}`}
              calendarClassName="dd-datepicker"
              popperClassName="dd-datepicker-popper"
              dateFormat="MMM dd"
              portalId="datepicker-portal"
            />
          ) : (
            <button
              type="button"
              id="checkIn-desktop"
              className={`${fieldInputClass} ${errors.checkIn ? (isGlass ? 'border-white' : 'border-red-400') : ''} text-left`}
              onClick={() => {
                loadDatePicker();
                setPendingOpen('checkIn');
                setOpenCheckIn(true);
              }}
              onFocus={() => {
                loadDatePicker();
                setPendingOpen('checkIn');
                setOpenCheckIn(true);
              }}
            >
              {checkInLabel}
            </button>
          )}
          {errors.checkIn && (
            <p className={errorTextClass}>{errors.checkIn}</p>
          )}
        </div>

        <div className={dividerClass}></div>

        {/* Check-out Date */}
        <div className={fieldContainerClass} style={{ width: '180px' }}>
          <label htmlFor="checkOut-desktop" className={fieldLabelClass}>
            {t('fields.checkOut')}
          </label>
          {DatePickerComponent ? (
            <DatePickerComponent
              id="checkOut-desktop"
              name="dw-search-check-out"
              selected={formData.checkOut}
              onChange={(date) => handleDateChange('checkOut', date)}
              open={openCheckOut}
              onCalendarOpen={() => setOpenCheckOut(true)}
              onCalendarClose={() => setOpenCheckOut(false)}
              onClickOutside={() => setOpenCheckOut(false)}
              selectsEnd
              startDate={formData.checkIn}
              endDate={formData.checkOut}
              minDate={checkOutMinDate}
              filterDate={(d) => !isBefore(startOfDay(d), checkOutMinDate)}
              placeholderText={t('fields.selectDate')}
              className={`${fieldInputClass} ${errors.checkOut ? (isGlass ? 'border-white' : 'border-red-400') : ''}`}
              calendarClassName="dd-datepicker"
              popperClassName="dd-datepicker-popper"
              dateFormat="MMM dd"
              portalId="datepicker-portal"
            />
          ) : (
            <button
              type="button"
              id="checkOut-desktop"
              className={`${fieldInputClass} ${errors.checkOut ? (isGlass ? 'border-white' : 'border-red-400') : ''} text-left`}
              onClick={() => {
                loadDatePicker();
                setPendingOpen('checkOut');
                setOpenCheckOut(true);
              }}
              onFocus={() => {
                loadDatePicker();
                setPendingOpen('checkOut');
                setOpenCheckOut(true);
              }}
            >
              {checkOutLabel}
            </button>
          )}
          {errors.checkOut && (
            <p className={errorTextClass}>{errors.checkOut}</p>
          )}
        </div>

        <div className={dividerClass}></div>

        {/* Guests */}
        <div style={{ width: '180px' }}>
          <GuestSelect
            label={t('fields.guests')}
            isGlass={isGlass}
          />
        </div>

        <div className={`flex flex-col justify-end min-w-[100px] ${isGlass ? 'text-white' : ''}`}>
          <button
            type="button"
            onClick={() => setPromoUiOpen((o) => !o)}
            className={`text-left text-[9px] uppercase tracking-[0.3em] font-serif mb-1.5 ${
              isGlass ? 'text-white/70 hover:text-white' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {promoTriggerLabel}
          </button>
          {promoUiOpen && (
            <input
              type="text"
              value={promoDraft}
              onChange={(e) => setPromoDraft(e.target.value)}
              placeholder="Optional"
              autoComplete="off"
              className={fieldInputClass}
            />
          )}
        </div>

        {/* Spacer so button aligns to right edge and no gap remains */}
        <div className="flex-1 min-w-0" aria-hidden="true" />

        {/* Search Button */}
        <div className="flex-shrink-0">
          <button
            type="submit"
            className={`h-12 lg:h-14 px-8 lg:px-12 rounded-full text-sm uppercase tracking-[0.3em] font-semibold focus:outline-none focus:ring-2 active:scale-95 transition-all duration-150 inline-flex items-center justify-center whitespace-nowrap touch-manipulation shadow-lg hover:shadow-xl ${
              buttonTheme === 'hero'
                ? 'bg-black text-white hover:bg-stone-800 focus:ring-black/40'
                : 'bg-black text-white hover:bg-stone-800 focus:ring-black/40'
            }`}
          >
            {t('actions.search')}
          </button>
        </div>
      </div>
    </form>
  );
};

export { SearchBar };
export default SearchBar;
