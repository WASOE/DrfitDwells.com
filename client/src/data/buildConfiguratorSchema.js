/**
 * Build configurator — Phase 0/1 locked product schema (EN).
 * UI reads options from here; filter via buildConfiguratorLogic helpers.
 */

export const BUILD_MODEL_IDS = ['lux-cabin', 'aframe'];

export const CUSTOM_SIZING = {
  availableForModelTypes: ['cabin'],
  length: { min: 6, max: 14, step: 1, default: 7 },
  width: { min: 3, max: 5, step: 0.5, default: 3 },
  standardAreaSqm: 21,
  ratePerSqmAboveStandard: 1500,
};

export const BUILD_MODELS = [
  {
    id: 'lux-cabin',
    type: 'cabin',
    name: 'The Lux Cabin',
    badge: 'All-inclusive · Most popular',
    basePrice: 32000,
    dims: '7 m × 3 m × 3 m',
    areaSqm: 21,
    areaLabel: '21 m²',
    capacity: '2 persons',
    description:
      'Mono-pitch roof · Thermal wood cladding · Mobile · Bedroom, bathroom, kitchen, full fit-out',
    tags: ['Bedroom', 'Bathroom', 'Kitchen'],
    heroMediaId: 'exterior-hero',
    shellOnly: false,
  },
  {
    id: 'aframe',
    type: 'aframe',
    name: 'The A Frame',
    badge: 'Entry model · Signature design',
    basePrice: 20000,
    dims: '6 m × 3 m footprint',
    areaSqm: 28,
    areaLabel: '28 m² incl. loft',
    capacity: '2–4 persons',
    description:
      'Pitched roof · Triangle windows · Sleeping loft · Shell price — bathroom not included',
    tags: ['Loft', 'Kitchen'],
    heroMediaId: 'aframe-hero',
    shellOnly: true,
    priceNote: 'Shell price — bathroom and full fit-out not included',
    summaryNote:
      '€20,000 — structural shell. Bathroom and full fit-out not included. Final price confirmed at consultation.',
  },
];

/** Structural shell only — no interior finish choices listed as included. */
export const INCLUDED_ITEMS = {
  cabin: [
    'Cabin structure & framing',
    'Insulation build-up',
    'Vapor barrier system',
    'Waterproofing membrane',
    'Double-glazed windows & doors',
    'Electrical pre-wiring',
    'Plumbing connection prep',
    'Delivery & installation',
  ],
  aframe: [
    'A-Frame structure & framing',
    'Insulation build-up',
    'Vapor barrier system',
    'Waterproofing membrane',
    'Double-glazed windows & doors',
    'Electrical pre-wiring',
    'Delivery & installation',
  ],
};

export const BUILD_STEPS = [
  { id: 'model', label: 'Model', index: 0 },
  { id: 'exterior', label: 'Exterior', index: 1 },
  { id: 'interior', label: 'Interior', index: 2 },
  { id: 'options', label: 'Options', index: 3 },
  { id: 'summary', label: 'Summary', index: 4 },
];

/**
 * @typedef {Object} BuildOption
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {number} [priceDelta] — fixed EUR add-on; omit when priceOnConsultation
 * @property {boolean} [priceOnConsultation]
 * @property {boolean} [included]
 * @property {'radio'|'toggle'} selectionType
 * @property {string} [categoryId] — radio group key
 * @property {string[]} [availableFor] — model ids; omit = all models
 * @property {string[]} [availableForModelTypes] — 'cabin' | 'aframe'
 * @property {string[]} [excludeTags] — e.g. ['bathroom'] filtered out for aframe
 * @property {string[]} [tags]
 * @property {string} [mediaId]
 */

