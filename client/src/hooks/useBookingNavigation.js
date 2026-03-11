import { useCallback } from 'react';

// Centralized keys + query param builder for cabin → confirm flow
export const CONFIRM_BOOKING_SIMPLE_KEY = 'confirm-booking-simple';

export function buildConfirmSearchParams(searchCriteria) {
  const params = new URLSearchParams();
  if (searchCriteria?.checkIn) params.set('checkIn', searchCriteria.checkIn);
  if (searchCriteria?.checkOut) params.set('checkOut', searchCriteria.checkOut);
  if (searchCriteria?.adults != null) params.set('adults', String(searchCriteria.adults));
  if (searchCriteria?.children != null) params.set('children', String(searchCriteria.children));
  return params;
}

/**
 * Shared booking navigation helper for cabin-style pages.
 *
 * - No dates → open date modal
 * - Dates present → persist lightweight state + navigate to confirm page
 */
export function useBookingNavigation({
  cabinId,
  searchCriteria,
  selectedExpKeys,
  openDateModal,
  navigate
}) {
  const goToConfirmOrOpenDates = useCallback(() => {
    if (!searchCriteria?.checkIn || !searchCriteria?.checkOut) {
      openDateModal?.();
      return;
    }

    const params = buildConfirmSearchParams(searchCriteria);

    // Persist lightweight state for ConfirmBooking restore
    try {
      sessionStorage.setItem(
        CONFIRM_BOOKING_SIMPLE_KEY,
        JSON.stringify({
          cabinId,
          searchCriteria: {
            checkIn: searchCriteria.checkIn,
            checkOut: searchCriteria.checkOut,
            adults: searchCriteria.adults,
            children: searchCriteria.children
          },
          selectedExpKeys: Array.from(selectedExpKeys || [])
        })
      );
    } catch {
      // ignore storage errors
    }

    navigate?.(`/cabin/${cabinId}/confirm?${params.toString()}`, {
      state: {
        cabinId,
        searchCriteria: {
          checkIn: searchCriteria.checkIn,
          checkOut: searchCriteria.checkOut,
          adults: searchCriteria.adults,
          children: searchCriteria.children
        },
        selectedExpKeys: Array.from(selectedExpKeys || [])
      }
    });
  }, [
    cabinId,
    navigate,
    openDateModal,
    searchCriteria?.checkIn,
    searchCriteria?.checkOut,
    searchCriteria?.adults,
    searchCriteria?.children,
    selectedExpKeys
  ]);

  return { goToConfirmOrOpenDates };
}

