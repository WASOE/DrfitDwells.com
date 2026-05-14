'use strict';

/**
 * propertyKindResolver
 *
 * The single sanctioned read path for `propertyKind` for the guest message
 * automation system. The resolver only reads the persisted enum field. It
 * never infers from `location`, `name`, `slug`, or any other legacy signal —
 * inference lives exclusively in the controlled backfill script
 * (`server/scripts/backfillPropertyKind.js`) and never at runtime.
 *
 * Throws `PropertyKindUnresolvedError` when:
 *   - the document is missing
 *   - `propertyKind` is missing / null / empty
 *   - `propertyKind` is not one of the allowed enum values
 *
 * See `docs/guest-message-automation/02_V1_SPEC.md` §6.
 */

const PROPERTY_KINDS = Object.freeze(['cabin', 'valley']);
const ALLOWED_SET = new Set(PROPERTY_KINDS);

class PropertyKindUnresolvedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'PropertyKindUnresolvedError';
    this.code = 'PROPERTY_KIND_UNRESOLVED';
    this.details = details;
  }
}

function isAllowed(value) {
  return typeof value === 'string' && ALLOWED_SET.has(value);
}

function resolveFromDoc(doc, entityType) {
  if (!doc) {
    throw new PropertyKindUnresolvedError(
      `${entityType} document is missing; cannot resolve propertyKind.`,
      { entityType, reason: 'missing_document' }
    );
  }

  const id = doc._id != null ? String(doc._id) : null;
  const value = doc.propertyKind;

  if (value == null || value === '') {
    throw new PropertyKindUnresolvedError(
      `${entityType} ${id || '(unknown id)'} has no propertyKind set.`,
      { entityType, entityId: id, reason: 'unset' }
    );
  }

  if (!isAllowed(value)) {
    throw new PropertyKindUnresolvedError(
      `${entityType} ${id || '(unknown id)'} has invalid propertyKind=${JSON.stringify(value)}.`,
      { entityType, entityId: id, reason: 'invalid_value', value }
    );
  }

  return value;
}

function resolvePropertyKindFromCabinDoc(cabinDoc) {
  return resolveFromDoc(cabinDoc, 'Cabin');
}

function resolvePropertyKindFromCabinTypeDoc(cabinTypeDoc) {
  return resolveFromDoc(cabinTypeDoc, 'CabinType');
}

module.exports = {
  PROPERTY_KINDS,
  PropertyKindUnresolvedError,
  resolvePropertyKindFromCabinDoc,
  resolvePropertyKindFromCabinTypeDoc
};
