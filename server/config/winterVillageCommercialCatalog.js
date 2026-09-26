'use strict';

/**
 * Server-owned Winter Village commercial catalog.
 *
 * This is a mapping to existing RatePlan identities, not a second pricing
 * engine. The RatePlan documents remain the persisted source of truth; this
 * catalog gives the future UI/route a stable product/date lookup.
 */

const PAYMENT_TERM_CODE = 'split-40-60-30d';
const PAYMENT_TERM_VERSION = 1;
const CANCELLATION_POLICY_CODE = 'normal-stay-standard';
const CANCELLATION_POLICY_VERSION = 1;

const WINTER_VILLAGE_INVENTORY = Object.freeze({
  'a-frame': Object.freeze({ entityType: 'cabinType', lookup: Object.freeze({ slug: 'a-frame', name: 'A-Frame' }) }),
  'lux-cabin': Object.freeze({ entityType: 'cabin', lookup: Object.freeze({ slug: 'lux-cabin', name: 'Lux Cabin' }) }),
  'stone-house': Object.freeze({ entityType: 'cabin', lookup: Object.freeze({ slug: 'stone-house', name: 'Stone House' }) })
});

const WINTER_VILLAGE_PRODUCTS = Object.freeze({
  stay: Object.freeze({
    productId: 'stay',
    kind: 'seasonal_stay',
    ratePlanCode: 'winter-cabin-stay-2026-27',
    ratePlanVersion: 2,
    displayName: 'Winter Cabin Stay'
  }),
  'parent-child': Object.freeze({
    productId: 'parent-child',
    kind: 'fixed_package',
    offers: Object.freeze([
      Object.freeze({
        offerId: 'parent-child-2026-12',
        ratePlanCode: 'parent-child-2026-12',
        ratePlanVersion: 1,
        checkIn: '2026-12-11',
        checkOut: '2026-12-13'
      }),
      Object.freeze({
        offerId: 'parent-child-2027-01',
        ratePlanCode: 'parent-child-2027-01',
        ratePlanVersion: 1,
        checkIn: '2027-01-15',
        checkOut: '2027-01-17'
      }),
      Object.freeze({
        offerId: 'parent-child-2027-02',
        ratePlanCode: 'parent-child-2027-02',
        ratePlanVersion: 1,
        checkIn: '2027-02-12',
        checkOut: '2027-02-14'
      })
    ]),
    displayName: 'Parent & Child Winter Weekend'
  }),
  christmas: Object.freeze({
    productId: 'christmas',
    kind: 'fixed_package',
    offers: Object.freeze([
      Object.freeze({
        offerId: 'christmas-2026',
        ratePlanCode: 'christmas-2026',
        ratePlanVersion: 1,
        checkIn: '2026-12-24',
        checkOut: '2026-12-27'
      })
    ]),
    displayName: 'Christmas in The Valley'
  })
});

const WINTER_VILLAGE_FIXED_RATE_PLANS = Object.freeze([
  ...WINTER_VILLAGE_PRODUCTS['parent-child'].offers.map((offer) =>
    Object.freeze({
      code: offer.ratePlanCode,
      internalName: `${WINTER_VILLAGE_PRODUCTS['parent-child'].displayName} ${offer.checkIn}`,
      version: offer.ratePlanVersion,
      status: 'draft',
      type: 'fixed_package',
      currency: 'EUR',
      packageArrivalDate: offer.checkIn,
      packageDepartureDate: offer.checkOut,
      minNights: 2,
      inventoryMode: 'exclusive',
      requiresFullPayment: true,
      cancellationPolicyCode: CANCELLATION_POLICY_CODE,
      cancellationPolicyVersion: CANCELLATION_POLICY_VERSION,
      paymentTermCode: PAYMENT_TERM_CODE,
      paymentTermVersion: PAYMENT_TERM_VERSION,
      inclusions: [
        'Two nights in the selected accommodation',
        'Breakfast and dinner',
        'Return mountain transfer',
        'Guided snow or forest activity, weather permitting'
      ],
      accommodations: [
        {
          accommodationKey: 'a-frame',
          entityType: 'cabinType',
          pricingMethod: 'fixed_per_unit',
          fixedPerUnitAmount: 260
        },
        {
          accommodationKey: 'lux-cabin',
          entityType: 'cabin',
          pricingMethod: 'fixed_per_unit',
          fixedPerUnitAmount: 350
        },
        {
          accommodationKey: 'stone-house',
          entityType: 'cabin',
          pricingMethod: 'fixed_per_participant',
          adultPackageAmount: 130,
          childPackageAmount: 60,
          infantPackageAmount: 0
        }
      ]
    })
  ),
  Object.freeze({
    code: 'christmas-2026',
    internalName: 'Christmas in The Valley 2026',
    version: 1,
    status: 'draft',
    type: 'fixed_package',
    currency: 'EUR',
    packageArrivalDate: '2026-12-24',
    packageDepartureDate: '2026-12-27',
    minNights: 3,
    inventoryMode: 'exclusive',
    requiresFullPayment: true,
    cancellationPolicyCode: CANCELLATION_POLICY_CODE,
    cancellationPolicyVersion: CANCELLATION_POLICY_VERSION,
    paymentTermCode: PAYMENT_TERM_CODE,
    paymentTermVersion: PAYMENT_TERM_VERSION,
    inclusions: [
      'Three nights in the selected accommodation',
      'Breakfast and dinner',
      'Christmas Eve feast',
      'Santa visit and presents for children',
      'Family snow day, weather permitting',
      'Return mountain transfer'
    ],
    accommodations: [
      {
        accommodationKey: 'a-frame',
        entityType: 'cabinType',
        pricingMethod: 'fixed_per_unit',
        fixedPerUnitAmount: 490
      },
      {
        accommodationKey: 'lux-cabin',
        entityType: 'cabin',
        pricingMethod: 'fixed_per_unit',
        fixedPerUnitAmount: 590
      },
      {
        accommodationKey: 'stone-house',
        entityType: 'cabin',
        pricingMethod: 'fixed_per_participant',
        adultPackageAmount: 180,
        childPackageAmount: 90,
        infantPackageAmount: 0
      }
    ]
  })
]);

