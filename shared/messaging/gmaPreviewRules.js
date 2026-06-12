/**
 * Allowlisted GMA preview rules exposed in OPS reservation compose-only preview (C6/C7).
 * Must stay aligned with PREVIEW_RULE_KEYS in messageTemplatePreviewService.js.
 *
 * ESM module: consumed by the Vite client build (CommonJS here breaks rollup
 * named-import resolution for files outside node_modules).
 */
export const GMA_PREVIEW_RULE_DEFINITIONS = Object.freeze([
  {
    value: 'arrival_instructions_pre_arrival_cabin',
    label: 'Guest · Cabin arrival (T-72h)',
    propertyScope: 'cabin',
    audience: 'guest'
  },
  {
    value: 'arrival_instructions_pre_arrival_valley',
    label: 'Guest · Valley arrival (T-72h)',
    propertyScope: 'valley',
    audience: 'guest'
  },
  {
    value: 'cleaner_checkout_prep_cabin',
    label: 'Cleaner · Checkout prep T-24h (cabin)',
    propertyScope: 'cabin',
    audience: 'cleaner'
  },
  {
    value: 'cleaner_checkout_today_cabin',
    label: 'Cleaner · Checkout today (cabin)',
    propertyScope: 'cabin',
    audience: 'cleaner'
  },
  {
    value: 'cleaner_checkout_prep_valley',
    label: 'Cleaner · Checkout prep T-24h (valley)',
    propertyScope: 'valley',
    audience: 'cleaner'
  },
  {
    value: 'cleaner_checkout_today_valley',
    label: 'Cleaner · Checkout today (valley)',
    propertyScope: 'valley',
    audience: 'cleaner'
  }
]);

/**
 * @param {'cabin'|'valley'|null|undefined} stayPropertyKind
 * @returns {typeof GMA_PREVIEW_RULE_DEFINITIONS[number][]}
 */
export function buildGmaPreviewRuleOptions(stayPropertyKind) {
  if (!stayPropertyKind) {
    return GMA_PREVIEW_RULE_DEFINITIONS.filter((r) => r.audience === 'guest');
  }
  return GMA_PREVIEW_RULE_DEFINITIONS.filter((r) => r.propertyScope === stayPropertyKind);
}
