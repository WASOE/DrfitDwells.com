import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBookingSearch } from '../context/BookingSearchContext';
import { parseDateOnlyLocal } from '../utils/dateOnly';

/**
 * One-shot hydrate of BookingSearchContext from URL query params.
 * Used by the whole-Valley quote page so homepage handoffs keep exact guests and dates.
 */
export function useHydrateBookingSearchFromQuery() {
  const [searchParams] = useSearchParams();
  const { updateDates, updateGuests } = useBookingSearch();
  const applied = useRef(false);

  useEffect(() => {
    if (applied.current) return;

    const adultsRaw = searchParams.get('adults');
    const childrenRaw = searchParams.get('children');
    const babiesRaw = searchParams.get('babies');
    const petsRaw = searchParams.get('pets');
    const checkInRaw = searchParams.get('checkIn');
    const checkOutRaw = searchParams.get('checkOut');

    const hasGuestParam = [adultsRaw, childrenRaw, babiesRaw, petsRaw].some((value) => value != null);
    const hasDateParam = Boolean(checkInRaw || checkOutRaw);
    if (!hasGuestParam && !hasDateParam) return;

    applied.current = true;

    if (hasGuestParam) {
      const next = {};
      const adults = Number(adultsRaw);
      const children = Number(childrenRaw);
      const babies = Number(babiesRaw);
      const pets = Number(petsRaw);
      if (Number.isFinite(adults) && adults >= 1) next.adults = Math.floor(adults);
      if (Number.isFinite(children) && children >= 0) next.children = Math.floor(children);
      if (Number.isFinite(babies) && babies >= 0) next.babies = Math.floor(babies);
      if (Number.isFinite(pets) && pets >= 0) next.pets = Math.floor(pets);
      if (Object.keys(next).length) updateGuests(next);
    }

    if (checkInRaw && checkOutRaw) {
      const checkIn = parseDateOnlyLocal(checkInRaw);
      const checkOut = parseDateOnlyLocal(checkOutRaw);
      if (checkIn && checkOut && checkOut > checkIn) {
        updateDates(checkIn, checkOut);
      }
    }
  }, [searchParams, updateDates, updateGuests]);
}
