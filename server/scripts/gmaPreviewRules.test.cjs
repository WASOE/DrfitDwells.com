/**
 * C7 — GMA preview rule options for OPS reservation compose-only preview.
 *
 * Run: node --test scripts/gmaPreviewRules.test.cjs (from server/)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GMA_PREVIEW_RULE_DEFINITIONS,
  buildGmaPreviewRuleOptions
} = require('../../shared/messaging/gmaPreviewRules');

test('buildGmaPreviewRuleOptions: cabin stay offers guest + cleaner rules only', () => {
  const options = buildGmaPreviewRuleOptions('cabin');
  const values = options.map((o) => o.value);
  assert.deepEqual(values, [
    'arrival_instructions_pre_arrival_cabin',
    'cleaner_checkout_prep_cabin',
    'cleaner_checkout_today_cabin'
  ]);
  assert.ok(options.every((o) => o.propertyScope === 'cabin'));
});

test('buildGmaPreviewRuleOptions: valley stay offers guest + cleaner rules only', () => {
  const options = buildGmaPreviewRuleOptions('valley');
  const values = options.map((o) => o.value);
  assert.deepEqual(values, [
    'arrival_instructions_pre_arrival_valley',
    'cleaner_checkout_prep_valley',
    'cleaner_checkout_today_valley'
  ]);
});

test('buildGmaPreviewRuleOptions: unknown property kind falls back to guest rules', () => {
  const options = buildGmaPreviewRuleOptions(null);
  assert.equal(options.length, 2);
  assert.ok(options.every((o) => o.audience === 'guest'));
});

test('GMA_PREVIEW_RULE_DEFINITIONS covers all allowlisted cleaner keys', () => {
  const cleanerValues = GMA_PREVIEW_RULE_DEFINITIONS.filter((o) => o.audience === 'cleaner').map((o) => o.value);
  assert.deepEqual(cleanerValues.sort(), [
    'cleaner_checkout_prep_cabin',
    'cleaner_checkout_prep_valley',
    'cleaner_checkout_today_cabin',
    'cleaner_checkout_today_valley'
  ]);
});
