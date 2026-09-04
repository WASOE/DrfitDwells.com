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
  ogImage: '/media/winter/cabin-fire-interior.jpg'
});

export const WINTER_VILLAGE_HERO = Object.freeze({
  eyebrow: 'The first winter at The Valley · December 2026 to March 2027',
  headline: 'This winter, The Valley becomes a village.',
  copy: 'Cabins in the snow. Fire after dark. Sauna and hot tubs under the stars. Come quietly for two nights, join a parent and child adventure, or spend Christmas somewhere your children will never forget.',
  primaryCta: 'Choose your winter',
  secondaryLine: 'Founding presale opening soon'
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
  title: 'Founding presale opening soon',
  body: 'The founding presale is not open yet. Leave this page open for now while we finalise the dates, facilities and booking terms.',
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

/**
 * Page imagery is defined in ./winterVillageMedia.js, not here. The winter Valley
 * footage under /uploads is AI-generated and watermarked, so this page never uses it.
 */

export const WINTER_VILLAGE_PRODUCTS = Object.freeze({
  stay: {
    id: 'stay',
    name: 'Winter Village Stay',
    shortName: 'Stay',
    kicker: 'Winter Village Stay',
    headline: 'Your cabin. Your fire. Your winter.',
    details: 'Self-led · 2 night minimum',
    fromPrice: 'From €150 for two',
    shortDescription:
      'Come for the mountain, the snow and the silence. Your accommodation is private. The winter village is shared.',
    purpose:
      'A normal accommodation stay inside the winter atmosphere. It is not fully hosted and does not include daily food, guides or organised entertainment.',
    description:
      'Come for the mountain, the snow and the silence. Your accommodation is private. The winter village is shared.',
    durationLabel: 'Flexible stay',
    nightsFixed: null,
    minNights: 2,
    defaultNights: 2,
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
    actionLabel: 'Join the founding presale',
    depositRule: 'stay'
  },
  'parent-child': {
    id: 'parent-child',
    name: 'Parent & Child Winter Weekend',
    shortName: 'Parent & Child',
    kicker: 'Parent & Child Weekend',
    headline: 'Two days away from everything except each other.',
    details: 'Hosted · 3 days / 2 nights',
    fromPrice: 'From €260 for two',
    shortDescription:
      'A small winter adventure with the transport, food and main activities already organised.',
    purpose:
      'A hosted weekend designed specifically around the two-person A-frames and Luxury Cabin.',
    description:
      'A small winter adventure with the transport, food and main activities already organised.',
    durationLabel: '3 days and 2 nights',
    nightsFixed: 2,
    minNights: 2,
    defaultNights: 2,
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
    actionLabel: 'Join the founding presale',
    depositRule: 'stay'
  },
  christmas: {
    id: 'christmas',
    name: 'Christmas in the Valley',
    shortName: 'Christmas',
    kicker: 'Christmas in the Valley',
    headline: 'The Christmas they will talk about for years.',
    details: 'Fully hosted · 4 days / 3 nights',
    fromPrice: 'From €490 for two',
    shortDescription:
      'Three nights of snow, fires, shared food, Santa, presents and a Christmas morning built around the children.',
    purpose: 'The flagship hosted Winter Village event.',
    description:
      'Three nights of snow, fires, shared food, Santa, presents and a Christmas morning built around the children.',
    durationLabel: '4 days and 3 nights',
    nightsFixed: 3,
    minNights: 3,
    defaultNights: 3,
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
    actionLabel: 'Join the founding presale',
    depositRule: 'christmas'
  }
});

export const WINTER_VILLAGE_PRODUCT_ORDER = Object.freeze([
  'stay',
  'parent-child',
  'christmas'
]);

export const WINTER_VILLAGE_FOUNDING = Object.freeze({
  headline: 'You are not donating. You are booking the winter that helps build it.',
  copy: 'The first Winter Village reservations fund the shared sauna, two wood-fired hot tubs, winter lighting and the heated family space. You secure a real stay at the founding price. We use the presale to finish the village before winter.',
  targetLabel: '€15,000 winter build target',
  statusLabel: 'Planned for the founding winter',
  items: [
    { title: 'A shared sauna' },
    { title: 'Two wood-fired hot tubs' },
    { title: 'A heated family fire room' },
    { title: 'Safe winter lighting and paths' }
  ]
});

export const WINTER_VILLAGE_CHRISTMAS_FEATURE = Object.freeze({
  headline: 'The morning they remember.',
  copy: 'Presents waiting outside the cabins. Santa arriving through the snow. Children from the nearby village joining the celebration. Breakfast by the fire. One shared Christmas, far away from the hotel version of it.',
  moments: [
    'Christmas Eve feast',
    'Santa and presents',
    'Family snow day',
    'Sauna and hot-tub session',
    'Shared film night',
    'Proposed family film of the stay'
  ],
  cta: 'Choose Christmas'
});

export const WINTER_VILLAGE_PARENT_FEATURE = Object.freeze({
  headline: 'Nothing to organise. Nowhere else to be.',
  copy: 'We collect you, bring you into the mountains and organise the important parts. Two nights, shared meals, snow activities, fire and time together.',
  flow: ['Arrive', 'Eat', 'Explore', 'Warm up', 'Sleep', 'Do it again']
});

export const WINTER_VILLAGE_CLOSE = Object.freeze({
  headline: 'Winter is being built now.',
  copy: 'Choose the experience you want. When the founding presale opens, you will be able to secure the first dates.',
  cta: 'Choose your winter'
});

export const WINTER_VILLAGE_DATES = Object.freeze({
  sectionLabel: 'First dates to be released',
  intro: 'These are the first dates we intend to release. They are not live availability.',
  selectLabel: 'Select package',
  items: [
    {
      id: 'opening',
      label: '11 to 13 December 2026',
      title: 'Winter Village Opening',
      productId: 'stay',
      mode: 'Self-led',
      duration: '2 nights',
      fromPrice: 'From €150'
    },
    {
      id: 'christmas',
      label: '24 to 27 December 2026',
      title: 'Christmas in the Valley',
      productId: 'christmas',
      mode: 'Fully hosted',
      duration: '4 days / 3 nights',
      fromPrice: 'From €490'
    },
    {
      id: 'parent-child-jan',
      label: '15 to 17 January 2027',
      title: 'Parent & Child Weekend',
      productId: 'parent-child',
      mode: 'Hosted',
      duration: '3 days / 2 nights',
      fromPrice: 'From €260'
    },
    {
      id: 'deep-winter',
      label: '12 to 14 February 2027',
      title: 'Deep Winter Weekend',
      productId: 'parent-child',
      mode: 'Hosted',
      duration: '3 days / 2 nights',
      fromPrice: 'From €260'
    }
  ]
});

export const WINTER_VILLAGE_FAQ = Object.freeze([
  {
    id: 'hosted',
    question: 'Is the whole winter hosted?',
    answer:
      'No. Winter Village Stay is self-led accommodation. Food, transport and organised activities are included only in the Parent & Child Weekend and Christmas packages.'
  },
  {
    id: 'presale',
    question: 'What is included in the presale?',
    answer:
      'A real stay at the founding price. The first reservations fund the shared sauna, two wood-fired hot tubs, heated family fire room and winter lighting. Payment is not open yet.'
  },
  {
    id: 'sauna',
    question: 'Are the sauna and hot tubs already built?',
    answer:
      'Not yet. They are planned for the founding winter. Final confirmation depends on supplier quotes, installation and the launch budget.'
  },
  {
    id: 'family-aframe',
    question: 'Can a family of four use the A-frames?',
    answer:
      'One A-frame sleeps two. A family of four can reserve two neighbouring A-frames or choose the Stone House.'
  },
  {
    id: 'payment',
    question: 'When will payment open?',
    answer:
      'When the founding presale opens — after dates, facilities and booking terms are finalised. This page does not take payment.'
  }
]);

export function getWinterVillageProduct(productId) {
  return WINTER_VILLAGE_PRODUCTS[productId] || WINTER_VILLAGE_PRODUCTS.stay;
}

export function getWinterVillageAccommodation(accommodationId) {
  return (
    WINTER_VILLAGE_ACCOMMODATIONS.find((item) => item.id === accommodationId) ||
    WINTER_VILLAGE_ACCOMMODATIONS[0]
  );
}
