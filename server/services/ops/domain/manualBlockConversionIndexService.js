'use strict';

const Booking = require('../../../models/Booking');
const { createDomainError } = require('./errors');

const INDEX_NAME = 'booking_conversion_source_block_unique_v1';
const INDEX_KEY = Object.freeze({ 'provenance.convertedFromAvailabilityBlockId': 1 });
const INDEX_PARTIAL_FILTER = Object.freeze({
  'provenance.convertedFromAvailabilityBlockId': { $type: 'objectId' }
});

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function indexMatches(index) {
  return Boolean(
    index &&
      index.name === INDEX_NAME &&
      index.unique === true &&
      stableJson(index.key) === stableJson(INDEX_KEY) &&
      stableJson(index.partialFilterExpression) === stableJson(INDEX_PARTIAL_FILTER)
  );
}

async function inspectManualBlockConversionIndex({
  collection = Booking.collection,
  includeDuplicates = true
} = {}) {
  const indexes = await collection.indexes();
  const named = indexes.find((index) => index.name === INDEX_NAME) || null;
  const sameKey = indexes.filter((index) => stableJson(index.key) === stableJson(INDEX_KEY));
  const duplicateGroups = includeDuplicates ? await collection.aggregate([
    {
      $match: {
        'provenance.convertedFromAvailabilityBlockId': { $type: 'objectId' }
      }
    },
    {
      $group: {
        _id: '$provenance.convertedFromAvailabilityBlockId',
        count: { $sum: 1 }
      }
    },
    { $match: { count: { $gt: 1 } } },
    { $project: { _id: 1, count: 1 } },
    { $limit: 100 }
  ]).toArray() : [];
  const actual = named || sameKey[0] || null;
  const exact = indexMatches(named) && sameKey.length === 1 && sameKey[0] === named;
  return {
    indexStatus: !actual ? 'missing' : exact ? 'exact' : 'wrong',
    exact,
    actual: actual
      ? {
          name: actual.name || null,
          key: actual.key || null,
          unique: actual.unique === true,
          partialFilterExpression: actual.partialFilterExpression || null
        }
      : null,
    duplicateCount: duplicateGroups.length,
    duplicates: duplicateGroups.map(({ _id, count }) => ({
      sourceBlockId: String(_id),
      count
    }))
  };
}

async function applyManualBlockConversionIndex({ collection = Booking.collection, apply = false } = {}) {
  const before = await inspectManualBlockConversionIndex({ collection });
  if (before.duplicateCount > 0) {
    const error = new Error('Duplicate conversion provenance exists');
    error.code = 'MANUAL_BLOCK_CONVERSION_DUPLICATES';
    error.report = before;
    throw error;
  }
  if (before.indexStatus === 'wrong') {
    const error = new Error('A same-name or same-key conversion index is malformed');
    error.code = 'MANUAL_BLOCK_CONVERSION_INDEX_WRONG';
    error.report = before;
    throw error;
  }
  if (before.exact || !apply) return { mode: apply ? 'already_exact' : 'dry_run', before, after: before };

  await collection.createIndex(INDEX_KEY, {
    name: INDEX_NAME,
    unique: true,
    partialFilterExpression: INDEX_PARTIAL_FILTER
  });
  const after = await inspectManualBlockConversionIndex({ collection });
  if (!after.exact || after.duplicateCount > 0) {
    const error = new Error('Created index did not pass exact verification');
    error.code = 'MANUAL_BLOCK_CONVERSION_INDEX_VERIFY_FAILED';
    error.report = after;
    throw error;
  }
  return { mode: 'applied', before, after };
}

async function assertManualBlockConversionIndex() {
  const inspection = await inspectManualBlockConversionIndex({ includeDuplicates: false });
  if (inspection.indexStatus === 'missing') {
    throw createDomainError(
      'dependency_failure',
      'Manual block conversion is temporarily unavailable until its uniqueness index is installed',
      { code: 'MANUAL_BLOCK_CONVERSION_INDEX_MISSING' },
      503
    );
  }
  if (!inspection.exact || inspection.duplicateCount > 0) {
    throw createDomainError(
      'dependency_failure',
      'Manual block conversion is temporarily unavailable because its uniqueness guarantee is invalid',
      {
        code: 'MANUAL_BLOCK_CONVERSION_INDEX_WRONG',
        indexStatus: inspection.indexStatus,
        duplicateCount: inspection.duplicateCount
      },
      503
    );
  }
  return inspection;
}

module.exports = {
  INDEX_NAME,
  INDEX_KEY,
  INDEX_PARTIAL_FILTER,
  indexMatches,
  inspectManualBlockConversionIndex,
  assertManualBlockConversionIndex,
  applyManualBlockConversionIndex
};
