'use strict';

/**
 * Server-side allowlists mirroring client/src/data/buildConfiguratorSchema.js.
 * Keep in sync when product options change.
 */

const BUILD_MODEL_IDS = Object.freeze(['lux-cabin', 'aframe']);
const DEFAULT_MODEL_ID = 'lux-cabin';

const MODEL_TYPES = Object.freeze({
  'lux-cabin': 'cabin',
  aframe: 'aframe'
});

/** Legacy client ids → canonical. */
const MODEL_ID_ALIASES = Object.freeze({
  '6x3': 'lux-cabin',
  '7x3': 'lux-cabin'
});

const RADIO_CATEGORIES = Object.freeze({
  cladding: Object.freeze(['cladding-thermal-wood', 'cladding-shou-sugi', 'cladding-metal']),
  roof: Object.freeze(['roof-membrane', 'roof-green']),
  wallFinish: Object.freeze(['finish-plywood', 'finish-pine-planks']),
  flooring: Object.freeze(['floor-pvc-laminate', 'floor-wooden-planks'])
});

const TOGGLE_OPTION_IDS = Object.freeze([
  'extra-timber-deck',
  'extra-outdoor-shower',
  'heat-ac',
  'heat-fireplace',
  'heat-pump',
  'heat-underfloor',
  'extra-solar',
  'extra-rainwater',
  'extra-ev',
  'extra-extended-deck',
  'extra-hot-tub',
  'extra-outdoor-kitchen'
]);

const ALL_OPTION_IDS = Object.freeze([
  ...Object.values(RADIO_CATEGORIES).flat(),
  ...TOGGLE_OPTION_IDS
]);

const CUSTOM_SIZING = Object.freeze({
  length: Object.freeze({ min: 6, max: 14 }),
  width: Object.freeze({ min: 3, max: 5 })
});

const LAND_STATUSES = Object.freeze(['owned', 'searching', 'other']);

const BUDGET_BANDS = Object.freeze([
  'under_30k',
  '30k_50k',
  '50k_80k',
  '80k_plus',
  'undecided'
]);

const TIMELINE_BANDS = Object.freeze([
  'asap',
  'within_3_months',
  'within_6_months',
  'within_12_months',
  'exploring'
]);

const ENQUIRY_STATUSES = Object.freeze(['new', 'in_progress', 'closed']);

const EMAIL_LANE_STATUSES = Object.freeze([
  'pending',
  'sending',
  'succeeded',
  'failed'
]);

const SOURCE = 'build_configurator';

module.exports = {
  BUILD_MODEL_IDS,
  DEFAULT_MODEL_ID,
  MODEL_TYPES,
  MODEL_ID_ALIASES,
  RADIO_CATEGORIES,
  TOGGLE_OPTION_IDS,
  ALL_OPTION_IDS,
  CUSTOM_SIZING,
  LAND_STATUSES,
  BUDGET_BANDS,
  TIMELINE_BANDS,
  ENQUIRY_STATUSES,
  EMAIL_LANE_STATUSES,
  SOURCE
};
