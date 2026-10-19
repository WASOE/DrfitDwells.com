import { useMemo } from 'react';
import { PAID_TRAFFIC_STAY_META } from '../data/paidTrafficLandingStays';
import { useListingCoversBySlug } from './useListingCoversBySlug';

/**
 * Resolves the Explore Each Stay cards from each property's listing hero.
 * Editorial AI Search photography is intentionally not used here.
 */
export function usePaidTrafficListingSlides() {
  const coverConfigs = useMemo(
    () =>
      PAID_TRAFFIC_STAY_META.map((stay) => ({
        slug: stay.listingSlug,
        fallbackUrl: stay.fallbackImage,
        alt: stay.listingSlug
      })),
    []
  );
  const coversBySlug = useListingCoversBySlug(coverConfigs);

  const byId = useMemo(
    () =>
      Object.fromEntries(PAID_TRAFFIC_STAY_META.map((meta) => {
        const cover = coversBySlug[meta.listingSlug];
        return [meta.id, cover?.url ? [{ url: cover.url, alt: cover.alt }] : []];
      })),
    [coversBySlug]
  );

  const firstSlideUrl = useMemo(() => {
    const firstId = PAID_TRAFFIC_STAY_META[0]?.id;
    if (!firstId || !byId[firstId]?.[0]?.url) return null;
    return byId[firstId][0].url;
  }, [byId]);

  return { slidesByStayId: byId, firstSlideUrl };
}
