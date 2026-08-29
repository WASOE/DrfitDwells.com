import { resolveAllowPets } from './stayPageContent';
import { resolveListingStaySlug } from './stayRoutes';

/**
 * Quiet dog-policy line for Browse stays cards (explicit; never by omission).
 */
export function getSearchCardPetPolicyLabel(cabin, t) {
  const slug = resolveListingStaySlug(cabin);
  const allowPets = resolveAllowPets({
    slug,
    apiAllowPets: cabin?.allowPets
  });
  return allowPets ? t('search.dogsWelcome') : t('search.dogsNotPermitted');
}

/**
 * Maps API availability (+ pet search criteria) to Browse stays card messaging.
 */
export function getSearchCardStatus(cabin, t, { pets = 0 } = {}) {
  const petCount = Math.max(0, Number(pets) || 0);
  const slug = resolveListingStaySlug(cabin);
  const allowPets = resolveAllowPets({
    slug,
    apiAllowPets: cabin?.allowPets
  });
  const dateBookable = cabin?.available !== false;

  // Pet-incompatible stays stay visible but not bookable when the search includes dogs.
  // Date unavailability still wins when the stay is already unavailable for dates/criteria.
  if (petCount > 0 && !allowPets && dateBookable) {
    const msg = t('search.unavailableWithDogs');
    return {
      isBookable: false,
      reasonCode: 'pets',
      banner: msg,
      disabledCta: msg,
      openPlannerGuests: true,
      openPlannerStay: false
    };
  }

  if (dateBookable) {
    return {
      isBookable: true,
      reasonCode: null,
      banner: null,
      disabledCta: null,
      openPlannerGuests: false,
      openPlannerStay: false
    };
  }

  const code = cabin.unavailabilityReason || 'dates';
  const d = cabin.unavailabilityDetail || {};

  switch (code) {
    case 'min_guests': {
      const msg = t('search.reasonMinGuests', { count: d.minGuests });
      return {
        isBookable: false,
        reasonCode: code,
        banner: msg,
        disabledCta: msg,
        openPlannerGuests: true,
        openPlannerStay: false
      };
    }
    case 'max_guests': {
      const msg = t('search.reasonMaxGuests', { count: d.maxGuests });
      return {
        isBookable: false,
        reasonCode: code,
        banner: msg,
        disabledCta: msg,
        openPlannerGuests: true,
        openPlannerStay: false
      };
    }
    case 'min_nights': {
      const msg = t('search.reasonMinNights', { count: d.minNights });
      return {
        isBookable: false,
        reasonCode: code,
        banner: msg,
        disabledCta: msg,
        openPlannerGuests: false,
        openPlannerStay: true
      };
    }
    case 'dates': {
      const msg = t('search.unavailableForDates');
      return {
        isBookable: false,
        reasonCode: code,
        banner: msg,
        disabledCta: msg,
        openPlannerGuests: false,
        openPlannerStay: true
      };
    }
    default: {
      const msg = t('search.reasonCriteria');
      return {
        isBookable: false,
        reasonCode: 'criteria',
        banner: msg,
        disabledCta: msg,
        openPlannerGuests: true,
        openPlannerStay: true
      };
    }
  }
}
