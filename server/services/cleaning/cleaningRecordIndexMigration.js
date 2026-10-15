'use strict';

const EXTERNAL_HOLD_INDEX_NAME = 'availabilityBlockId_1_cleaningDate_1_external_hold_unique';
const EXTERNAL_HOLD_INDEX_KEYS = Object.freeze({
  availabilityBlockId: 1,
  cleaningDate: 1
});
const EXTERNAL_HOLD_INDEX_FILTER = Object.freeze({
  sourceKind: 'external_hold',
  availabilityBlockId: Object.freeze({ $type: 'objectId' }),
  cleaningDate: Object.freeze({ $type: 'date' })
});
const EXTERNAL_HOLD_INDEX_COLLATION = Object.freeze({ locale: 'simple' });

function indexKeysMatch(actual, expected) {
  if (!actual || typeof actual !== 'object') return false;
  const actualEntries = Object.entries(actual);
  const expectedEntries = Object.entries(expected);
  return actualEntries.length === expectedEntries.length &&
    actualEntries.every(([key, value], index) =>
      key === expectedEntries[index][0] && value === expectedEntries[index][1]
    );
}

function sameObject(actual, expected) {
  if (!actual || typeof actual !== 'object') return false;
  const actualEntries = Object.entries(actual);
  const expectedEntries = Object.entries(expected);
  return actualEntries.length === expectedEntries.length &&
    actualEntries.every(([key, value]) => {
      const expectedValue = expected[key];
      if (value && typeof value === 'object') {
        return sameObject(value, expectedValue);
      }
      return value === expectedValue;
    });
}

function isExactExternalHoldIndex(index) {
  return index.unique === true &&
    index.sparse !== true &&
    index.hidden !== true &&
    indexKeysMatch(index.key, EXTERNAL_HOLD_INDEX_KEYS) &&
    sameObject(index.partialFilterExpression, EXTERNAL_HOLD_INDEX_FILTER) &&
    (index.collation == null ||
      sameObject(index.collation, EXTERNAL_HOLD_INDEX_COLLATION));
}

async function countDuplicateExternalHoldKeys(collection) {
  const duplicates = await collection.aggregate([
    {
      $match: {
        sourceKind: 'external_hold',
        availabilityBlockId: { $type: 'objectId' },
        cleaningDate: { $type: 'date' }
      }
    },
    {
      $group: {
        _id: {
          availabilityBlockId: '$availabilityBlockId',
          cleaningDate: '$cleaningDate'
        },
        count: { $sum: 1 }
      }
    },
    { $match: { count: { $gt: 1 } } },
    { $count: 'duplicateGroups' }
  ]).toArray();
  return duplicates[0]?.duplicateGroups || 0;
}

async function preflightCleaningRecordIndexes(collection) {
  if (!collection || typeof collection.indexes !== 'function' ||
      typeof collection.aggregate !== 'function' ||
      typeof collection.countDocuments !== 'function') {
    throw new Error('CleaningRecord index migration requires index, aggregate, and countDocuments access');
  }

  const indexes = await collection.indexes();
  const targetByName = indexes.find((index) => index.name === EXTERNAL_HOLD_INDEX_NAME);
  const sameKeyUniqueIndexes = indexes.filter((index) =>
    index.unique === true && indexKeysMatch(index.key, EXTERNAL_HOLD_INDEX_KEYS)
  );
  const issues = [];

  if (targetByName && !isExactExternalHoldIndex(targetByName)) {
    issues.push('The external-hold unique index name exists with an unexpected definition.');
  }
  if (sameKeyUniqueIndexes.some((index) => !isExactExternalHoldIndex(index))) {
    issues.push('An unexpected unique index definition exists on availabilityBlockId and cleaningDate.');
  }
  if (sameKeyUniqueIndexes.some((index) => index.name !== EXTERNAL_HOLD_INDEX_NAME)) {
    issues.push('A matching unique index exists under a different name; operator review is required.');
  }

  const indexScope = {
    sourceKind: 'external_hold',
    availabilityBlockId: { $type: 'objectId' },
    cleaningDate: { $type: 'date' }
  };
  const allIndexKeyRecords = {
    availabilityBlockId: { $type: 'objectId' },
    cleaningDate: { $type: 'date' }
  };
  const [duplicateGroups, indexScopeCount, nonExternalHoldCount, incompleteExternalHoldCount,
    externalHoldIdentityMismatchCount] = await Promise.all([
    countDuplicateExternalHoldKeys(collection),
    collection.countDocuments(indexScope),
    collection.countDocuments({
      $and: [allIndexKeyRecords, { sourceKind: { $ne: 'external_hold' } }]
    }),
    collection.countDocuments({
      sourceKind: 'external_hold',
      $or: [
        { availabilityBlockId: { $not: { $type: 'objectId' } } },
        { cleaningDate: { $not: { $type: 'date' } } },
        { sourceId: { $not: { $type: 'string' } } },
        { sourceId: '' }
      ]
    }),
    collection.aggregate([
      { $match: { ...indexScope, sourceKind: 'external_hold' } },
      {
        $match: {
          $expr: {
            $ne: ['$sourceId', { $toString: '$availabilityBlockId' }]
          }
        }
      },
      { $count: 'mismatches' }
    ]).toArray().then((rows) => rows[0]?.mismatches || 0)
  ]);

  if (duplicateGroups > 0) {
    issues.push('Duplicate availabilityBlockId and cleaningDate keys prevent creation of the unique index.');
  }
  if (nonExternalHoldCount > 0) {
    issues.push('Non-external CleaningRecords are in the proposed partial-index scope.');
  }
  if (externalHoldIdentityMismatchCount > 0) {
    issues.push('External-hold sourceId values do not match availabilityBlockId.');
  }

  const exactIndex = sameKeyUniqueIndexes.find(isExactExternalHoldIndex);
  return {
    safe: issues.length === 0,
    externalHoldIndexPresent: Boolean(exactIndex),
    indexes: indexes.map((index) => ({
      name: index.name,
      key: index.key,
      unique: index.unique === true,
      sparse: index.sparse === true,
      hidden: index.hidden === true,
      collation: index.collation || null,
      partialFilterExpression: index.partialFilterExpression || null
    })),
    indexScopeCount,
    duplicateGroups,
    nonExternalHoldCount,
    incompleteExternalHoldCount,
    externalHoldIdentityMismatchCount,
    incompleteLegacyRecordsExcluded: 'Records without ObjectId availabilityBlockId and Date cleaningDate are outside the proposed index scope.',
    issues
  };
}

async function applyCleaningRecordIndexMigration(collection, preflight) {
  if (!preflight.safe) {
    throw new Error(`CleaningRecord index migration preflight failed: ${preflight.issues.join(' ')}`);
  }

  if (!preflight.externalHoldIndexPresent) {
    await collection.createIndex(EXTERNAL_HOLD_INDEX_KEYS, {
      unique: true,
      name: EXTERNAL_HOLD_INDEX_NAME,
      partialFilterExpression: EXTERNAL_HOLD_INDEX_FILTER,
      collation: EXTERNAL_HOLD_INDEX_COLLATION
    });
  }

  return { createdExternalHoldIndex: !preflight.externalHoldIndexPresent };
}

module.exports = {
  EXTERNAL_HOLD_INDEX_NAME,
  EXTERNAL_HOLD_INDEX_KEYS,
  EXTERNAL_HOLD_INDEX_FILTER,
  EXTERNAL_HOLD_INDEX_COLLATION,
  indexKeysMatch,
  preflightCleaningRecordIndexes,
  applyCleaningRecordIndexMigration
};
