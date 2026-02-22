import { createContext, useContext, useMemo, useState } from 'react';
import { differenceInDays } from 'date-fns';

const BookingSearchContext = createContext();

export const BookingSearchProvider = ({ children }) => {
  const [checkIn, setCheckIn] = useState(null);
  const [checkOut, setCheckOut] = useState(null);
  const [adults, setAdults] = useState(2);
  const [childCount, setChildCount] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const updateDates = (start, end) => {
    setCheckIn(start || null);
    setCheckOut(end || null);
  };

  const updateGuests = ({ adults: nextAdults, children: nextChildren }) => {
    if (typeof nextAdults === 'number') {
      setAdults(Math.max(1, nextAdults));
    }
    if (typeof nextChildren === 'number') {
      setChildCount(Math.max(0, nextChildren));
    }
  };

  const resetSearch = () => {
    setCheckIn(null);
    setCheckOut(null);
    setAdults(2);
    setChildCount(0);
  };

  const nights = useMemo(() => {
    if (checkIn && checkOut) {
      return Math.max(1, differenceInDays(checkOut, checkIn));
    }
    return 0;
  }, [checkIn, checkOut]);

  const value = {
    checkIn,
    checkOut,
    adults,
    children: childCount,
    nights,
    updateDates,
    updateGuests,
    resetSearch,
    isModalOpen,
    openModal: () => setIsModalOpen(true),
    closeModal: () => setIsModalOpen(false)
  };

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

