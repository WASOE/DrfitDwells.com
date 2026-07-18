import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VALLEY_STAY_SELECTOR_META } from '../data/valleyStaySelectorMeta';
import { fetchSlugListingIndex } from '../services/listingContent';
import { locationInventoryAPI } from '../services/locationApi';
import {
  buildValleyHeroBuyoutItem,
  buildValleyHeroUnitItems
} from '../utils/valleyHeroStayItems';
import { useListingCoversBySlug } from './useListingCoversBySlug';
import { useSiteLanguage } from './useSiteLanguage';
import '../i18n/ns/valley';
import '../i18n/ns/booking';

/**
 * Data hook for the /valley hero stay selector card (Phase 2).
 * Fetches listing index, cover images, and buyout inventory independently.
 *
 * @returns {{
 *   units: Array<{
 *     id: string,
 *     kind: 'unit',
 *     slug: string,
 *     titleKey: string,
 *     fitKey: string,
 *     title: string,
 *     fit: string,
 *     sleeps: string,
 *     fromPrice: string|null,
 *     cover: { url: string, alt: string }|null,
 *     bookingTo: { pathname: string, hash?: string }
 *   }>,
 *   buyout: {
 *     id: string,
 *     kind: 'buyout',
 *     titleKey: string,
 *     title: string,
 *     bookingTo: { pathname: string },
 *     fromPriceNightly: number|null,
 *     minNights: number|null,
 *     totalSleeps: number|null,
 *     fromPriceLabel: string|null
 *   },
 *   listings: { status: 'idle'|'loading'|'loaded'|'error', error: string|null },
 *   covers: { status: 'idle'|'loading'|'loaded'|'error', error: string|null },
 *   buyoutInventory: { status: 'idle'|'loading'|'loaded'|'error', error: string|null }
 * }}
 */
export function useValleyHeroStayItems({ unitBookingSearch } = {}) {
  const { language } = useSiteLanguage();
  const { t: tValley } = useTranslation('valley');
  const { t: tBooking } = useTranslation('booking');

  const [listingsStatus, setListingsStatus] = useState('loading');
  const [listingsBySlug, setListingsBySlug] = useState({});
  const [listingsError, setListingsError] = useState(null);

  const [coversStatus, setCoversStatus] = useState('loading');
  const [coversError, setCoversError] = useState(null);

  const [buyoutStatus, setBuyoutStatus] = useState('loading');
  const [buyoutInventory, setBuyoutInventory] = useState(null);
  const [buyoutError, setBuyoutError] = useState(null);

  const coverConfigs = useMemo(
    () =>
      VALLEY_STAY_SELECTOR_META.map((meta) => ({
        slug: meta.listingSlug,
        fallbackUrl: meta.fallbackImage,
        alt: tValley(`hero.selector.stays.${meta.i18nKey}.title`)
      })),
    [tValley]
  );

  const coversBySlug = useListingCoversBySlug(coverConfigs);

  useEffect(() => {
    let active = true;

    (async () => {
      setListingsStatus('loading');
      setListingsError(null);

      try {
        const index = await fetchSlugListingIndex();
        if (!active) return;
        setListingsBySlug(index);
        setListingsStatus('loaded');
      } catch (err) {
        if (!active) return;
        setListingsBySlug({});
        setListingsStatus('error');
        setListingsError(err?.message || 'Failed to load stay listings');
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!coverConfigs.length) {
      setCoversStatus('idle');
      setCoversError(null);
      return;
    }

    setCoversStatus('loading');
    setCoversError(null);
  }, [coverConfigs]);

  useEffect(() => {
    if (!coverConfigs.length || coversStatus !== 'loading') return;

    if (Object.keys(coversBySlug).length > 0) {
      setCoversStatus('loaded');
      setCoversError(null);
      return;
    }

    const timer = window.setTimeout(() => {
      setCoversStatus('loaded');
      setCoversError('Failed to resolve cover images');
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [coverConfigs.length, coversBySlug, coversStatus]);

  useEffect(() => {
    let active = true;

    (async () => {
      setBuyoutStatus('loading');
      setBuyoutError(null);

      try {
        const res = await locationInventoryAPI.getInventory('the-valley');
        if (!active) return;

        if (res.data?.success) {
          setBuyoutInventory(res.data.data);
          setBuyoutStatus('loaded');
        } else {
          setBuyoutInventory(null);
          setBuyoutStatus('error');
          setBuyoutError(res.data?.message || 'Failed to load buyout inventory');
        }
      } catch (err) {
        if (!active) return;
        setBuyoutInventory(null);
        setBuyoutStatus('error');
        setBuyoutError(
          err?.response?.data?.message || err?.message || 'Failed to load buyout inventory'
        );
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const units = useMemo(
    () =>
      buildValleyHeroUnitItems(listingsBySlug, coversBySlug, language, tValley, tBooking, {
        unitBookingSearch
      }),
    [listingsBySlug, coversBySlug, language, tValley, tBooking, unitBookingSearch]
  );

  const buyout = useMemo(
    () => buildValleyHeroBuyoutItem(language, buyoutInventory, tValley),
    [language, buyoutInventory, tValley]
  );

  return {
    units,
    buyout,
    listings: {
      status: listingsStatus,
      error: listingsError
    },
    covers: {
      status: coversStatus,
      error: coversError
    },
    buyoutInventory: {
      status: buyoutStatus,
      error: buyoutError
    }
  };
}

export default useValleyHeroStayItems;
