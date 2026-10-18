/**
 * Paid-traffic landing: routing plus the uploaded-photo gallery used by the
 * AI Search page. Copy lives in i18n (`seo` → paidStaysBulgaria).
 */

export const PAID_TRAFFIC_STAY_META = [
  {
    id: 'the-cabin',
    listingSlug: 'the-cabin',
    route: '/stays/the-cabin',
    fallbackImage: '/media/seo/aframe-bedroom-winter.jpeg',
    galleryImages: [
      { url: '/media/seo/aframe-bedroom-winter.jpeg', alt: 'A-frame bedroom' },
      { url: '/media/seo/aframe-winter-site.jpeg', alt: 'A-frame winter setting' }
    ],
    showDetailsLink: true
  },
  {
    id: 'valley-a-frame',
    listingSlug: 'a-frame',
    route: '/stays/a-frame',
    fallbackImage: '/media/seo/aframe-row-sunset.png',
    galleryImages: [
      { url: '/media/seo/aframe-row-sunset.png', alt: 'A-frame cabins in the valley' },
      { url: '/media/seo/aframe-site-wide.jpeg', alt: 'A-frame site' }
    ],
    showDetailsLink: false
  },
  {
    id: 'valley-lux-cabin',
    listingSlug: 'lux-cabin',
    route: '/stays/lux-cabin',
    fallbackImage: '/media/seo/aframe-field-sunset.jpeg',
    galleryImages: [
      { url: '/media/seo/aframe-field-sunset.jpeg', alt: 'A-frame in the field' },
      { url: '/media/seo/stone-house-sunset-site.jpeg', alt: 'Stone House and valley site' }
    ],
    showDetailsLink: true
  },
  {
    id: 'valley-stone-house',
    listingSlug: 'stone-house',
    route: '/stays/stone-house',
    fallbackImage: '/media/seo/stone-house-winter-wide.jpeg',
    galleryImages: [
      { url: '/media/seo/stone-house-winter-wide.jpeg', alt: 'Stone House in winter' },
      { url: '/media/seo/stone-house-sunset-site.jpeg', alt: 'Stone House and A-frames' }
    ],
    showDetailsLink: true
  }
];
