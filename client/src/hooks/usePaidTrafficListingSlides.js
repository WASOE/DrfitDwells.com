import { useEffect, useMemo, useState } from 'react';
import { fetchCabins } from '../services/cabinContent';
import { cabinTypeAPI } from '../services/api';
import { PAID_TRAFFIC_STAY_META } from '../data/paidTrafficLandingStays';
import {
  buildPaidTrafficSlides,
  normalizeListingImageSrc
} from '../utils/listingGalleryUtils';

const PRIMARY_NAMES = ['the cabin', 'bucephalus', 'the cabin (bucephalus)'];

function findPrimaryCabin(cabins) {
  if (!Array.isArray(cabins) || cabins.length === 0) return null;
  return (
    cabins.find((c) => c?.name && PRIMARY_NAMES.includes(c.name.trim().toLowerCase())) ||
    cabins[0]
  );
}

function staticFallbackSlides(meta) {
  return [
    {
      url: normalizeListingImageSrc(meta.image),
      alt: meta.id
    }
  ];
}

/**
 * Resolves 3–5 slides per paid-traffic stay from the same API sources as listing pages,
 * with MosaicGallery-aligned hero ordering. Falls back to static marketing URLs.
 */
export function usePaidTrafficListingSlides() {
  const [byId, setById] = useState(() => {
    const init = {};
    PAID_TRAFFIC_STAY_META.forEach((m) => {
      init[m.id] = staticFallbackSlides(m);
    });
    return init;
  });
  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const cabins = await fetchCabins();
        if (!active) return;

        const nameToCabin = {};
        (cabins || []).forEach((c) => {
          if (c?.name && c?._id) nameToCabin[c.name.trim().toLowerCase()] = c;
        });

        const primary = findPrimaryCabin(cabins);

        let cabinType = null;
        try {
          const res = await cabinTypeAPI.getBySlug('a-frame');
          if (res?.data?.success && res.data?.data?.cabinType) {
            cabinType = res.data.data.cabinType;
          }
        } catch {
          cabinType = null;
        }

        const next = {};
        for (const meta of PAID_TRAFFIC_STAY_META) {
          let slides = [];

          if (meta.id === 'the-cabin' && primary) {
            slides = buildPaidTrafficSlides(primary, 'cabin', 5);
          } else if (meta.id === 'valley-a-frame' && cabinType) {
            slides = buildPaidTrafficSlides(cabinType, 'cabinType', 5);
          } else if (meta.linkKind === 'backend' && meta.backendName) {
            const c = nameToCabin[meta.backendName.trim().toLowerCase()];
            if (c) slides = buildPaidTrafficSlides(c, 'cabin', 5);
          }

          if (!slides.length) {
            slides = staticFallbackSlides(meta);
          }

          next[meta.id] = slides;
        }

        if (active) {
          if (import.meta.env.DEV) {
            const counts = Object.fromEntries(
              Object.entries(next).map(([id, slides]) => [id, slides.length])
            );
            console.debug('[paid-landing] slides per stay (after API)', counts);
          }
          setById(next);
        }
      } catch {
        if (active) {
          const next = {};
          PAID_TRAFFIC_STAY_META.forEach((m) => {
            next[m.id] = staticFallbackSlides(m);
          });
          if (import.meta.env.DEV) {
            console.debug(
              '[paid-landing] slides per stay (fallback — API/cabins failed)',
              Object.fromEntries(Object.entries(next).map(([id, s]) => [id, s.length]))
            );
          }
          setById(next);
        }
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
