import { CABIN_MEDIA, VALLEY_MEDIA } from './mediaConfig';

/** Must match generate-hero-variants.mjs WIDTHS (subset used in srcset). */
export const HERO_SRCSET_WIDTHS = [480, 720, 960, 1200, 1920];

/**
 * Mobile LCP preload: match the srcset candidate Lighthouse/mobile often picks
 * (~100vw × ~2.5 DPR → 960w) so preload and <picture> do not diverge.
 */
export const HERO_LCP_PRELOAD_WIDTH = 960;

function buildSrcSet(slug, ext) {
  return HERO_SRCSET_WIDTHS.map((w) => `/media/hero/${slug}-${w}w.${ext} ${w}w`).join(', ');
}

const CABIN_SLUG = { summer: 'cabin-summer', winter: 'cabin-winter' };
const VALLEY_SLUG = { summer: 'valley-summer-night', winter: 'valley-winter' };

export function getCabinHeroResponsive(season) {
  const slug = CABIN_SLUG[season] || CABIN_SLUG.summer;
  return {
    slug,
    avifSrcSet: buildSrcSet(slug, 'avif'),
    webpSrcSet: buildSrcSet(slug, 'webp'),
    fallbackSrc: CABIN_MEDIA.heroPoster[season] || CABIN_MEDIA.heroPoster.summer,
    /** Intrinsic dimensions of canonical poster (stable layout). */
    width: 1920,
    height: 1080
  };
}

export function getValleyHeroResponsive(season) {
  const slug = VALLEY_SLUG[season] || VALLEY_SLUG.summer;
  const fallbackSrc =
    season === 'summer'
      ? VALLEY_MEDIA.altSummerPair.poster
      : VALLEY_MEDIA.heroPoster.winter;
  return {
    slug,
    avifSrcSet: buildSrcSet(slug, 'avif'),
    webpSrcSet: buildSrcSet(slug, 'webp'),
    fallbackSrc,
    width: 1920,
    height: 1080
  };
}

/** Same URL the browser will pick for typical mobile viewports (AVIF 720w). */
export function getCabinHeroPreloadUrl(season) {
  const slug = CABIN_SLUG[season] || CABIN_SLUG.summer;
  return `/media/hero/${slug}-${HERO_LCP_PRELOAD_WIDTH}w.avif`;
}

/** Canonical JPG posters for the home mobile stacked hero (must match DualityHero mobile panes). */
export function getHomeHeroMobilePosterUrls(season) {
  const s = season === 'winter' ? 'winter' : 'summer';
  return {
    cabin: CABIN_MEDIA.heroPoster[s] || CABIN_MEDIA.heroPoster.summer,
    valley:
      s === 'summer'
        ? VALLEY_MEDIA.altSummerPair.poster
        : VALLEY_MEDIA.heroPoster.winter
  };
}
