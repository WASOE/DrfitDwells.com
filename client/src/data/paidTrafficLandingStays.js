/**
 * Paid-traffic landing: routing + emergency fallbacks only. Copy lives in i18n (`seo` → paidStaysBulgaria).
 * Cover images resolve from listing API via `listingSlug`.
 */

export const PAID_TRAFFIC_STAY_META = [
  {
    id: 'the-cabin',
    listingSlug: 'the-cabin',
    route: '/stays/the-cabin',
    fallbackImage: '/uploads/Content%20website/drift-dwells-bulgaria-bucephalus-suite.avif',
    showDetailsLink: true
  },
  {
    id: 'valley-a-frame',
    listingSlug: 'a-frame',
    route: '/stays/a-frame',
    fallbackImage: '/uploads/The%20Valley/WhatsApp%20Image%202025-10-17%20at%2010.20.24%20AM%20(4).jpeg',
    showDetailsLink: false
  },
  {
    id: 'valley-stone-house',
    listingSlug: 'stone-house',
    route: '/stays/stone-house',
    fallbackImage: '/uploads/The%20Valley/WhatsApp%20Image%202025-10-17%20at%2010.20.24%20AM.jpeg',
    showDetailsLink: true
  },
  {
    id: 'valley-lux-cabin',
    listingSlug: 'lux-cabin',
    route: '/stays/lux-cabin',
    fallbackImage: '/uploads/The%20Valley/Lux-cabin-exterior-watermark-remover-20260113071503.jpg',
    showDetailsLink: true
  }
];
