'use strict';

const LEGACY_INDEX_NAME = 'bookingId_1_cleaningDate_1';
const LEGACY_INDEX_KEYS = Object.freeze({ bookingId: 1, cleaningDate: 1 });
const SOURCE_INDEX_NAME = 'sourceKind_1_sourceId_1_cleaningDate_1';
const SOURCE_INDEX_KEYS = Object.freeze({
  sourceKind: 1,
  sourceId: 1,
  cleaningDate: 1
});

function indexKeysMatch(actual, expected) {
  if (!actual || typeof actual !== 'object') return false;
  const actualEntries = Object.entries(actual);
  const expectedEntries = Object.entries(expected);
  return actualEntries.length === expectedEntries.length &&
    actualEntries.every(([key, value], index) =>
      key === expectedEntries[index][0] && value === expectedEntries[index][1]
    );
}

function isExactUniqueIndex(index, keys) {
  return index.unique === true &&
    index.sparse !== true &&
    index.hidden !== true &&
    index.partialFilterExpression == null &&
    index.collation == null &&
    indexKeysMatch(index.key, keys);
}

async function countDuplicateSourceIdentities(collection) {
  const duplicates = await collection.aggregate([
    {
      $group: {
        _id: {
          sourceKind: '$sourceKind',
          sourceId: '$sourceId',
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
  const legacyByName = indexes.find((index) => index.name === LEGACY_INDEX_NAME);
  const legacyKeyIndexes = indexes.filter((index) =>
    indexKeysMatch(index.key, LEGACY_INDEX_KEYS)
  );
  const sourceKeyIndexes = indexes.filter((index) =>
    indexKeysMatch(index.key, SOURCE_INDEX_KEYS)
  );
  const issues = [];

  if (legacyByName && !isExactUniqueIndex(legacyByName, LEGACY_INDEX_KEYS)) {
    issues.push('The legacy index name exists with an unexpected definition.');
  }
  if (legacyKeyIndexes.some((index) =>
    index.name !== LEGACY_INDEX_NAME || !isExactUniqueIndex(index, LEGACY_INDEX_KEYS)
  )) {
    issues.push('An unexpected index definition exists on bookingId and cleaningDate.');
  }
  if (sourceKeyIndexes.length > 1 ||
      sourceKeyIndexes.some((index) =>
        index.name !== SOURCE_INDEX_NAME || !isExactUniqueIndex(index, SOURCE_INDEX_KEYS)
      )) {
    issues.push('An unexpected index definition exists on sourceKind, sourceId, and cleaningDate.');
  }

  const [duplicateGroups, invalidIdentityCount] = await Promise.all([
    countDuplicateSourceIdentities(collection),
    collection.countDocuments({
      $or: [
        { sourceKind: { $exists: false } },
        { sourceKind: null },
        { sourceKind: '' },
        { sourceId: { $exists: false } },
        { sourceId: null },
        { sourceId: '' },
        { sourceId: { $regex: /^\s*$/ } },
        { cleaningDate: { $exists: false } },
        { cleaningDate: null }
      ]
    })
  ]);
  if (duplicateGroups > 0) {
    issues.push('Duplicate source identities prevent creation of the required unique index.');
  }
  if (invalidIdentityCount > 0) {
    issues.push('Records with incomplete source identity prevent safe index creation.');
  }

  return {
    safe: issues.length === 0,
    legacyIndexPresent: Boolean(legacyByName),
    sourceIndexPresent: sourceKeyIndexes.length === 1 &&
      isExactUniqueIndex(sourceKeyIndexes[0], SOURCE_INDEX_KEYS),
    indexes: indexes.map((index) => ({
      name: index.name,
      key: index.key,
      unique: index.unique === true,
      sparse: index.sparse === true,
      hidden: index.hidden === true,
      collation: index.collation || null,
      partialFilterExpression: index.partialFilterExpression || null
    })),
    duplicateGroups,
    invalidIdentityCount,
    issues
  };
}

async function applyCleaningRecordIndexMigration(collection, preflight) {
  if (!preflight.safe) {
    throw new Error(`CleaningRecord index migration preflight failed: ${preflight.issues.join(' ')}`);
  }

  if (!preflight.sourceIndexPresent) {
    await collection.createIndex(SOURCE_INDEX_KEYS, {
      unique: true,
      name: SOURCE_INDEX_NAME
    });
  }
  if (preflight.legacyIndexPresent) {
    await collection.dropIndex(LEGACY_INDEX_NAME);
  }

  return { createdSourceIndex: !preflight.sourceIndexPresent, droppedLegacyIndex: preflight.legacyIndexPresent };
}

module.exports = {
  LEGACY_INDEX_NAME,
  LEGACY_INDEX_KEYS,
  SOURCE_INDEX_NAME,
  SOURCE_INDEX_KEYS,
  indexKeysMatch,
  preflightCleaningRecordIndexes,
  applyCleaningRecordIndexMigration
};
