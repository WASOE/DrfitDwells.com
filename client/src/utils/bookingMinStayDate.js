import { startOfDay } from 'date-fns';

/**
 * Earliest check-in (local calendar day) allowed in booking UIs.
 * Must stay aligned with `SearchResults` URL normalization (`getValidatedSearchParams`).
 */
export function getMinSelectableStayDate() {
  return startOfDay(new Date());
}
