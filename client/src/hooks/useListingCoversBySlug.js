import { useEffect, useMemo, useState } from 'react';
import { fetchSlugListingIndex } from '../services/listingContent';
import { getListingCoverImage } from '../utils/listingGalleryUtils';

/**
 * Resolve live listing cover images for a set of slugs.
 * @param {{ slug: string, fallbackUrl?: string, alt?: string }[]} configs
 * @returns {Record<string, { url: string, alt: string }>}
 */
export function useListingCoversBySlug(configs = []) {
  const configKey = useMemo(
    () =>
      configs
        .map((c) => `${c.slug}:${c.fallbackUrl || ''}`)
        .sort()
        .join('|'),
    [configs]
  );

  const [coversBySlug, setCoversBySlug] = useState({});

  useEffect(() => {
    if (!configs.length) {
      setCoversBySlug({});
      return undefined;
    }

    let active = true;

    (async () => {
      try {
        const index = await fetchSlugListingIndex();
        if (!active) return;

        const next = {};
        for (const { slug, fallbackUrl, alt } of configs) {
          const normalized = String(slug || '').trim().toLowerCase();
          if (!normalized) continue;
          const entry = index[normalized];
          const cover = getListingCoverImage(entry?.listing || null, {
            fallbackUrl,
            alt
          });
          if (cover.url) {
            next[normalized] = cover;
          }
        }

        setCoversBySlug(next);
      } catch {
        if (!active) return;
        const emergency = {};
        for (const { slug, fallbackUrl, alt } of configs) {
          const normalized = String(slug || '').trim().toLowerCase();
          if (!normalized || !fallbackUrl) continue;
          const cover = getListingCoverImage(null, { fallbackUrl, alt });
          if (cover.url) emergency[normalized] = cover;
        }
        setCoversBySlug(emergency);
      }
    })();

    return () => {
      active = false;
    };
  }, [configKey, configs]);

  return coversBySlug;
}
