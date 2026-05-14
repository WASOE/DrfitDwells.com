/**
 * propertyKindResolver contract tests.
 *
 * Pure unit tests — no DB, no mongoose connect. Validates:
 *   - the resolver only reads the persisted enum
 *   - it throws PropertyKindUnresolvedError for missing / null / invalid values
 *   - schema definitions on Cabin and CabinType enforce the enum and accept absence
 *
 * Run: npm run test:property-kind (from server/)
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const {
  PROPERTY_KINDS,
  PropertyKindUnresolvedError,
  resolvePropertyKindFromCabinDoc,
  resolvePropertyKindFromCabinTypeDoc
} = require('../services/messaging/propertyKindResolver');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');

function makeCabinDoc(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    name: 'Test Cabin',
    location: 'Bachevo',
    ...overrides
  };
}

function makeCabinTypeDoc(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    name: 'Test CabinType',
    slug: 'test-cabin-type',
    location: 'Valley',
    ...overrides
  };
}

describe('propertyKindResolver enum', () => {
  test('PROPERTY_KINDS is exactly cabin and valley', () => {
    assert.deepStrictEqual([...PROPERTY_KINDS].sort(), ['cabin', 'valley']);
  });

  test('PROPERTY_KINDS is frozen', () => {
    assert.ok(Object.isFrozen(PROPERTY_KINDS));
  });
});

describe('resolvePropertyKindFromCabinDoc', () => {
  test('returns "cabin" when propertyKind is "cabin"', () => {
    const doc = makeCabinDoc({ propertyKind: 'cabin' });
    assert.strictEqual(resolvePropertyKindFromCabinDoc(doc), 'cabin');
  });

  test('returns "valley" when propertyKind is "valley"', () => {
    const doc = makeCabinDoc({ propertyKind: 'valley' });
    assert.strictEqual(resolvePropertyKindFromCabinDoc(doc), 'valley');
  });

  test('throws PropertyKindUnresolvedError when doc is null', () => {
    assert.throws(
      () => resolvePropertyKindFromCabinDoc(null),
      (err) => err instanceof PropertyKindUnresolvedError && err.details.reason === 'missing_document'
    );
  });

  test('throws PropertyKindUnresolvedError when doc is undefined', () => {
    assert.throws(
      () => resolvePropertyKindFromCabinDoc(undefined),
      (err) => err instanceof PropertyKindUnresolvedError && err.details.reason === 'missing_document'
    );
  });

  test('throws PropertyKindUnresolvedError when propertyKind is missing', () => {
    const doc = makeCabinDoc();
    assert.throws(
      () => resolvePropertyKindFromCabinDoc(doc),
      (err) =>
        err instanceof PropertyKindUnresolvedError &&
        err.details.reason === 'unset' &&
        err.details.entityType === 'Cabin'
    );
  });

  test('throws PropertyKindUnresolvedError when propertyKind is null', () => {
    const doc = makeCabinDoc({ propertyKind: null });
    assert.throws(
      () => resolvePropertyKindFromCabinDoc(doc),
      (err) => err instanceof PropertyKindUnresolvedError && err.details.reason === 'unset'
    );
  });

  test('throws PropertyKindUnresolvedError when propertyKind is empty string', () => {
    const doc = makeCabinDoc({ propertyKind: '' });
    assert.throws(
      () => resolvePropertyKindFromCabinDoc(doc),
      (err) => err instanceof PropertyKindUnresolvedError && err.details.reason === 'unset'
    );
  });

  test('throws PropertyKindUnresolvedError on invalid value', () => {
    const doc = makeCabinDoc({ propertyKind: 'mountain' });
    assert.throws(
      () => resolvePropertyKindFromCabinDoc(doc),
      (err) =>
        err instanceof PropertyKindUnresolvedError &&
        err.details.reason === 'invalid_value' &&
        err.details.value === 'mountain'
    );
  });

  test('error carries entityId when available', () => {
    const doc = makeCabinDoc();
    try {
      resolvePropertyKindFromCabinDoc(doc);
      assert.fail('expected throw');
    } catch (err) {
      assert.strictEqual(err.details.entityId, String(doc._id));
      assert.strictEqual(err.code, 'PROPERTY_KIND_UNRESOLVED');
    }
  });
});

describe('resolvePropertyKindFromCabinTypeDoc', () => {
  test('returns "valley" when propertyKind is "valley"', () => {
    const doc = makeCabinTypeDoc({ propertyKind: 'valley' });
    assert.strictEqual(resolvePropertyKindFromCabinTypeDoc(doc), 'valley');
  });

  test('returns "cabin" when propertyKind is "cabin"', () => {
    const doc = makeCabinTypeDoc({ propertyKind: 'cabin' });
    assert.strictEqual(resolvePropertyKindFromCabinTypeDoc(doc), 'cabin');
  });

  test('throws PropertyKindUnresolvedError when propertyKind is missing', () => {
    const doc = makeCabinTypeDoc();
    assert.throws(
      () => resolvePropertyKindFromCabinTypeDoc(doc),
      (err) =>
        err instanceof PropertyKindUnresolvedError &&
        err.details.entityType === 'CabinType' &&
        err.details.reason === 'unset'
    );
  });

  test('throws PropertyKindUnresolvedError on invalid enum', () => {
    const doc = makeCabinTypeDoc({ propertyKind: 'lake-house' });
    assert.throws(
      () => resolvePropertyKindFromCabinTypeDoc(doc),
      (err) =>
        err instanceof PropertyKindUnresolvedError &&
        err.details.reason === 'invalid_value'
    );
  });
});

describe('Cabin schema accepts and validates propertyKind', () => {
  test('accepts absence of propertyKind (optional)', () => {
    const doc = new Cabin({
      name: 'Stone House',
      description: 'A cabin',
      capacity: 4,
      pricePerNight: 100,
      imageUrl: '/uploads/test.jpg',
      location: 'Bachevo'
    });
    const err = doc.validateSync();
    if (err && err.errors && err.errors.propertyKind) {
      assert.fail(`propertyKind should be optional, got error: ${err.errors.propertyKind.message}`);
    }
  });

  test('accepts propertyKind="cabin"', () => {
    const doc = new Cabin({
      name: 'Stone House',
      description: 'A cabin',
      capacity: 4,
      pricePerNight: 100,
      imageUrl: '/uploads/test.jpg',
      location: 'Bachevo',
      propertyKind: 'cabin'
    });
    const err = doc.validateSync();
    assert.ok(!err?.errors?.propertyKind, 'propertyKind=cabin should be valid');
    assert.strictEqual(doc.propertyKind, 'cabin');
  });

  test('accepts propertyKind="valley"', () => {
    const doc = new Cabin({
      name: 'A-frame',
      description: 'Valley unit',
      capacity: 2,
      pricePerNight: 80,
      imageUrl: '/uploads/test.jpg',
      location: 'Valley',
      propertyKind: 'valley'
    });
    const err = doc.validateSync();
    assert.ok(!err?.errors?.propertyKind, 'propertyKind=valley should be valid');
  });

  test('rejects unknown propertyKind values', () => {
    const doc = new Cabin({
      name: 'Mystery',
      description: 'Bad value',
      capacity: 2,
      pricePerNight: 80,
      imageUrl: '/uploads/test.jpg',
      location: 'Unknown',
      propertyKind: 'mountain'
    });
    const err = doc.validateSync();
    assert.ok(err && err.errors && err.errors.propertyKind, 'expected enum validation error');
  });
});

describe('CabinType schema accepts and validates propertyKind', () => {
  test('accepts absence of propertyKind (optional)', () => {
    const doc = new CabinType({
      name: 'A-frame Type',
      slug: 'a-frame-type',
      description: 'Multi-unit type',
      capacity: 2,
      pricePerNight: 80,
      imageUrl: '/uploads/test.jpg',
      location: 'Valley'
    });
    const err = doc.validateSync();
    if (err && err.errors && err.errors.propertyKind) {
      assert.fail(`propertyKind should be optional, got error: ${err.errors.propertyKind.message}`);
    }
  });

  test('accepts propertyKind="valley"', () => {
    const doc = new CabinType({
      name: 'A-frame Type Valid',
      slug: 'a-frame-type-valid',
      description: 'Multi-unit',
      capacity: 2,
      pricePerNight: 80,
      imageUrl: '/uploads/test.jpg',
      location: 'Valley',
      propertyKind: 'valley'
    });
    const err = doc.validateSync();
    assert.ok(!err?.errors?.propertyKind, 'propertyKind=valley should be valid');
  });

  test('rejects unknown propertyKind values', () => {
    const doc = new CabinType({
      name: 'Bad Kind',
      slug: 'bad-kind',
      description: 'd',
      capacity: 2,
      pricePerNight: 80,
      imageUrl: '/uploads/test.jpg',
      location: 'x',
      propertyKind: 'lake-house'
    });
    const err = doc.validateSync();
    assert.ok(err && err.errors && err.errors.propertyKind, 'expected enum validation error');
  });
});
