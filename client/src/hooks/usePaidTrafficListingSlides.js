import { useEffect, useMemo, useState } from 'react';
import { PAID_TRAFFIC_STAY_META } from '../data/paidTrafficLandingStays';
import { fetchSlugListingIndex } from '../services/listingContent';
import {
  buildListingCardSlides,
  getListingCoverImage
} from '../utils/listingGalleryUtils';

function emergencyFallbackSlides(meta) {
  if (!meta.fallbackImage) return [];
  const cover = getListingCoverImage(null, {
    fallbackUrl: meta.fallbackImage,
    alt: meta.id
  });
  return cover.url ? [{ url: cover.url, alt: cover.alt }] : [];
}

function initialFallbackState() {
  const init = {};
  PAID_TRAFFIC_STAY_META.forEach((meta) => {
    init[meta.id] = emergencyFallbackSlides(meta);
  });
  return init;
}

/**
 * Resolves 3–5 slides per paid-traffic stay from listing API by slug.
 * Static URLs are emergency fallback only (initial paint / API failure).
 */
export function usePaidTrafficListingSlides() {
  const [byId, setById] = useState(initialFallbackState);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const index = await fetchSlugListingIndex();
        if (!active) return;

        const next = {};
        for (const meta of PAID_TRAFFIC_STAY_META) {
          const entry = index[meta.listingSlug];
          const slides = entry
            ? buildListingCardSlides(entry.listing, {
                kind: entry.kind,
                maxSlides: 5,
                fallbackUrl: meta.fallbackImage
              })
            : emergencyFallbackSlides(meta);

          next[meta.id] = slides.length ? slides : emergencyFallbackSlides(meta);
        }

        if (import.meta.env.DEV) {
          const counts = Object.fromEntries(
            Object.entries(next).map(([id, slides]) => [id, slides.length])
          );
          console.debug('[paid-landing] slides per stay (after API)', counts);
        }

        setById(next);
      } catch {
        if (!active) return;
        if (import.meta.env.DEV) {
          console.debug('[paid-landing] slides per stay (fallback — API failed)');
        }
        setById(initialFallbackState());
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const firstSlideUrl = useMemo(() => {
    const firstId = PAID_TRAFFIC_STAY_META[0]?.id;
    if (!firstId || !byId[firstId]?.[0]?.url) return null;
    return byId[firstId][0].url;
  }, [byId]);

  return { slidesByStayId: byId, firstSlideUrl };
}
