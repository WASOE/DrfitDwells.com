import { useCallback } from 'react';
import { readGuestPromo } from '../utils/guestPromo';

// Centralized keys + query param builder for cabin → confirm flow
export const CONFIRM_BOOKING_SIMPLE_KEY = 'confirm-booking-simple';

export function buildConfirmSearchParams(searchCriteria) {
  const params = new URLSearchParams();
  if (searchCriteria?.checkIn) params.set('checkIn', searchCriteria.checkIn);
  if (searchCriteria?.checkOut) params.set('checkOut', searchCriteria.checkOut);
  if (searchCriteria?.adults != null) params.set('adults', String(searchCriteria.adults));
  if (searchCriteria?.children != null) params.set('children', String(searchCriteria.children));
  const promo = (searchCriteria?.promoCode || readGuestPromo() || '').trim().toUpperCase();
  if (promo) params.set('promoCode', promo);
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
  bookingEntityId,
  bookingEntityType = 'cabin',
  bookingEntitySlug,
  confirmPath,
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
    const entityId = bookingEntityId || cabinId;
    const targetConfirmPath = confirmPath || `/cabin/${entityId}/confirm`;

    // Persist lightweight state for ConfirmBooking restore
    try {
      const promoCode =
        (searchCriteria?.promoCode || readGuestPromo() || '').trim().toUpperCase() || undefined;
      sessionStorage.setItem(
        CONFIRM_BOOKING_SIMPLE_KEY,
        JSON.stringify({
          cabinId: entityId,
          bookingEntityId: entityId,
          bookingEntityType,
          bookingEntitySlug: bookingEntitySlug || null,
          confirmPath: targetConfirmPath,
          searchCriteria: {
            checkIn: searchCriteria.checkIn,
            checkOut: searchCriteria.checkOut,
            adults: searchCriteria.adults,
            children: searchCriteria.children
          },
          promoCode,
          selectedExpKeys: Array.from(selectedExpKeys || [])
        })
      );
    } catch {
      // ignore storage errors
    }

    navigate?.(`${targetConfirmPath}?${params.toString()}`, {
      state: {
        cabinId: entityId,
        bookingEntityId: entityId,
        bookingEntityType,
        bookingEntitySlug: bookingEntitySlug || null,
        confirmPath: targetConfirmPath,
        searchCriteria: {
          checkIn: searchCriteria.checkIn,
          checkOut: searchCriteria.checkOut,
          adults: searchCriteria.adults,
          children: searchCriteria.children
        },
        promoCode: (searchCriteria?.promoCode || readGuestPromo() || '').trim().toUpperCase() || undefined,
        selectedExpKeys: Array.from(selectedExpKeys || [])
      }
    });
  }, [
    bookingEntityId,
    bookingEntitySlug,
    bookingEntityType,
    cabinId,
    confirmPath,
    navigate,
    openDateModal,
    searchCriteria?.checkIn,
    searchCriteria?.checkOut,
    searchCriteria?.adults,
    searchCriteria?.children,
    searchCriteria?.promoCode,
    selectedExpKeys
  ]);

  return { goToConfirmOrOpenDates };
}

