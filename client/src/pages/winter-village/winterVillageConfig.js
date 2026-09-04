/**
 * Central Winter Village configuration.
 * Proposed seasonal rates and package data only — does not affect live accommodation pricing.
 */
import { STAY_CARDS } from '../the-valley/data';
import { VALLEY_STAY_SELECTOR_META } from '../../data/valleyStaySelectorMeta';

const stayBySlug = Object.fromEntries(
  STAY_CARDS.filter((card) => card.listingSlug).map((card) => [card.listingSlug, card])
);

const metaBySlug = Object.fromEntries(
  VALLEY_STAY_SELECTOR_META.map((meta) => [meta.listingSlug, meta])
);

/** @typedef {'a-frame' | 'lux-cabin' | 'stone-house'} AccommodationId */
/** @typedef {'stay' | 'parent-child' | 'christmas'} ProductId */

export const WINTER_VILLAGE_SEO = Object.freeze({
  title: 'The Valley Winter Village | Drift & Dwells',
  description:
    'A whole winter of fire, snow and mountain silence in the Rhodope Mountains. Stay simply, join a hosted Parent & Child weekend, or come for Christmas in the Valley. December 2026 to March 2027.',
  canonicalPath: '/winter-village',
  ogImage: '/uploads/Videos/The-Valley-firaplace-video.winter-poster.jpg'
});

export const WINTER_VILLAGE_HERO = Object.freeze({
  headline: 'The Valley Winter Village',
  copy: 'A whole winter of fire, snow and mountain silence. Stay simply, join a hosted family weekend, or come for Christmas.',
  seasonLabel: 'December 2026 to March 2027',
  locationLabel: 'Rhodope Mountains, Bulgaria',
  primaryCta: 'Explore winter packages',
  previewNotice: 'Winter Village concept preview. Proposed prices and dates. No payment is taken.'
});

export const WINTER_VILLAGE_DEPOSIT = Object.freeze({
  depositPercent: 30,
  balanceDaysBeforeStay: 30,
  balanceDaysBeforeChristmas: 45,
  stayBalanceLabel: 'Remaining balance 30 days before normal stays',
  christmasBalanceLabel: 'Christmas balance 45 days before arrival',
  depositLabel: '30% deposit to reserve'
});

export const WINTER_VILLAGE_PREVIEW_MODAL = Object.freeze({
  title: 'Reservation coming soon',
  body: 'This is currently a Winter Village preview. The reservation and presale system will be activated after the packages, facilities and dates are confirmed.',
  closeLabel: 'Close'
});

/** Child age bands used by hosted Stone House pricing. */
export const CHILD_AGE_RULES = Object.freeze({
  freeUnderAge: 4,
  childMinAge: 4,
  childMaxAge: 12
});

/**
 * Accommodation options reuse Valley stay IDs / routes / images.
 * Winter Village rates are proposed seasonal prices only.
 */
export const WINTER_VILLAGE_ACCOMMODATIONS = Object.freeze([
  {
    id: 'a-frame',
    listingSlug: 'a-frame',
    name: stayBySlug['a-frame']?.title || 'A-frame',
    route: metaBySlug['a-frame']?.route || '/stays/a-frame',
    sleepsLabel: 'Sleeps 2',
    sleeps: 2,
    image: metaBySlug['a-frame']?.fallbackImage || stayBySlug['a-frame']?.fallbackImage,
    imagePath: stayBySlug['a-frame']?.imagePath,
    note: 'One A-frame sleeps two. A family of four can reserve two neighbouring A-frames or choose the Stone House.'
  },
  {
    id: 'lux-cabin',
    listingSlug: 'lux-cabin',
    name: stayBySlug['lux-cabin']?.title || 'Luxury Cabin',
    route: metaBySlug['lux-cabin']?.route || '/stays/lux-cabin',
    sleepsLabel: 'Sleeps 2',
    sleeps: 2,
    image: metaBySlug['lux-cabin']?.fallbackImage || stayBySlug['lux-cabin']?.fallbackImage,
    imagePath: stayBySlug['lux-cabin']?.imagePath,
    note: null
  },
  {
    id: 'stone-house',
    listingSlug: 'stone-house',
    name: stayBySlug['stone-house']?.title || 'Stone House',
    route: metaBySlug['stone-house']?.route || '/stays/stone-house',
    sleepsLabel: 'Sleeps 3–6',
    sleepsMin: 3,
    sleepsMax: 6,
    image: metaBySlug['stone-house']?.fallbackImage || stayBySlug['stone-house']?.fallbackImage,
    imagePath: stayBySlug['stone-house']?.imagePath,
    note: 'Ideal for families who want everyone under one roof.'
  }
]);

