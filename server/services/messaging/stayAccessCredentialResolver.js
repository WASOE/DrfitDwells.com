'use strict';

/**
 * Resolves lock codes and access-only template fields for GMA guest access emails.
 * Never used by public guide routes.
 */

const Unit = require('../../models/Unit');
const { STAY_SLUGS, resolveCabinSlugFromDoc } = require('../../utils/staySlug');
const {
  CABIN_GOOGLE_EARTH_URL,
  CABIN_LOCK_CODE,
  VALLEY_LOCK_CODES,
  A_FRAME_LOCK_CODES_BY_UNIT_INDEX,
  STONE_HOUSE_WIFI_NETWORK,
  VALLEY_TRANSFER_OFFER_NOTE
} = require('../../data/stayAccessCredentials');

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

function isAFrameCabinType(stayTarget) {
  return normalizeSlug(stayTarget?.slug) === STAY_SLUGS.A_FRAME;
}

/**
 * Parse A-Frame unit index from Unit fields. Returns null when unreliable.
 */
function resolveAFrameUnitIndex(unit) {
  if (!unit || typeof unit !== 'object') return null;

  const displayName = String(unit.displayName || '').trim();
  const unitNumber = String(unit.unitNumber || '').trim();

  let match = displayName.match(/a-?\s*frame\s*#?\s*(\d+)/i);
  if (match) return Number.parseInt(match[1], 10);

  match = unitNumber.match(/AF-0*(\d+)/i);
  if (match) return Number.parseInt(match[1], 10);

  match = unitNumber.match(/^(\d+)$/);
  if (match) return Number.parseInt(match[1], 10);

  return null;
}

function buildUnitLabel(unit) {
  if (!unit || typeof unit !== 'object') return '';
  const displayName = String(unit.displayName || '').trim();
  if (displayName) return displayName;
  const unitNumber = String(unit.unitNumber || '').trim();
  if (!unitNumber) return '';
  if (/^unit\b/i.test(unitNumber)) return unitNumber;
  if (/^AF-/i.test(unitNumber)) {
    const idx = resolveAFrameUnitIndex(unit);
    if (idx != null) return `A-Frame ${idx}`;
  }
  return `Unit ${unitNumber}`;
}

function buildWifiAccessBlock(staySlug) {
  if (staySlug === STAY_SLUGS.STONE_HOUSE) {
    return [
      '<p>WiFi is available in the communal space of the Stone House.<br>',
      'WiFi:<br>',
      `${STONE_HOUSE_WIFI_NETWORK}</p>`
    ].join('');
  }
  return '';
}

async function loadBookingUnit(booking) {
  if (!booking?.unitId) return null;
  if (typeof booking.unitId === 'object' && booking.unitId.unitNumber) {
    return booking.unitId;
  }
  const unitId = booking.unitId._id || booking.unitId;
  return Unit.findById(unitId).lean();
}

/**
 * @returns {Promise<{ ok: true, credentials: object, resolutionSource: string } | { ok: false, missing: string[], blockReason: string, resolutionSource?: string }>}
 */
async function resolveStayAccessCredentials({ booking, stayTarget, propertyKind }) {
  if (!booking || !stayTarget) {
    return { ok: false, missing: ['booking', 'stayTarget'], blockReason: 'missing_context' };
  }

  if (propertyKind === 'cabin') {
    const staySlug = resolveCabinSlugFromDoc(stayTarget);
    if (staySlug !== STAY_SLUGS.THE_CABIN) {
      return {
        ok: false,
        missing: ['lockCode'],
        blockReason: 'unknown_cabin_stay',
        resolutionSource: staySlug || 'unresolved_cabin_slug'
      };
    }
    return {
      ok: true,
      resolutionSource: 'cabin:the-cabin',
      credentials: {
        lockCode: CABIN_LOCK_CODE,
        unitLabel: '',
        wifiNetworkName: '',
        wifiAccessBlock: '',
        googleEarthUrl: CABIN_GOOGLE_EARTH_URL,
        transferOfferNote: ''
      }
    };
  }

  if (propertyKind !== 'valley') {
    return {
      ok: false,
      missing: ['lockCode'],
      blockReason: 'unsupported_property_kind',
      resolutionSource: String(propertyKind || 'unknown')
    };
  }

  if (booking.cabinId) {
    const staySlug = resolveCabinSlugFromDoc(stayTarget);
    const lockCode = staySlug ? VALLEY_LOCK_CODES[staySlug] : null;
    if (!lockCode) {
      return {
        ok: false,
        missing: ['lockCode'],
        blockReason: 'unknown_valley_cabin',
        resolutionSource: staySlug || 'unresolved_cabin_slug'
      };
    }
    const wifiAccessBlock = buildWifiAccessBlock(staySlug);
    return {
      ok: true,
      resolutionSource: `valley:cabin:${staySlug}`,
      credentials: {
        lockCode,
        unitLabel: '',
        wifiNetworkName: staySlug === STAY_SLUGS.STONE_HOUSE ? STONE_HOUSE_WIFI_NETWORK : '',
        wifiAccessBlock,
        googleEarthUrl: '',
        transferOfferNote: VALLEY_TRANSFER_OFFER_NOTE
      }
    };
  }

  if (booking.cabinTypeId && isAFrameCabinType(stayTarget)) {
    if (!booking.unitId) {
      return {
        ok: false,
        missing: ['lockCode', 'unitAssignment'],
        blockReason: 'a_frame_unit_unassigned',
        resolutionSource: 'valley:a-frame:missing_unitId'
      };
    }

    const unit = await loadBookingUnit(booking);
    if (!unit) {
      return {
        ok: false,
        missing: ['lockCode', 'unitAssignment'],
        blockReason: 'a_frame_unit_not_found',
        resolutionSource: 'valley:a-frame:unit_missing'
      };
    }

    const unitIndex = resolveAFrameUnitIndex(unit);
    if (unitIndex == null) {
      return {
        ok: false,
        missing: ['lockCode', 'unitAssignment'],
        blockReason: 'a_frame_unit_unidentified',
        resolutionSource: `valley:a-frame:unit:${unit.unitNumber || 'unknown'}`
      };
    }

    if (unitIndex === 1) {
      return {
        ok: false,
        missing: ['lockCode', 'a_frame_1_blocked'],
        blockReason: 'a_frame_1_not_automated',
        resolutionSource: 'valley:a-frame:unit_index_1'
      };
    }

    const lockCode = A_FRAME_LOCK_CODES_BY_UNIT_INDEX[unitIndex];
    if (!lockCode) {
      return {
        ok: false,
        missing: ['lockCode'],
        blockReason: 'a_frame_unit_not_supported',
        resolutionSource: `valley:a-frame:unit_index_${unitIndex}`
      };
    }

    const unitLabel = buildUnitLabel(unit);
    return {
      ok: true,
      resolutionSource: `valley:a-frame:unit_index_${unitIndex}`,
      credentials: {
        lockCode,
        unitLabel,
        wifiNetworkName: '',
        wifiAccessBlock: '',
        googleEarthUrl: '',
        transferOfferNote: VALLEY_TRANSFER_OFFER_NOTE
      }
    };
  }

  return {
    ok: false,
    missing: ['lockCode'],
    blockReason: 'unknown_valley_stay',
    resolutionSource: normalizeSlug(stayTarget?.slug) || 'unknown'
  };
}

module.exports = {
  resolveStayAccessCredentials,
  resolveAFrameUnitIndex,
  buildWifiAccessBlock,
  buildUnitLabel,
  isAFrameCabinType
};
