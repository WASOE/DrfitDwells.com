'use strict';

/**
 * Durable booking-scoped arrival communication revision (PR2).
 *
 * - lastCommunicatedRevision null → nothing communicated yet
 * - lastCommunicatedRevision 0 → initial accepted
 * - lastCommunicatedRevision N>=1 → correction rev N accepted
 *
 * State key captures itinerary identity. Returning to the last communicated
 * state cancels pending corrections (no unnecessary email).
 */

const moment = require('moment-timezone');
const { PROPERTY_TIMEZONE } = require('../../../utils/dateTime');

function sofiaDayKey(value) {
  if (value == null) return '';
  const m = moment.tz(value, PROPERTY_TIMEZONE);
  if (!m.isValid()) return '';
  return m.format('YYYY-MM-DD');
}

function oid(value) {
  if (value == null) return '';
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

/**
 * Stable itinerary key for stay communication (not used as MessageDispatch key).
 */
function buildArrivalStateKey(booking, propertyKind) {
  return [
    sofiaDayKey(booking?.checkIn),
    sofiaDayKey(booking?.checkOut),
    String(propertyKind || ''),
    oid(booking?.cabinId),
    oid(booking?.cabinTypeId),
    oid(booking?.unitId)
  ].join('|');
}

function readArrivalComms(booking) {
  const raw = booking?.arrivalCommsV2;
  if (!raw || typeof raw !== 'object') {
    return {
      scheduleGeneration: 0,
      communicationRevision: 0,
      lastCommunicatedRevision: null,
      lastCommunicatedStateKey: null,
      coalesceUntil: null,
      pendingCorrectionRevision: null
    };
  }
  return {
    scheduleGeneration: Number(raw.scheduleGeneration) || 0,
    communicationRevision: Number(raw.communicationRevision) || 0,
    lastCommunicatedRevision:
      raw.lastCommunicatedRevision == null ? null : Number(raw.lastCommunicatedRevision),
    lastCommunicatedStateKey: raw.lastCommunicatedStateKey || null,
    coalesceUntil: raw.coalesceUntil ? new Date(raw.coalesceUntil) : null,
    pendingCorrectionRevision:
      raw.pendingCorrectionRevision == null ? null : Number(raw.pendingCorrectionRevision)
  };
}

function initialAlreadyCommunicated(comms) {
  return comms.lastCommunicatedRevision != null;
}

function stateMatchesLastCommunicated(comms, stateKey) {
  return (
    comms.lastCommunicatedStateKey != null &&
    stateKey != null &&
    String(comms.lastCommunicatedStateKey) === String(stateKey)
  );
}

module.exports = {
  buildArrivalStateKey,
  readArrivalComms,
  initialAlreadyCommunicated,
  stateMatchesLastCommunicated
};
