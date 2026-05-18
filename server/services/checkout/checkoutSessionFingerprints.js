const crypto = require('crypto');
const { formatSofiaDateOnly } = require('../../utils/dateTime');

function hashFingerprintPayload(parts) {
  return crypto.createHash('sha256').update(parts.join('|'), 'utf8').digest('hex');
}

function resolveEntityRef(normalized) {
  if (normalized.entityType === 'cabinType') {
    return { entityType: 'cabinType', entityId: normalized.cabinTypeId || '' };
  }
  return { entityType: 'cabin', entityId: normalized.cabinId || '' };
}

/**
 * Commercial boundary: entity + stay dates only. Promo/voucher/guest/extras stay on same session.
 */
function buildCommercialBoundaryKey(normalized) {
  const { entityType, entityId } = resolveEntityRef(normalized);
  return [
    'v1',
    entityType,
    entityId,
    normalized.checkInDateOnly || '',
    normalized.checkOutDateOnly || ''
  ].join('|');
}

/**
 * C3 cross-session guard. Requires guest email; null until email is known (set on refresh).
 */
function buildStayFingerprint(normalized) {
  const email = normalized.guestEmail || '';
  if (!email) {
    return null;
  }
  const { entityType, entityId } = resolveEntityRef(normalized);
  return hashFingerprintPayload([
    'stay-v1',
    email,
    entityType,
    entityId,
    normalized.checkInDateOnly || '',
    normalized.checkOutDateOnly || ''
  ]);
}

/**
 * Same-checkout replay helper (finalize replay alignment). Includes guest counts, not email.
 */
function buildReplayFingerprint(normalized) {
  const { entityType, entityId } = resolveEntityRef(normalized);
  return hashFingerprintPayload([
    'replay-v1',
    entityType,
    entityId,
    normalized.checkInDateOnly || '',
    normalized.checkOutDateOnly || '',
    String(normalized.adults ?? 0),
    String(normalized.children ?? 0)
  ]);
}

function boundaryKeyFromSnapshot(snapshot) {
  if (!snapshot) return '';
  const entityType = snapshot.entityType === 'cabinType' ? 'cabinType' : 'cabin';
  const entityId =
    entityType === 'cabinType'
      ? String(snapshot.cabinTypeId || '')
      : String(snapshot.cabinId || '');
  return ['v1', entityType, entityId, snapshot.checkInDateOnly || '', snapshot.checkOutDateOnly || ''].join(
    '|'
  );
}

function toDateOnly(value) {
  if (value == null || value === '') return '';
  return formatSofiaDateOnly(value);
}

module.exports = {
  buildCommercialBoundaryKey,
  buildStayFingerprint,
  buildReplayFingerprint,
  boundaryKeyFromSnapshot,
  toDateOnly
};