/** @type {BuildOption[]} */
export const BUILD_OPTIONS = [
  // —— Exterior: cladding (radio) ——
  {
    id: 'cladding-thermal-wood',
    categoryId: 'cladding',
    selectionType: 'radio',
    name: 'Thermal wood cladding',
    description:
      'Thermal wood exterior with ventilated grill system. Standard finish included.',
    priceDelta: 0,
    included: true,
    mediaId: 'exterior-hero',
  },
  {
    id: 'cladding-shou-sugi',
    categoryId: 'cladding',
    selectionType: 'radio',
    name: 'Shou sugi ban (charred wood)',
    description:
      'Traditional Japanese charred wood finish for enhanced durability and distinctive appearance.',
    priceDelta: 2800,
    mediaId: 'exterior-hero',
  },
  {
    id: 'cladding-metal',
    categoryId: 'cladding',
    selectionType: 'radio',
    name: 'Metal cladding',
    description: 'Modern metal cladding for a contemporary aesthetic and low maintenance.',
    priceDelta: 3400,
    mediaId: 'exterior-hero',
  },

  // —— Exterior: roof (radio) ——
  {
    id: 'roof-membrane',
    categoryId: 'roof',
    selectionType: 'radio',
    name: 'Waterproofing membrane',
    description: 'Standard waterproofing membrane roof build-up. Suitable for all climates.',
    priceDelta: 0,
    included: true,
    mediaId: 'exterior-roof',
  },
  {
    id: 'roof-green',
    categoryId: 'roof',
    selectionType: 'radio',
    name: 'Green sedum roof',
    description:
      'Living roof system with native sedum plants. Additional insulation and biodiversity.',
    priceDelta: 3200,
    mediaId: 'exterior-roof',
  },

  // —— Exterior: deck & entrance (toggles) ——
  {
    id: 'extra-timber-deck',
    categoryId: 'exteriorExtras',
    selectionType: 'toggle',
    name: 'Timber entrance deck',
    description: '4 m² treated larch platform, pre-installed',
    priceDelta: 1800,
  },
  {
    id: 'extra-outdoor-shower',
    categoryId: 'exteriorExtras',
    selectionType: 'toggle',
    name: 'Outdoor shower',
    description: 'Hot/cold, cedar privacy screen, drain',
    priceDelta: 1200,
    availableForModelTypes: ['cabin'],
    tags: ['plumbing'],
  },

  // —— Interior: wall finish (radio) ——
  {
    id: 'finish-plywood',
    categoryId: 'wallFinish',
    selectionType: 'radio',
    name: 'Plywood',
    description: 'Warm birch plywood walls and ceiling. Light, honest, and timeless.',
    priceDelta: 0,
    included: true,
    mediaId: 'interior-main',
  },
  {
    id: 'finish-pine-planks',
    categoryId: 'wallFinish',
    selectionType: 'radio',
    name: 'Rough pine planks',
    description: 'Traditional rough pine plank interior. Priced separately at consultation.',
    priceOnConsultation: true,
    mediaId: 'interior-planks',
  },

  // —— Interior: flooring (radio) ——
  {
    id: 'floor-pvc-laminate',
    categoryId: 'flooring',
    selectionType: 'radio',
    name: 'PVC laminate',
    description: 'Standard PVC laminate flooring. Waterproof and durable. Pre-installed.',
    priceDelta: 0,
    included: true,
    mediaId: 'interior-main',
  },
  {
    id: 'floor-wooden-planks',
    categoryId: 'flooring',
    selectionType: 'radio',
    name: 'Wooden planks',
    description: 'Real wood plank flooring. Priced separately at consultation.',
    priceOnConsultation: true,
    mediaId: 'interior-planks',
  },

  // —— Interior: heating (toggles) ——
  {
    id: 'heat-ac',
    categoryId: 'heating',
    selectionType: 'toggle',
    name: 'Air conditioning (heating & cooling)',
    description: 'Split-system A/C — warms and cools, ultra-quiet. Included.',
    included: true,
  },
  {
    id: 'heat-fireplace',
    categoryId: 'heating',
    selectionType: 'toggle',
    name: 'Wood-burning fireplace',
    description: 'Cast iron fireplace, flue pipe and hearth. Included.',
    included: true,
  },
  {
    id: 'heat-pump',
    categoryId: 'heating',
    selectionType: 'toggle',
    name: 'Heat pump',
    description: 'Central air-source heat pump system. Priced at consultation.',
    priceOnConsultation: true,
  },
  {
    id: 'heat-underfloor',
    categoryId: 'heating',
    selectionType: 'toggle',
    name: 'Underfloor heating',
    description: 'Electric underfloor heating with smart thermostat. Priced at consultation.',
    priceOnConsultation: true,
  },

  // —— Options: energy (toggles) ——
  {
    id: 'extra-solar',
    categoryId: 'energy',
    selectionType: 'toggle',
    name: 'Solar array + battery storage',
    description: '4kW panels, 10kWh lithium battery, 48hr autonomy',
    priceDelta: 7200,
  },
  {
    id: 'extra-rainwater',
    categoryId: 'energy',
    selectionType: 'toggle',
    name: 'Rainwater harvesting',
    description: 'Collection, filtration, 3,000L storage',
    priceDelta: 2800,
    availableForModelTypes: ['cabin'],
    tags: ['plumbing'],
  },
  {
    id: 'extra-ev',
    categoryId: 'energy',
    selectionType: 'toggle',
    name: 'EV charging point',
    description: '22kW Type 2, solar-integrated where possible',
    priceDelta: 1800,
  },

  // —— Options: outdoor living (toggles) ——
  {
    id: 'extra-extended-deck',
    categoryId: 'outdoorLiving',
    selectionType: 'toggle',
    name: 'Extended deck (12 m²)',
    description: 'Wrap-around larch deck with built-in seating',
    priceDelta: 4200,
  },
  {
    id: 'extra-hot-tub',
    categoryId: 'outdoorLiving',
    selectionType: 'toggle',
    name: 'Wood-fired hot tub',
    description: 'Cedar tub, stainless firebox, seats 4',
    priceDelta: 5800,
  },
  {
    id: 'extra-outdoor-kitchen',
    categoryId: 'outdoorLiving',
    selectionType: 'toggle',
    name: 'Outdoor kitchen',
    description: 'Stone counter, wood-fire grill, prep sink',
    priceDelta: 3600,
  },
];

