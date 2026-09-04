/**
 * Central Winter Village configuration.
 * Proposed seasonal rates and package data only — does not affect live accommodation pricing.
 * Sales copy source: Winter_Village_Copy_Deck.docx (4 September 2026).
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
  title: 'Winter Cabins & Christmas in Bulgaria | Drift & Dwells',
  description:
    "Stay in a private winter cabin in Bulgaria's Rhodope Mountains. Choose a quiet break, a hosted parent and child weekend, or Christmas in The Valley.",
  ogTitle: "A Winter Village in Bulgaria's Rhodope Mountains",
  ogDescription:
    'Private cabins, shared fires and three ways to experience winter at The Valley, from a quiet two-night stay to a hosted family Christmas.',
  canonicalPath: '/winter-village',
  ogImage: '/media/winter/rhodope-winter-valley-aerial.jpg'
});

export const WINTER_VILLAGE_HERO = Object.freeze({
  eyebrow: 'Winter cabins in the Rhodope Mountains · December 2026 to March 2027',
  headline: 'A winter village above the clouds.',
  copy: "Private cabins, wood fires and shared winter spaces at 1,550m in Bulgaria's Rhodope Mountains. Come for a quiet stay, a hosted weekend with your child, or Christmas in The Valley.",
  primaryCta: 'Choose your winter stay',
  trustLine: 'Private accommodation · Small number of guests · Direct booking',
  selectorTitle: 'Choose your winter stay',
  selectorCta: 'View package',
  selectorFooter: 'Limited first-release dates · Winter 2026/27'
});

export const WINTER_VILLAGE_DEPOSIT = Object.freeze({
  depositPercent: 30,
  balanceDaysBeforeStay: 30,
  balanceDaysBeforeChristmas: 45,
  stayBalanceLabel: 'Remaining balance 30 days before a Winter Cabin Stay',
  christmasBalanceLabel: 'Remaining balance 45 days before Christmas',
  depositLabel: '30% deposit to reserve',
  termsHeading: 'How booking will work',
  termsBody:
    'The planned booking deposit is 30%. The remaining balance will be due 30 days before a Winter Cabin Stay and 45 days before Christmas. Final payment and cancellation terms will be shown before you reserve.',
  previewNote: 'Booking is not open yet. No payment is taken on this page.'
});

export const WINTER_VILLAGE_PREVIEW_MODAL = Object.freeze({
  title: 'Winter bookings are opening soon.',
  body: 'Bookings are not open yet. Check back when confirmed dates and package details are published.',
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
    note: 'One A-frame sleeps two. A family of four can reserve two neighbouring A-frames or choose the Stone House.',
    stayRateLabel: '€75 per night'
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
    note: null,
    stayRateLabel: '€110 per night'
  },
  {
    id: 'stone-house',
    listingSlug: 'stone-house',
    name: stayBySlug['stone-house']?.title || 'Stone House',
    route: metaBySlug['stone-house']?.route || '/stays/stone-house',
    sleepsLabel: 'Sleeps 3 to 6',
    sleepsMin: 3,
    sleepsMax: 6,
    image: metaBySlug['stone-house']?.fallbackImage || stayBySlug['stone-house']?.fallbackImage,
    imagePath: stayBySlug['stone-house']?.imagePath,
    note: 'Ideal for families who want everyone under one roof.',
    stayRateLabel: '€30 per person, per night · €90 nightly minimum'
  }
]);

/**
 * Page imagery is defined in ./winterVillageMedia.js, not here. The winter Valley
 * footage under /uploads is AI-generated and watermarked, so this page never uses it.
 */

