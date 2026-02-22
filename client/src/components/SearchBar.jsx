import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { useBookingSearch } from '../context/BookingSearchContext';

const SearchBar = ({ initialData = {}, buttonTheme = 'default', variant = 'default' }) => {
  const navigate = useNavigate();
  const isGlass = variant === 'glass';
  const {
    checkIn,
    checkOut,
    adults,
    children,
    updateDates,
    updateGuests,
    openModal
  } = useBookingSearch();

  const [errors, setErrors] = useState({});

  const formData = { checkIn, checkOut, adults, children };

  const parseDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData?.checkIn, initialData?.checkOut, initialData?.adults, initialData?.children]);

  const handleDateChange = (field, date) => {
    if (field === 'checkIn') {
      const nextCheckOut = checkOut && date && checkOut <= date ? null : checkOut;
      updateDates(date, nextCheckOut);
      setErrors(prev => ({ ...prev, checkIn: null, checkOut: null }));
    } else {
      if (date && checkIn && date <= checkIn) {
        setErrors(prev => ({ ...prev, checkOut: 'Check-out date must be after check-in date' }));
        return;
      }
      updateDates(checkIn, date);
      setErrors(prev => ({ ...prev, checkOut: null }));
    }
  };

  const handleGuestChange = (field, value) => {
    updateGuests({ [field]: value });
    setErrors(prev => ({ ...prev, [field]: null }));
  };

  const validateForm = () => {
    const newErrors = {};

    if (!checkIn) {
      newErrors.checkIn = 'Check-in date is required';
    } else if (checkIn < new Date()) {
      newErrors.checkIn = 'Check-in date cannot be in the past';
    }

    if (!checkOut) {
      newErrors.checkOut = 'Check-out date is required';
    } else if (checkIn && checkOut <= checkIn) {
      newErrors.checkOut = 'Check-out date must be after check-in date';
    }

    if (adults < 1) {
      newErrors.adults = 'At least 1 adult is required';
    }

    if (children < 0) {
      newErrors.children = 'Children count cannot be negative';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    const searchParams = new URLSearchParams({
      checkIn: checkIn?.toISOString().split('T')[0] || '',
      checkOut: checkOut?.toISOString().split('T')[0] || '',
      adults: adults.toString(),
      children: children.toString()
    });

    navigate(`/search?${searchParams.toString()}`);
  };

  const summaryDates = checkIn && checkOut
    ? `${checkIn.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} → ${checkOut.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : 'Tap to choose dates';

  const guestSummary = `${adults + children} guest${adults + children === 1 ? '' : 's'}`;

  const baseInputClassDesktop = isGlass
    ? 'w-full h-12 lg:h-14 bg-white/15 text-sm lg:text-base text-white placeholder:text-white/70 border border-white/25 rounded-full px-4 focus:border-white/60 focus:outline-none focus:ring-2 focus:ring-white/20 transition-colors duration-150'
    : 'w-full h-12 sm:h-14 bg-transparent text-base sm:text-sm placeholder:text-gray-500 text-gray-900 border-b border-gray-300 focus:border-b focus:border-[#81887A] focus:outline-none transition-colors duration-150';

  const selectClassDesktop = `${baseInputClassDesktop} appearance-none pr-8 ${isGlass ? 'text-white' : 'text-gray-900'}`;
  const dividerClass = isGlass ? 'hidden' : 'hidden md:block w-px h-8 bg-gray-300';
  const errorTextClass = isGlass ? 'text-white text-xs mt-1' : 'text-red-500 text-xs mt-1';

  return (
    <form onSubmit={handleSubmit}>
      <div className="md:hidden space-y-3">
        <div className="bg-[#2a2a2a] rounded-2xl p-4 text-white">
          <p className="text-[9px] uppercase tracking-[0.3em] text-white/60">Dates</p>
          <p className="font-['Montserrat'] text-base mt-2">{summaryDates}</p>
        </div>
        <div className="bg-[#2a2a2a] rounded-2xl p-4 text-white">
          <p className="text-[9px] uppercase tracking-[0.3em] text-white/60">Guests</p>
          <p className="font-['Montserrat'] text-base mt-2">{guestSummary}</p>
        </div>
        <button
          type="button"
          onClick={openModal}
          className="w-full bg-[#F1ECE2] text-stone-900 py-3 rounded-2xl uppercase tracking-[0.2em] text-xs font-bold focus:outline-none focus:ring-2 focus:ring-[#F1ECE2]/50 active:scale-[0.98] transition-all duration-150 touch-manipulation"
        >
          Plan your stay
        </button>
      </div>

      <div className={`hidden md:flex flex-row gap-5 items-end ${isGlass ? 'text-white' : ''}`}>
        <div className="w-[232px]">
          <label htmlFor="checkIn-desktop" className="sr-only">Check-in date</label>
          <DatePicker
            id="checkIn-desktop"
            selected={formData.checkIn}
            onChange={(date) => handleDateChange('checkIn', date)}
            selectsStart
            startDate={formData.checkIn}
            endDate={formData.checkOut}
            minDate={new Date()}
            placeholderText={isGlass ? 'Check in' : 'Select date'}
            className={`${baseInputClassDesktop} ${errors.checkIn ? (isGlass ? 'border-white' : 'border-red-400') : ''}`}
            dateFormat="MM/dd/yyyy"
          />
          {errors.checkIn && (
            <p className={errorTextClass}>{errors.checkIn}</p>
          )}
        </div>

        <div className={dividerClass}></div>

        <div className="w-[232px]">
          <label htmlFor="checkOut-desktop" className="sr-only">Check-out date</label>
          <DatePicker
            id="checkOut-desktop"
            selected={formData.checkOut}
            onChange={(date) => handleDateChange('checkOut', date)}
            selectsEnd
            startDate={formData.checkIn}
            endDate={formData.checkOut}
            minDate={formData.checkIn || new Date()}
            placeholderText={isGlass ? 'Check out' : 'Select date'}
            className={`${baseInputClassDesktop} ${errors.checkOut ? (isGlass ? 'border-white' : 'border-red-400') : ''}`}
            dateFormat="MM/dd/yyyy"
          />
          {errors.checkOut && (
            <p className={errorTextClass}>{errors.checkOut}</p>
          )}
        </div>

        <div className={dividerClass}></div>

        <div className="w-[172px]">
          <label htmlFor="adults-desktop" className="sr-only">Number of adults</label>
          <div className="relative">
            <select
              id="adults-desktop"
              value={formData.adults}
              onChange={(e) => handleGuestChange('adults', parseInt(e.target.value, 10))}
              className={`${selectClassDesktop} ${errors.adults ? (isGlass ? 'border-white' : 'border-red-400') : ''}`}
              style={!isGlass ? { color: '#111827' } : {}}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => (
                <option key={num} value={num} style={{ color: '#111827', backgroundColor: '#ffffff' }}>{num} {num === 1 ? 'Adult' : 'Adults'}</option>
              ))}
            </select>
            <svg
              className={`pointer-events-none absolute right-1 top-1/2 -translate-y-[46%] h-4 w-4 ${isGlass ? 'text-white/80' : 'text-gray-600'}`}
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M6 8l4 4 4-4" />
            </svg>
          </div>
          {errors.adults && (
            <p className={errorTextClass}>{errors.adults}</p>
          )}
        </div>

        <div className={dividerClass}></div>

        <div className="w-[172px]">
          <label htmlFor="children-desktop" className="sr-only">Number of children</label>
          <div className="relative">
            <select
              id="children-desktop"
              value={formData.children}
              onChange={(e) => handleGuestChange('children', parseInt(e.target.value, 10))}
              className={`${selectClassDesktop} ${errors.children ? (isGlass ? 'border-white' : 'border-red-400') : ''}`}
              style={!isGlass ? { color: '#111827' } : {}}
            >
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => (
                <option key={num} value={num} style={{ color: '#111827', backgroundColor: '#ffffff' }}>{num} {num === 1 ? 'Child' : 'Children'}</option>
              ))}
            </select>
            <svg
              className={`pointer-events-none absolute right-1 top-1/2 -translate-y-[46%] h-4 w-4 ${isGlass ? 'text-white/80' : 'text-gray-600'}`}
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M6 8l4 4 4-4" />
            </svg>
          </div>
          {errors.children && (
            <p className={errorTextClass}>{errors.children}</p>
          )}
        </div>

        <div className="w-auto">
          <button
            type="submit"
            className={`min-w-[176px] h-12 lg:h-14 px-6 rounded-lg text-sm lg:text-base font-medium focus:outline-none focus:ring-2 active:scale-95 transition-all duration-150 inline-flex items-center justify-center whitespace-nowrap touch-manipulation ${
              buttonTheme === 'hero'
                ? 'bg-black text-white hover:bg-black/90 focus:ring-black/40'
                : 'bg-[#81887A] text-white hover:bg-[#6F766B] focus:ring-[#81887A]/30'
            }`}
          >
            Search cabins →
          </button>
        </div>
      </div>
    </form>
  );
};

export { SearchBar };
export default SearchBar;