export const WINTER_VILLAGE_PRODUCTS = Object.freeze({
  stay: {
    id: 'stay',
    name: 'Winter Village Stay',
    shortName: 'Stay',
    purpose:
      'A normal accommodation stay inside the winter atmosphere. It is not fully hosted and does not include daily food, guides or organised entertainment.',
    description:
      'Book your accommodation and add only what you want. Enjoy the Winter Village atmosphere without paying for a full retreat programme.',
    durationLabel: 'Flexible stay',
    nightsFixed: null,
    minNights: 2,
    defaultNights: 2,
    image:
      metaBySlug['a-frame']?.fallbackImage ||
      '/uploads/The%20Valley/WhatsApp%20Image%202025-10-17%20at%2010.20.24%20AM%20(4).jpeg',
    imageAlt: 'A-frame cabin in The Valley winter landscape',
    included: [
      'Winter Village lighting',
      'Sledges',
      'Heated family fire room',
      'Self-guided winter trails',
      'Access to shared winter areas'
    ],
    pricing: {
      type: 'per-night',
      units: {
        'a-frame': { ratePerNight: 75, guestsFixed: 2 },
        'lux-cabin': { ratePerNight: 110, guestsFixed: 2 },
        'stone-house': {
          ratePerPersonPerNight: 30,
          minGuests: 3,
          maxGuests: 6,
          defaultGuests: 3
        }
      },
      wellnessOptional: {
        id: 'private-wellness',
        label: 'Private sauna and hot-tub session',
        pricePerBooking: 45
      }
    },
    actionLabel: 'Express interest',
    depositRule: 'stay'
  },
  'parent-child': {
    id: 'parent-child',
    name: 'Parent & Child Winter Weekend',
    shortName: 'Parent & Child',
    purpose:
      'A hosted weekend designed specifically around the two-person A-frames and Luxury Cabin.',
    description:
      'Three winter days for one parent and one child, with the accommodation, transport, food and main activities already organised.',
    durationLabel: '3 days and 2 nights',
    nightsFixed: 2,
    minNights: 2,
    defaultNights: 2,
    image:
      '/uploads/Content%20website/drift-dwells-bulgaria-fireside-lounge.avif',
    imageAlt: 'Fireside lounge at Drift & Dwells',
    included: [
      '2 nights',
      'Breakfast and dinner',
      'Return transport to The Valley',
      'Guided snow activity',
      'Sauna and hot-tub session',
      'Fireside evening',
      'Parent and child activity',
      'Sledges and winter equipment'
    ],
    pricing: {
      type: 'package',
      units: {
        'a-frame': { packagePrice: 260, guestsFixed: 2 },
        'lux-cabin': { packagePrice: 350, guestsFixed: 2 },
        'stone-house': {
          adultPrice: 130,
          childPrice: 60,
          under4Free: true,
          minOccupancy: 3,
          maxOccupancy: 6,
          defaultAdults: 2,
          defaultChildren4to12: 1,
          defaultUnder4: 0
        }
      }
    },
    actionLabel: 'Express interest',
    depositRule: 'stay'
  },
  christmas: {
    id: 'christmas',
    name: 'Christmas in the Valley',
    shortName: 'Christmas',
    purpose: 'The flagship hosted Winter Village event.',
    description:
      'Christmas without the hotel feeling. Three nights in a small mountain village with shared food, fires, family activities and a real Christmas programme.',
    durationLabel: '4 days and 3 nights',
    nightsFixed: 3,
    minNights: 3,
    defaultNights: 3,
    image:
      '/uploads/The%20Valley/WhatsApp%20Image%202025-10-17%20at%2010.20.23%20AM.jpeg',
    imageAlt: 'The Valley mountain village in winter light',
    included: [
      '3 nights',
      'Breakfast and dinner',
      'Christmas Eve feast',
      'Santa visit',
      'Presents for the children',
      'Family snow day',
      'Return transport to The Valley',
      'Sauna and hot-tub session',
      'Fireside activities',
      'Shared family film night',
      'A short family film of the experience (proposed — pending cinematographer confirmation)'
    ],
    pricing: {
      type: 'package',
      units: {
        'a-frame': { packagePrice: 490, guestsFixed: 2 },
        'lux-cabin': { packagePrice: 590, guestsFixed: 2 },
        'stone-house': {
          adultPrice: 180,
          childPrice: 90,
          under4Free: true,
          minOccupancy: 3,
          maxOccupancy: 6,
          defaultAdults: 2,
          defaultChildren4to12: 1,
          defaultUnder4: 0
        }
      }
    },
    actionLabel: 'Express interest',
    depositRule: 'christmas'
  }
});