export const BUILD_STEP_SECTIONS = {
  exterior: [
    {
      id: 'cladding',
      title: 'Exterior Cladding',
      description: 'Choose your exterior material and finish.',
      categoryId: 'cladding',
      selectionType: 'radio',
    },
    {
      id: 'roof',
      title: 'Roof System',
      description: 'Select your roof configuration and waterproofing.',
      categoryId: 'roof',
      selectionType: 'radio',
    },
    {
      id: 'exteriorExtras',
      title: 'Deck & Entrance',
      description: null,
      categoryId: 'exteriorExtras',
      selectionType: 'toggle',
    },
  ],
  interior: [
    {
      id: 'wallFinish',
      title: 'Wall Finish',
      description: 'Plywood is included in base price. Upgrades quoted at consultation.',
      categoryId: 'wallFinish',
      selectionType: 'radio',
    },
    {
      id: 'flooring',
      title: 'Flooring',
      description: 'PVC laminate is included in base price. Upgrades quoted at consultation.',
      categoryId: 'flooring',
      selectionType: 'radio',
    },
    {
      id: 'heating',
      title: 'Heating',
      description: null,
      categoryId: 'heating',
      selectionType: 'toggle',
    },
  ],
  options: [
    {
      id: 'energy',
      title: 'Energy',
      description: null,
      categoryId: 'energy',
      selectionType: 'toggle',
    },
    {
      id: 'outdoorLiving',
      title: 'Outdoor Living',
      description: null,
      categoryId: 'outdoorLiving',
      selectionType: 'toggle',
    },
  ],
};

/** Default radio selections per category. */
export const DEFAULT_RADIO_SELECTIONS = {
  cladding: 'cladding-thermal-wood',
  roof: 'roof-membrane',
  wallFinish: 'finish-plywood',
  flooring: 'floor-pvc-laminate',
};

export const DEFAULT_MODEL_ID = 'lux-cabin';

export const SUMMARY_REVIEWS = [
  {
    quote:
      'Being in a cabin is like going out for an upgraded camping. Everything you need — a fully equipped kitchen, comfortable bed, a cosy wood fireplace.',
    author: 'Liya — Beit Keshet, Israel · August 2023',
  },
  {
    quote:
      'Absolutely amazing place, totally off-grid with stunning surroundings. Wake up to a beautiful sunrise with the sound of a river.',
    author: 'Mikael — Bucharest, Romania · July 2023',
  },
  {
    quote:
      'If you want to get off the grid and enjoy the beautiful mountains, this is the right place. Absolutely 10/10.',
    author: 'Boyan — Varna, Bulgaria · October 2023',
  },
];

/** Map legacy model ids from earlier configurator versions. */
export function normalizeBuildModelId(modelId) {
  if (modelId === '6x3' || modelId === '7x3') return 'lux-cabin';
  return modelId;
}

export function getBuildModel(modelId) {
  const id = normalizeBuildModelId(modelId);
  return BUILD_MODELS.find((m) => m.id === id) ?? BUILD_MODELS.find((m) => m.id === DEFAULT_MODEL_ID);
}

export function getIncludedItemsForModel(modelId) {
  const model = getBuildModel(modelId);
  return INCLUDED_ITEMS[model.type === 'aframe' ? 'aframe' : 'cabin'];
}
