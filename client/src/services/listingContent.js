import { cabinTypeAPI } from './api';
import { fetchCabins, clearCabinCache } from './cabinContent';
import { resolveCabinStaySlug, STAY_SLUG } from '../utils/stayRoutes';

let slugIndexPromise = null;

/**
 * Build a slug → listing index from live API data (cabins + multi-unit cabin types).
 * @returns {Promise<Record<string, { kind: 'cabin'|'cabinType', listing: object, slug: string }>>}
 */
export async function fetchSlugListingIndex() {
  if (!slugIndexPromise) {
    slugIndexPromise = (async () => {
      try {
        const [cabins, aFrameRes] = await Promise.all([
          fetchCabins(),
          cabinTypeAPI.getBySlug(STAY_SLUG.A_FRAME).catch(() => null)
        ]);

        const index = {};

        (cabins || []).forEach((cabin) => {
          const slug = resolveCabinStaySlug(cabin);
          if (slug) {
            index[slug] = { kind: 'cabin', listing: cabin, slug };
          }
        });

        const aFrame = aFrameRes?.data?.data?.cabinType;
        if (aFrame?.slug) {
          index[aFrame.slug] = { kind: 'cabinType', listing: aFrame, slug: aFrame.slug };
        } else if (aFrame) {
          index[STAY_SLUG.A_FRAME] = { kind: 'cabinType', listing: aFrame, slug: STAY_SLUG.A_FRAME };
        }

        return index;
      } catch (error) {
        slugIndexPromise = null;
        throw error;
      }
    })();
  }

  return slugIndexPromise;
}

/** @param {string} slug */
export async function fetchListingBySlug(slug) {
  const normalized = String(slug || '').trim().toLowerCase();
  if (!normalized) return null;
  const index = await fetchSlugListingIndex();
  return index[normalized] || null;
}

export function clearListingCache() {
  slugIndexPromise = null;
  clearCabinCache();
}
