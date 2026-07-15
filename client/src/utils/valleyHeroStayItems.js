import {
  VALLEY_BUYOUT_SELECTOR_META,
  VALLEY_STAY_SELECTOR_META
} from '../data/valleyStaySelectorMeta';
import { formatListingFromPrice } from './listingFromPrice';
import { getListingCoverImage } from './listingGalleryUtils';
import {
  buildPaidTrafficStayNavTarget,
  PAID_TRAFFIC_BOOKING_HASH
} from './paidTrafficRoutes';
import { localizePath } from './localizedRoutes';

/** @typedef {'idle'|'loading'|'loaded'|'error'} ValleyHeroSourceStatus */

/**
 * @param {number|null|undefined} value
 */
export function formatValleyHeroEuroAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/**
 * @param {number|null|undefined} capacity
 * @param {(key: string, options?: object) => string} tValley
 */
export function formatValleyHeroSleepsLabel(capacity, tValley) {
  if (capacity == null || !Number.isFinite(Number(capacity))) return '';
  return `${tValley('hero.selector.sleepsPrefix')} ${Number(capacity)}`;
}

/**
 * @param {string} route
 * @param {'en'|'bg'} language
 */
export function buildValleyHeroUnitBookingTo(route, language) {
  return buildPaidTrafficStayNavTarget(route, language, {
    hash: PAID_TRAFFIC_BOOKING_HASH
  });
}

/**
 * @param {'en'|'bg'} language
 */
export function buildValleyHeroBuyoutBookingTo(language) {
  return { pathname: localizePath(VALLEY_BUYOUT_SELECTOR_META.route, language) };
}

/**
 * @param {object} meta - entry from VALLEY_STAY_SELECTOR_META
 * @param {object|null|undefined} listingEntry - fetchSlugListingIndex entry
 * @param {{ url?: string, alt?: string }|null|undefined} cover
 * @param {'en'|'bg'} language
 * @param {(key: string, options?: object) => string} tValley
 * @param {(key: string, options?: object) => string} tBooking
 */
export function buildValleyHeroUnitItem(meta, listingEntry, cover, language, tValley, tBooking) {
  const listing = listingEntry?.listing ?? null;
  const title = tValley(`hero.selector.stays.${meta.i18nKey}.title`);
  const fit = tValley(`hero.selector.stays.${meta.i18nKey}.fit`);

  return {
    id: meta.id,
    kind: 'unit',
    slug: meta.listingSlug,
    titleKey: `hero.selector.stays.${meta.i18nKey}.title`,
    fitKey: `hero.selector.stays.${meta.i18nKey}.fit`,
    title,
    fit,
    sleeps: formatValleyHeroSleepsLabel(listing?.capacity, tValley),
    fromPrice: formatListingFromPrice(listing, tBooking),
    cover: cover?.url ? { url: cover.url, alt: cover.alt || title } : null,
    bookingTo: buildValleyHeroUnitBookingTo(meta.route, language)
  };
}

/**
 * @param {'en'|'bg'} language
 * @param {object|null|undefined} inventory
 * @param {(key: string, options?: object) => string} tValley
 */
export function buildValleyHeroBuyoutItem(language, inventory, tValley) {
  const title = tValley(VALLEY_BUYOUT_SELECTOR_META.i18nTitleKey);
  const fromPrice = inventory?.fromPrice ?? null;

  return {
    id: VALLEY_BUYOUT_SELECTOR_META.id,
    kind: 'buyout',
    titleKey: VALLEY_BUYOUT_SELECTOR_META.i18nTitleKey,
    title,
    bookingTo: buildValleyHeroBuyoutBookingTo(language),
    fromPriceNightly: fromPrice?.nightlyTotal ?? null,
    minNights: fromPrice?.nights ?? null,
    totalSleeps: inventory?.totalSleeps ?? null,
    fromPriceLabel:
      fromPrice?.nightlyTotal != null && fromPrice?.nights != null
        ? tValley(VALLEY_BUYOUT_SELECTOR_META.i18nFromPriceKey, {
            nightly: formatValleyHeroEuroAmount(fromPrice.nightlyTotal),
            nights: fromPrice.nights
          })
        : null
  };
}

/**
 * @param {Record<string, object>} listingsBySlug
 * @param {Record<string, { url: string, alt: string }>} coversBySlug
 * @param {'en'|'bg'} language
 * @param {(key: string, options?: object) => string} tValley
 * @param {(key: string, options?: object) => string} tBooking
 */
export function buildValleyHeroUnitItems(
  listingsBySlug,
  coversBySlug,
  language,
  tValley,
  tBooking
) {
  return VALLEY_STAY_SELECTOR_META.map((meta) => {
    const listingEntry = listingsBySlug[meta.listingSlug] ?? null;
    const cover =
      coversBySlug[meta.listingSlug] ??
      getListingCoverImage(listingEntry?.listing ?? null, {
        fallbackUrl: meta.fallbackImage,
        alt: tValley(`hero.selector.stays.${meta.i18nKey}.title`)
      });

    return buildValleyHeroUnitItem(
      meta,
      listingEntry,
      cover?.url ? cover : null,
      language,
      tValley,
      tBooking
    );
  });
}

export { VALLEY_STAY_SELECTOR_META };
