import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBookingSearch } from '../../context/BookingSearchContext';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import { localizePath } from '../../utils/localizedRoutes';
import { STAY_MATCHES, buildAvailabilitySearch } from '../../data/homepagePlanner';

function scrollToBooking() {
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  document.getElementById('booking')?.scrollIntoView({ behavior, block: 'start' });
}

/** Continue into the existing date search, or the whole-Valley booking page. */
export function useHomeBookingHandoff() {
  const navigate = useNavigate();
  const { language } = useSiteLanguage();
  const { checkIn, checkOut, updateGuests, openModal } = useBookingSearch();

  return useCallback((stayId, adults) => {
    const match = STAY_MATCHES[stayId];
    if (!match) return;

    if (stayId === 'buyout' || adults == null) {
      navigate(localizePath(match.path, language));
      return;
    }

    updateGuests({ adults, children: 0, babies: 0, pets: 0 });
    const href = buildAvailabilitySearch({ checkIn, checkOut, adults, language });
    if (href) {
      navigate(href);
      return;
    }

    openModal();
    scrollToBooking();
  }, [checkIn, checkOut, language, navigate, openModal, updateGuests]);
}
