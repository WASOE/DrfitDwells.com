'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MANUAL_BLOCK_PURPOSES,
  normalizeManualBlockPurpose,
  manualBlockPurposeLabel
} = require('../services/ops/manualBlockPurposeService');

test('normalizes registered manual-block purposes and exposes their labels', () => {
  for (const purpose of MANUAL_BLOCK_PURPOSES) {
    assert.equal(
      normalizeManualBlockPurpose(purpose.value, purpose.requiresReason ? 'specified note' : null),
      purpose.value
    );
    assert.equal(manualBlockPurposeLabel(purpose.value), purpose.label);
  }
});

test('requires an operator note for Other and rejects unknown block purposes', () => {
  assert.throws(
    () => normalizeManualBlockPurpose('other'),
    (error) => error.code === 'MANUAL_BLOCK_REASON_REQUIRED'
  );
  assert.throws(
    () => normalizeManualBlockPurpose('unknown'),
    (error) => error.code === 'INVALID_MANUAL_BLOCK_PURPOSE'
  );
});
