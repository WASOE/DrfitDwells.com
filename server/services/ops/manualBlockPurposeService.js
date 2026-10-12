'use strict';

const MANUAL_BLOCK_PURPOSES = require('../../../shared/manualBlockPurposes.json');

const PURPOSE_BY_VALUE = new Map(
  MANUAL_BLOCK_PURPOSES.map((purpose) => [purpose.value, purpose])
);

function normalizeManualBlockPurpose(value, operatorNote = null) {
  const purpose = PURPOSE_BY_VALUE.get(String(value || '').trim());
  if (!purpose) {
    const err = new Error('Choose a valid purpose for this manual block');
    err.code = 'INVALID_MANUAL_BLOCK_PURPOSE';
    throw err;
  }
  if (purpose.requiresReason && !String(operatorNote || '').trim()) {
    const err = new Error('An operator note is required for an Other hold');
    err.code = 'MANUAL_BLOCK_REASON_REQUIRED';
    throw err;
  }
  return purpose.value;
}

function manualBlockPurposeLabel(value) {
  return PURPOSE_BY_VALUE.get(String(value || '').trim())?.label || null;
}

module.exports = {
  MANUAL_BLOCK_PURPOSES,
  normalizeManualBlockPurpose,
  manualBlockPurposeLabel
};
