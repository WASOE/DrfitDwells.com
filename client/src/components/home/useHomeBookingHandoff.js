import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBookingSearch } from '../../context/BookingSearchContext';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import {
  STAY_MATCHES,
  buildAvailabilitySearch,
  buildBuyoutHandoff,
} from '../../data/homepagePlanner';

function scrollToBooking() {
  const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth';
  document.getElementById('booking')?.scrollIntoView({ behavior, block: 'start' });
}

/**
 * Continue into the existing date search or whole-Valley quote calendar.
 * Never invents or zeros children / babies / pets. Exact counts are preserved.
 *
 * @param {string} stayId
 * @param {{ adults?: number }} [options] — optional adults override from the planner only
 */
export function useHomeBookingHandoff() {
  const navigate = useNavigate();
  const { language } = useSiteLanguage();
  const {
    checkIn,
    checkOut,
    adults,
    children,
    babies,
    pets,
    updateGuests,
    openModal,
  } = useBookingSearch();

  return useCallback((stayId, options = {}) => {
    const match = STAY_MATCHES[stayId];
    if (!match) return;

    const nextAdults = options.adults != null ? Number(options.adults) : adults;
    if (!Number.isFinite(nextAdults) || nextAdults < 1) return;

    // Only touch adults when the planner supplies an exact party size.
    // Children, babies and pets stay exactly as the guest already chose.
    if (options.adults != null) {
      updateGuests({ adults: nextAdults });
    }

    const guests = {
      adults: nextAdults,
      children,
      babies,
      pets,
    };

    if (stayId === 'buyout') {
      const href = buildBuyoutHandoff({
        ...guests,
        checkIn,
        checkOut,
        language,
      });
      if (href) navigate(href);
      return;
    }

    const href = buildAvailabilitySearch({
      ...guests,
      checkIn,
      checkOut,
      language,
    });
    if (href) {
      navigate(href);
      return;
    }

    openModal();
    scrollToBooking();
  }, [
    adults,
    babies,
    checkIn,
    checkOut,
    children,
    language,
    navigate,
    openModal,
    pets,
    updateGuests,
  ]);
}