const WINTER_VILLAGE_SEASONAL_RATE_PLAN = Object.freeze({
  code: 'winter-cabin-stay-2026-27',
  internalName: 'Winter Cabin Stay 2026/27',
  version: 2,
  status: 'draft',
  type: 'seasonal_stay',
  currency: 'EUR',
  arrivalWindowStart: '2026-12-01',
  arrivalWindowEnd: '2027-03-31',
  bookingWindowStart: null,
  bookingWindowEnd: null,
  minNights: 2,
  inventoryMode: 'shared',
  requiresFullPayment: true,
  cancellationPolicyCode: CANCELLATION_POLICY_CODE,
  cancellationPolicyVersion: CANCELLATION_POLICY_VERSION,
  paymentTermCode: PAYMENT_TERM_CODE,
  paymentTermVersion: PAYMENT_TERM_VERSION,
  inclusions: [],
  accommodations: [
    {
      accommodationKey: 'a-frame',
      entityType: 'cabinType',
      pricingMethod: 'nightly_per_unit',
      nightlyPerUnitAmount: 75
    },
    {
      accommodationKey: 'lux-cabin',
      entityType: 'cabin',
      pricingMethod: 'nightly_per_unit',
      nightlyPerUnitAmount: 110
    },
    {
      accommodationKey: 'stone-house',
      entityType: 'cabin',
      pricingMethod: 'nightly_base_plus_extra_guest',
      nightlyPerUnitAmount: 90,
      includedGuests: 3,
      additionalGuestNightlyAmount: 30
    }
  ]
});

function normalizeDateOnly(value) {
  const date = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function getWinterVillageProduct(productId) {
  return WINTER_VILLAGE_PRODUCTS[String(productId || '').trim()] || null;
}

function resolveWinterVillageOffer(productId, checkIn, checkOut) {
  const product = getWinterVillageProduct(productId);
  if (!product) return null;
  if (product.kind === 'seasonal_stay') {
    return {
      ...product,
      checkIn: normalizeDateOnly(checkIn),
      checkOut: normalizeDateOnly(checkOut)
    };
  }
  const arrival = normalizeDateOnly(checkIn);
  const departure = normalizeDateOnly(checkOut);
  return (
    product.offers.find(
      (offer) => offer.checkIn === arrival && offer.checkOut === departure
    ) || null
  );
}

module.exports = {
  PAYMENT_TERM_CODE,
  PAYMENT_TERM_VERSION,
  CANCELLATION_POLICY_CODE,
  CANCELLATION_POLICY_VERSION,
  WINTER_VILLAGE_PRODUCTS,
  WINTER_VILLAGE_INVENTORY,
  WINTER_VILLAGE_SEASONAL_RATE_PLAN,
  WINTER_VILLAGE_FIXED_RATE_PLANS,
  getWinterVillageProduct,
  resolveWinterVillageOffer
};
