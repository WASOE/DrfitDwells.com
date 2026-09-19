import { resolveAllowPets } from './stayPageContent';
import { resolveListingStaySlug } from './stayRoutes';

/**
 * Client-owned pricing-unavailable messages keyed by API pricingError.code only.
 * Never render API message/details text.
 */
export const PUBLIC_PRICING_ERROR_MESSAGES = Object.freeze({
  AMBIGUOUS_SEASONAL_RATE_PLAN:
    'Pricing is temporarily unavailable for this stay. Please try different dates or contact us.',
  SEASONAL_MIN_NIGHTS: 'This seasonal rate requires a longer stay.',
  MALFORMED_SEASONAL_RATE_PLAN:
    'Pricing is temporarily unavailable for this stay. Please try again later.',
  RATE_PLAN_LOOKUP_FAILED:
    'Pricing is temporarily unavailable for this stay. Please try again later.',
  INVALID_STAY_DATES: 'Please provide a valid stay range.',
  MISSING_ACCOMMODATION_KEY:
    'Pricing is temporarily unavailable for this stay. Please try again later.',
  PRICING_FAILED:
    'Price unavailable for these dates. Try different dates or contact us.'
});

/**
 * Map an API pricingError.code to a fixed client-owned string.
 * Unknown / malformed codes → PRICING_FAILED message.
 */
export function resolvePublicPricingErrorMessage(code) {
  if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(PUBLIC_PRICING_ERROR_MESSAGES, code)) {
    return PUBLIC_PRICING_ERROR_MESSAGES[code];
  }
  return PUBLIC_PRICING_ERROR_MESSAGES.PRICING_FAILED;
}

/**
 * Monotonic last-request-wins guard for async UI updates.
 * begin() issues a ticket; only the latest ticket may apply state updates.
 * invalidate() retires all in-flight tickets (deps change / unmount).
 */
export function createLastRequestWinsGuard() {
  let generation = 0;
  return {
    begin() {
      const id = ++generation;
      return {
        id,
        isCurrent: () => id === generation,
        apply(fn) {
          if (id !== generation) return false;
          fn();
          return true;
        }
      };
    },
    invalidate() {
      generation += 1;
    },
    get currentGeneration() {
      return generation;
    }
  };
}

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
    case 'pricing': {
      const msg = resolvePublicPricingErrorMessage(cabin?.pricingError?.code);
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