export const WINTER_VILLAGE_PRODUCTS = Object.freeze({
  stay: {
    id: 'stay',
    name: 'Winter Cabin Stay',
    shortName: 'Cabin Stay',
    kicker: 'Winter Cabin Stay',
    headline: 'Your own cabin in the winter mountains.',
    details: 'Private and self-led · 2-night minimum',
    fromPrice: 'From €150 for two',
    commercialLine: 'Self-led · 2-night minimum · From €150 for two',
    shortDescription:
      'Stay independently in an A-frame, the Luxury Cabin or the Stone House. Spend the day walking, reading or exploring the snow, then return to a warm private stay, the communal fire and dark mountain skies.',
    purpose:
      'A normal accommodation stay inside the winter atmosphere. It is not fully hosted and does not include daily food, guides or organised entertainment.',
    description:
      'Stay independently in an A-frame, the Luxury Cabin or the Stone House. Spend the day walking, reading or exploring the snow, then return to a warm private stay, the communal fire and dark mountain skies.',
    durationLabel: 'Flexible stay',
    nightsFixed: null,
    minNights: 2,
    defaultNights: 2,
    included: [
      'Private heated accommodation',
      'Access to shared outdoor fire and winter areas',
      'Sledges when conditions allow',
      'Self-guided walking routes',
      'Arrival support and winter directions'
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
      // Kept for calculator tests; not shown as purchasable until facilities are confirmed.
      wellnessOptional: {
        id: 'private-wellness',
        label: 'Scheduled private sauna and hot-tub session',
        pricePerBooking: 45,
        purchasable: false
      }
    },
    cardCta: 'Build your stay',
    actionLabel: 'Booking opens soon',
    depositRule: 'stay'
  },
  'parent-child': {
    id: 'parent-child',
    name: 'Parent & Child Winter Weekend',
    shortName: 'Parent & Child',
    kicker: 'Parent & Child Winter Weekend',
    headline: 'A real weekend together, with the planning done.',
    details: 'Hosted · 3 days / 2 nights',
    fromPrice: 'From €260 for two',
    commercialLine: 'Hosted · 3 days / 2 nights · From €260 for two',
    shortDescription:
      'One adult and one child, two nights in the mountains. The transfer from the designated parking area, breakfast, dinner and the main winter activities are organised, so your attention can stay on each other.',
    purpose:
      'A hosted weekend designed specifically around the two-person A-frames and Luxury Cabin.',
    description:
      'One adult and one child, two nights in the mountains. The transfer from the designated parking area, breakfast, dinner and the main winter activities are organised, so your attention can stay on each other.',
    durationLabel: '3 days and 2 nights',
    nightsFixed: 2,
    minNights: 2,
    defaultNights: 2,
    included: [
      'Two nights in the selected accommodation',
      'Breakfast and dinner',
      'Return mountain transfer between the designated parking area and The Valley',
      'Guided snow or forest activity, depending on conditions',
      'Fireside evening and parent-and-child activity',
      'Sledges and winter equipment',
      'Scheduled sauna and hot-tub session, subject to final facility confirmation'
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
    cardCta: 'View the weekend',
    actionLabel: 'Booking opens soon',
    depositRule: 'stay'
  },
  christmas: {
    id: 'christmas',
    name: 'Christmas in The Valley',
    shortName: 'Christmas',
    kicker: 'Christmas in The Valley',
    headline: 'A small mountain Christmas built around the children.',
    details: 'Fully hosted · 4 days / 3 nights',
    fromPrice: 'From €490 for two',
    commercialLine: 'Fully hosted · 4 days / 3 nights · From €490 for two',
    shortDescription:
      'Three nights in a private stay, with shared festive meals, winter activities, Santa and presents, plus time for your own family. No hotel crowds and no packed programme, just a few families sharing the Valley.',
    purpose: 'The flagship hosted Winter Village event.',
    description:
      'Three nights in a private stay, with shared festive meals, winter activities, Santa and presents, plus time for your own family. No hotel crowds and no packed programme, just a few families sharing the Valley.',
    durationLabel: '4 days and 3 nights',
    nightsFixed: 3,
    minNights: 3,
    defaultNights: 3,
    included: [
      'Three nights in the selected accommodation',
      'Breakfast and dinner',
      'Christmas Eve feast',
      'Santa visit and presents for the children',
      'Family snow day, weather permitting',
      'Return mountain transfer between the designated parking area and The Valley',
      'Fireside activities and shared family film night',
      'Scheduled sauna and hot-tub session, subject to final facility confirmation'
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
    cardCta: 'View Christmas',
    actionLabel: 'Booking opens soon',
    depositRule: 'christmas'
  }
});

export const WINTER_VILLAGE_PRODUCT_ORDER = Object.freeze([
  'stay',
  'parent-child',
  'christmas'
]);

export const WINTER_VILLAGE_WAYS = Object.freeze({
  eyebrow: 'Three winter experiences',
  headline: 'Choose how you want to stay.',
  copy: 'Come for a quiet cabin weekend, a hosted trip with your child, or a small family Christmas in the mountains. Every stay starts with a private place to sleep and the shared Valley outside your door.'
});

/** Replaces the deleted €15,000 / founding-presale block. */
export const WINTER_VILLAGE_PREPARE = Object.freeze({
  eyebrow: 'Preparing The Valley for winter',
  headline: 'Warm where it matters. Wild everywhere else.',
  copy: 'The Valley is being prepared for safe, comfortable winter stays at 1,550m. Before reservations open, every package will show the confirmed accommodation, access, meals, activities and wellness included in its price.',
  transparencyNote:
    'Planned facilities are not yet bookable. Final facilities and operating details will be confirmed before payment opens.',
  items: [
    {
      title: 'Warm private stays',
      copy: 'Reliable heating and hot water in every confirmed accommodation.'
    },
    {
      title: 'Winter access',
      copy: 'Clear arrival instructions and suitable mountain transfer when it is included in the package.'
    },
    {
      title: 'Shared winter wellness',
      copy: 'A sauna and two wood-fired hot tubs are planned for scheduled guest sessions.'
    },
    {
      title: 'Space for families',
      copy: 'A heated common room, lit paths and sledges are planned for the season.'
    }
  ]
});

export const WINTER_VILLAGE_CALCULATOR = Object.freeze({
  eyebrow: 'Price your stay',
  headline: 'Choose your winter package.',
  copy: 'Select the experience, accommodation and group size to see the full planned price. No payment is taken on this page.',
  statusNote:
    'These are planned opening prices. Final inclusions and booking terms will be confirmed before reservations open.',
  summaryLabel: 'Your stay',
  totalLabel: 'Total for this stay'
});

export const WINTER_VILLAGE_CHRISTMAS_FEATURE = Object.freeze({
  eyebrow: '24 to 27 December 2026',
  headline: 'Christmas in the Rhodope Mountains.',
  copy: 'Arrive on Christmas Eve and settle into your own cabin or the Stone House. Share dinner by the fire, wake to presents outside the cabins and spend Christmas Day between the snow, warm food and time together.',
  moments: [
    'Three nights in your selected accommodation',
    'Breakfast and dinner',
    'Christmas Eve feast',
    'Santa visit and presents for the children',
    'Family snow day, weather permitting',
    'Return mountain transfer between the designated parking area and The Valley',
    'Fireside activities and a shared family film night',
    'Scheduled sauna and hot-tub session, subject to final facility confirmation'
  ],
  cta: 'See the Christmas package'
});

export const WINTER_VILLAGE_PARENT_FEATURE = Object.freeze({
  eyebrow: 'Hosted winter weekend',
  headline: 'A parent and child weekend in the mountains.',
  copy: 'Leave the logistics to us. We bring you from the designated parking area into The Valley, organise the main activities and share breakfast and dinner. The rest is time to explore, warm up and be together.',
  flow: [
    'Friday: Mountain transfer, settle in and dinner by the fire.',
    'Saturday: Breakfast, a guided snow or forest activity, time to warm up, and a shared evening.',
    'Sunday: Slow breakfast, one last walk or play outside, and transfer back to the parking area.'
  ],
  conditionsNote: 'Outdoor activities change with snow and weather conditions.',
  cta: 'See the weekend'
});

export const WINTER_VILLAGE_CLOSE = Object.freeze({
  eyebrow: 'Winter 2026/27',
  headline: 'Choose your winter in The Valley.',
  copy: 'Private cabin, hosted weekend or Christmas with the family. See the package and price for the date you want.',
  cta: 'Choose your winter stay'
});

export const WINTER_VILLAGE_DATES = Object.freeze({
  eyebrow: 'Winter 2026/27',
  sectionLabel: 'Choose a weekend or Christmas stay.',
  intro:
    'These are the first dates planned for release. Select a date to see the matching package and price. They are not live availability yet.',
  items: [
    {
      id: 'opening',
      label: '11 to 13 December 2026',
      title: 'Winter Village Opening Weekend',
      productId: 'stay',
      mode: 'Self-led',
      duration: '2 nights',
      fromPrice: 'From €150',
      selectLabel: 'See this stay'
    },
    {
      id: 'christmas',
      label: '24 to 27 December 2026',
      title: 'Christmas in The Valley',
      productId: 'christmas',
      mode: 'Fully hosted',
      duration: '4 days / 3 nights',
      fromPrice: 'From €490',
      selectLabel: 'See Christmas'
    },
    {
      id: 'parent-child-jan',
      label: '15 to 17 January 2027',
      title: 'Parent & Child Winter Weekend',
      productId: 'parent-child',
      mode: 'Hosted',
      duration: '3 days / 2 nights',
      fromPrice: 'From €260',
      selectLabel: 'See the weekend'
    },
    {
      id: 'deep-winter',
      label: '12 to 14 February 2027',
      title: 'Deep Winter Parent & Child Weekend',
      productId: 'parent-child',
      mode: 'Hosted',
      duration: '3 days / 2 nights',
      fromPrice: 'From €260',
      selectLabel: 'See the weekend'
    }
  ]
});

export const WINTER_VILLAGE_FAQ = Object.freeze({
  eyebrow: 'Plan your winter stay',
  headline: 'Winter Village questions',
  items: [
    {
      id: 'what-is',
      question: 'What is the Valley Winter Village?',
      answer:
        "The Valley is a small off-grid mountain stay near Chereshovo in Bulgaria's Rhodope Mountains. From December 2026 to March 2027, guests can choose a private winter cabin stay, a hosted parent and child weekend, or a hosted family Christmas."
    },
    {
      id: 'hosted',
      question: 'Is every winter stay hosted?',
      answer:
        'No. Winter Cabin Stays are self-led. Breakfast, dinner, mountain transfer and organised activities are included only in the Parent & Child and Christmas packages where listed.'
    },
    {
      id: 'accommodation',
      question: 'What accommodation can I book?',
      answer:
        'Choose an A-frame for two, the Luxury Cabin for two, or the Stone House for three to six guests. A family of four can reserve two neighbouring A-frames or choose the Stone House.'
    },
    {
      id: 'access',
      question: 'How do we reach The Valley in winter?',
      answer:
        'In normal conditions, guests drive to the designated parking area near Chereshovo. The Valley is approximately 2.5 km beyond it. Do not drive a normal car past the parking point. Hosted packages include suitable mountain transfer. Self-led arrival and transfer details are confirmed with each booking.'
    },
    {
      id: 'snow',
      question: 'Are snow activities guaranteed?',
      answer:
        'No. The Valley is at 1,550m, but snowfall and mountain conditions are natural and cannot be guaranteed. Outdoor activities are adapted to the conditions.'
    },
    {
      id: 'sauna',
      question: 'Are the sauna and hot tubs included?',
      answer:
        'A shared sauna and two wood-fired hot tubs are planned for Winter 2026/27. Each package will state the exact session included before booking opens. They will not be sold as confirmed until installation and operating details are complete.'
    },
    {
      id: 'parent-included',
      question: 'What is included in the Parent & Child Weekend?',
      answer:
        'The planned package includes two nights, breakfast and dinner, return mountain transfer, a guided outdoor activity, fireside time, a parent-and-child activity, and a scheduled wellness session once the facilities are confirmed.'
    },
    {
      id: 'christmas-included',
      question: 'What is included at Christmas?',
      answer:
        'The planned package includes three nights, breakfast and dinner, a Christmas Eve feast, Santa and presents for the children, a family snow day when conditions allow, return mountain transfer, fireside activities and a scheduled wellness session once confirmed.'
    },
    {
      id: 'payment',
      question: 'How will payment work?',
      answer:
        'The planned deposit is 30%. The remaining balance will be due 30 days before a normal winter stay and 45 days before Christmas. Final payment, cancellation and refund terms will be shown before booking.'
    },
    {
      id: 'open',
      question: 'When do reservations open?',
      answer:
        'Reservations will open after the dates, facilities, inclusions and booking terms are confirmed. No payment is taken on this preview page.'
    }
  ]
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
