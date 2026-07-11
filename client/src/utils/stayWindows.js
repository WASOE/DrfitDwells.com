import {
  addDaysDateOnly,
  compareDateOnly,
  daysBetweenDateOnly,
  formatDateOnlyLocal,
  parseDateOnlyLocal
} from './dateOnly';

/** Default contiguous-free search horizon (matches 12-month availability cap). */
export const DEFAULT_FREE_RUN_HORIZON_DAYS = 400;

/**
 * @param {Iterable<string>|Set<string>|null|undefined} blockedNights
 * @returns {Set<string>}
 */
export function toBlockedNightSet(blockedNights) {
  if (!blockedNights) return new Set();
  if (blockedNights instanceof Set) return blockedNights;
  return new Set(blockedNights);
}

/**
 * Whether night `dateOnly` (YYYY-MM-DD) is free.
 * @param {string} dateOnly
 * @param {Set<string>} blockedSet
 */
export function isNightFree(dateOnly, blockedSet) {
  return Boolean(dateOnly) && !blockedSet.has(dateOnly);
}

/**
 * Last free night F in the contiguous free run starting at checkIn (inclusive).
 * Returns null when check-in night is blocked.
 *
 * @param {string} checkIn
 * @param {Set<string>} blockedSet
 * @param {number} [horizonDays]
 * @returns {string|null}
 */
export function lastFreeNightOfRun(checkIn, blockedSet, horizonDays = DEFAULT_FREE_RUN_HORIZON_DAYS) {
  if (!checkIn || blockedSet.has(checkIn)) return null;

  let lastFree = checkIn;
  for (let offset = 1; offset < horizonDays; offset += 1) {
    const next = addDaysDateOnly(checkIn, offset);
    if (!next || blockedSet.has(next)) break;
    lastFree = next;
  }
  return lastFree;
}

/**
 * Check-in date is valid when nights d..d+minNights-1 are all free.
 *
 * @param {string} dateOnly
 * @param {Set<string>} blockedSet
 * @param {number} minNights
 * @param {number} [horizonDays]
 */
export function isValidCheckInStart(dateOnly, blockedSet, minNights, horizonDays = DEFAULT_FREE_RUN_HORIZON_DAYS) {
  if (!dateOnly || minNights < 1) return false;

  for (let offset = 0; offset < minNights; offset += 1) {
    const night = addDaysDateOnly(dateOnly, offset);
    if (!night || blockedSet.has(night)) return false;
  }

  // Ensure the min-stay window stays inside the searched horizon.
  const lastRequired = addDaysDateOnly(dateOnly, minNights - 1);
  const horizonEnd = addDaysDateOnly(dateOnly, horizonDays - 1);
  if (compareDateOnly(lastRequired, horizonEnd) > 0) return false;

  return true;
}

/**
 * Minimum checkout (exclusive end) for a check-in: checkIn + minNights calendar days.
 *
 * @param {string} checkIn
 * @param {number} minNights
 * @returns {string}
 */
export function minCheckoutDateForCheckIn(checkIn, minNights) {
  return addDaysDateOnly(checkIn, minNights);
}

/**
 * Maximum checkout (exclusive end): day after last free night F in run from check-in.
 *
 * @param {string} checkIn
 * @param {Set<string>} blockedSet
 * @param {number} [horizonDays]
 * @returns {string|null}
 */
export function maxCheckoutDateForCheckIn(checkIn, blockedSet, horizonDays = DEFAULT_FREE_RUN_HORIZON_DAYS) {
  const lastFree = lastFreeNightOfRun(checkIn, blockedSet, horizonDays);
  if (!lastFree) return null;
  return addDaysDateOnly(lastFree, 1);
}

/**
 * Checkout date is valid for a fixed check-in when it lies in [checkIn+minNights, F+1]
 * and every stayed night (checkIn .. checkout-1) is free.
 *
 * @param {string} checkout
 * @param {string} checkIn
 * @param {Set<string>} blockedSet
 * @param {number} minNights
 * @param {number} [horizonDays]
 */
export function isValidCheckoutForCheckIn(
  checkout,
  checkIn,
  blockedSet,
  minNights,
  horizonDays = DEFAULT_FREE_RUN_HORIZON_DAYS
) {
  if (!checkout || !checkIn) return false;

  const minCheckout = minCheckoutDateForCheckIn(checkIn, minNights);
  const maxCheckout = maxCheckoutDateForCheckIn(checkIn, blockedSet, horizonDays);
  if (!minCheckout || !maxCheckout) return false;
  if (compareDateOnly(checkout, minCheckout) < 0) return false;
  if (compareDateOnly(checkout, maxCheckout) > 0) return false;

  const stayedNights = daysBetweenDateOnly(checkIn, checkout);
  for (let offset = 0; offset < stayedNights; offset += 1) {
    const night = addDaysDateOnly(checkIn, offset);
    if (!night || blockedSet.has(night)) return false;
  }

  return true;
}

/**
 * Whether a calendar day should be selectable in the retreat stay picker.
 *
 * @param {string} dateOnly - YYYY-MM-DD
 * @param {object} options
 * @param {string} options.minStayDate - YYYY-MM-DD
 * @param {Set<string>} options.blockedSet
 * @param {number} options.minNights
 * @param {string|null} [options.rangeFrom] - YYYY-MM-DD when selecting checkout
 * @param {boolean} [options.selectingCheckout]
 * @param {number} [options.horizonDays]
 */
export function isRetreatStayDateEnabled(
  dateOnly,
  {
    minStayDate,
    blockedSet,
    minNights,
    rangeFrom = null,
    selectingCheckout = false,
    horizonDays = DEFAULT_FREE_RUN_HORIZON_DAYS
  }
) {
  if (!dateOnly || compareDateOnly(dateOnly, minStayDate) < 0) return false;

  if (selectingCheckout && rangeFrom) {
    return (
      isValidCheckInStart(dateOnly, blockedSet, minNights, horizonDays) ||
      isValidCheckoutForCheckIn(dateOnly, rangeFrom, blockedSet, minNights, horizonDays)
    );
  }

  return isValidCheckInStart(dateOnly, blockedSet, minNights, horizonDays);
}

/**
 * Date object helper for DayPicker disabled callbacks.
 *
 * @param {Date} date
 * @param {object} options
 * @param {Date} options.minStayDate
 * @param {Set<string>} options.blockedSet
 * @param {number} options.minNights
 * @param {Date|null|undefined} options.rangeFrom
 * @param {Date|null|undefined} options.rangeTo
 * @param {boolean} options.calendarReady
 */
export function isRetreatStayCalendarDateDisabled(
  date,
  { minStayDate, blockedSet, minNights, rangeFrom, rangeTo, calendarReady, horizonDays }
) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return true;
  if (!(minStayDate instanceof Date) || Number.isNaN(minStayDate.getTime())) return true;
  if (!calendarReady) return true;

  const dateOnly = formatDateOnlyLocal(date);
  const minStayDateOnly = formatDateOnlyLocal(minStayDate);
  const rangeFromOnly = rangeFrom ? formatDateOnlyLocal(rangeFrom) : null;
  const selectingCheckout = Boolean(rangeFromOnly && !rangeTo);

  return !isRetreatStayDateEnabled(dateOnly, {
    minStayDate: minStayDateOnly,
    blockedSet,
    minNights,
    rangeFrom: rangeFromOnly,
    selectingCheckout,
    horizonDays
  });
}

/**
 * @param {string} dateOnly
 * @returns {Date|null}
 */
export function dateOnlyToLocalDate(dateOnly) {
  return parseDateOnlyLocal(dateOnly);
}
