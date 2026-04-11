import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { daysBetweenDateOnly } from '../utils/dateOnly';
import { readGuestPromo, writeGuestPromo } from '../utils/guestPromo';

const BookingSearchContext = createContext();

export const BookingSearchProvider = ({ children }) => {
  const [checkIn, setCheckIn] = useState(null);
  const [checkOut, setCheckOut] = useState(null);
  const [adults, setAdults] = useState(2);
  const [childCount, setChildCount] = useState(0);
  const [babies, setBabies] = useState(0);
  const [pets, setPets] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [guestPromoCode, setGuestPromoCodeState] = useState('');

  useEffect(() => {
    setGuestPromoCodeState(readGuestPromo());
  }, []);

  const setGuestPromoCode = useCallback((raw) => {
    const c = (raw || '').trim().toUpperCase();
    setGuestPromoCodeState(c);
    writeGuestPromo(c);
  }, []);

  const updateDates = useCallback((start, end) => {
    setCheckIn(start || null);
    setCheckOut(end || null);
  }, []);

  const updateGuests = useCallback(({ adults: nextAdults, children: nextChildren, babies: nextBabies, pets: nextPets }) => {
    if (typeof nextAdults === 'number') setAdults(Math.max(1, nextAdults));
    if (typeof nextChildren === 'number') setChildCount(Math.max(0, nextChildren));
    if (typeof nextBabies === 'number') setBabies(Math.max(0, nextBabies));
    if (typeof nextPets === 'number') setPets(Math.max(0, nextPets));
  }, []);

  const resetSearch = useCallback(() => {
    setCheckIn(null);
    setCheckOut(null);
    setAdults(2);
    setChildCount(0);
    setBabies(0);
    setPets(0);
    setGuestPromoCodeState('');
    writeGuestPromo('');
  }, []);

  const nights = useMemo(() => {
    if (checkIn && checkOut) {
      return Math.max(1, daysBetweenDateOnly(checkIn, checkOut));
    }
    return 0;
  }, [checkIn, checkOut]);

  const openModal = useCallback(() => {
    if (import.meta.env.DEV) {
      console.info('[booking-modal] openModal() requested');
    }
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    if (import.meta.env.DEV) {
      console.info('[booking-modal] closeModal() requested');
    }
    setIsModalOpen(false);
  }, []);

  const value = useMemo(() => ({
    checkIn,
    checkOut,
    adults,
    children: childCount,
    babies,
    pets,
    nights,
    updateDates,
    updateGuests,
    resetSearch,
    isModalOpen,
    openModal,
    closeModal,
    guestPromoCode,
    setGuestPromoCode
  }), [
    checkIn,
    checkOut,
    adults,
    childCount,
    babies,
    pets,
    nights,
    updateDates,
    updateGuests,
    resetSearch,
    isModalOpen,
    openModal,
    closeModal,
    guestPromoCode,
    setGuestPromoCode
  ]);

  return (
    <BookingSearchContext.Provider value={value}>
      {children}
    </BookingSearchContext.Provider>
  );
};

export const useBookingSearch = () => {
  const context = useContext(BookingSearchContext);
  if (!context) {
    throw new Error('useBookingSearch must be used within a BookingSearchProvider');
  }
  return context;
};

