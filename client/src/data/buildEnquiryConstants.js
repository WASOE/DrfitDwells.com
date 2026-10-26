/** Client mirrors of server/services/buildEnquiries/buildEnquiryConstants.js enums. */

export const BUILD_LAND_STATUS_OPTIONS = Object.freeze([
  { value: 'owned', label: 'I own the land' },
  { value: 'searching', label: 'Still searching for land' },
  { value: 'other', label: 'Other / not sure yet' }
]);

export const BUILD_BUDGET_OPTIONS = Object.freeze([
  { value: 'under_30k', label: 'Under €30,000' },
  { value: '30k_50k', label: '€30,000 – €50,000' },
  { value: '50k_80k', label: '€50,000 – €80,000' },
  { value: '80k_plus', label: '€80,000+' },
  { value: 'undecided', label: 'Not decided yet' }
]);

export const BUILD_TIMELINE_OPTIONS = Object.freeze([
  { value: 'asap', label: 'As soon as possible' },
  { value: 'within_3_months', label: 'Within 3 months' },
  { value: 'within_6_months', label: 'Within 6 months' },
  { value: 'within_12_months', label: 'Within 12 months' },
  { value: 'exploring', label: 'Just exploring' }
]);

export const BUILD_ENQUIRY_PRIMARY_CTA = 'Get my project estimate';