export const WINTER_VILLAGE_PRODUCT_ORDER = Object.freeze([
  'stay',
  'parent-child',
  'christmas'
]);

export const WINTER_VILLAGE_FACILITIES = Object.freeze({
  title: 'Planned for the Winter Village season',
  intro:
    'These facilities are proposed for the founding Winter Village season. Final confirmation depends on supplier quotes, installation and the launch budget. The hill itself remains untouched.',
  statusLabel: 'Planned for the Winter Village season.',
  items: [
    'Shared sauna',
    'Two wood-fired hot tubs',
    'Heated family fire room',
    'Safe illuminated winter paths',
    'Sledges',
    'Hot drinks and board games',
    'Family film evenings',
    'Space for drying winter clothing'
  ]
});

export const WINTER_VILLAGE_DATES = Object.freeze({
  sectionLabel: 'Proposed first release dates',
  intro: 'These dates are proposed for the first Winter Village release. They are not connected to live availability yet.',
  items: [
    {
      id: 'opening',
      label: '11 to 13 December 2026',
      title: 'Winter Village Opening',
      productId: 'stay'
    },
    {
      id: 'christmas',
      label: '24 to 27 December 2026',
      title: 'Christmas in the Valley',
      productId: 'christmas'
    },
    {
      id: 'parent-child-jan',
      label: '15 to 17 January 2027',
      title: 'Parent & Child Weekend',
      productId: 'parent-child'
    },
    {
      id: 'deep-winter',
      label: '12 to 14 February 2027',
      title: 'Deep Winter Weekend',
      productId: 'parent-child'
    }
  ]
});

export const WINTER_VILLAGE_FAQ = Object.freeze([
  {
    id: 'hosted',
    question: 'Is the whole winter fully hosted?',
    answer:
      'No. Normal Winter Village stays are accommodation-led. Food, guides and organised family activities are only included in the hosted packages.'
  },
  {
    id: 'family-aframe',
    question: 'Can a family of four stay in an A-frame?',
    answer:
      'One A-frame sleeps two. A family of four can reserve two neighbouring A-frames or choose the Stone House.'
  },
  {
    id: 'sauna',
    question: 'Are the sauna and hot tubs already confirmed?',
    answer:
      'They are planned parts of the Winter Village product. Final confirmation depends on supplier quotes, installation and the launch budget.'
  },
  {
    id: 'prices',
    question: 'Are these final prices and dates?',
    answer:
      'No. These are proposed launch prices and dates being tested before the presale opens.'
  },
  {
    id: 'transport',
    question: 'Is transport included?',
    answer:
      'Transport is included in the Parent & Child Weekend and Christmas packages. It is not automatically included with a normal Winter Village Stay.'
  }
]);

export const WINTER_VILLAGE_ACCOMMODATION_SECTION = Object.freeze({
  title: 'Where you stay',
  intro:
    'One A-frame sleeps two. A family of four can reserve two neighbouring A-frames or choose the Stone House. Neighbouring availability is confirmed only when live calendars show it.'
});

export function getWinterVillageProduct(productId) {
  return WINTER_VILLAGE_PRODUCTS[productId] || WINTER_VILLAGE_PRODUCTS.stay;
}

export function getWinterVillageAccommodation(accommodationId) {
  return (
    WINTER_VILLAGE_ACCOMMODATIONS.find((item) => item.id === accommodationId) ||
    WINTER_VILLAGE_ACCOMMODATIONS[0]
  );
}
