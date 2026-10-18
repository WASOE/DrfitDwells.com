import { useMemo } from 'react';
import { PAID_TRAFFIC_STAY_META } from '../data/paidTrafficLandingStays';

/**
 * Resolves the AI Search gallery from the approved uploaded photographs.
 * The page must not replace these images with the general listing library.
 */
export function usePaidTrafficListingSlides() {
  const byId = useMemo(
    () =>
      Object.fromEntries(
        PAID_TRAFFIC_STAY_META.map((meta) => [meta.id, meta.galleryImages || []])
      ),
    []
  );

  const firstSlideUrl = useMemo(() => {
    const firstId = PAID_TRAFFIC_STAY_META[0]?.id;
    if (!firstId || !byId[firstId]?.[0]?.url) return null;
    return byId[firstId][0].url;
  }, [byId]);

  return { slidesByStayId: byId, firstSlideUrl };
}
