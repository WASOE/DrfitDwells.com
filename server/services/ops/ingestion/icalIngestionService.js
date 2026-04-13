const crypto = require('crypto');
const axios = require('axios');
const mongoose = require('mongoose');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const ChannelSyncEvent = require('../../../models/ChannelSyncEvent');
const CabinChannelSyncState = require('../../../models/CabinChannelSyncState');
const Cabin = require('../../../models/Cabin');
const Unit = require('../../../models/Unit');
const { findParentCabinForCabinType } = require('../../publicAvailabilityService');
const { normalizeExclusiveDateRange } = require('../../../utils/dateTime');
const { openManualReviewItem } = require('./manualReviewService');

function syncStateFilter(cabinId, channel, unitOid) {
  return { cabinId, channel, unitId: unitOid || null };
}

function parseUnitOidArg(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

/**
 * Rule 4: multi-inventory parents require a mapped active unit; single-inventory must not set unitId.
 * @returns {Promise<{ ok: boolean, unitOid: import('mongoose').Types.ObjectId | null, code?: string, message?: string }>}
 */
async function resolveInboundUnitForImport(cabinId, unitIdRaw) {
  const cabin = await Cabin.findById(cabinId).select('inventoryType').lean();
  if (!cabin) {
    return { ok: false, unitOid: null, code: 'cabin_not_found', message: 'Cabin not found' };
  }
  const isMulti = cabin.inventoryType === 'multi';
  let unitOid = null;
  if (unitIdRaw != null && String(unitIdRaw).trim() !== '') {
    const s = String(unitIdRaw).trim();
    if (!mongoose.Types.ObjectId.isValid(s)) {
      return { ok: false, unitOid: null, code: 'invalid_unit', message: 'Invalid unitId' };
    }
    unitOid = new mongoose.Types.ObjectId(s);
  }

  if (isMulti) {
    if (!unitOid) {
      return {
        ok: false,
        unitOid: null,
        code: 'unit_required',
        message: 'unitId is required for multi-inventory inbound Airbnb sync (map one listing to one unit)'
      };
    }
    const unit = await Unit.findById(unitOid).select('cabinTypeId isActive').lean();
    if (!unit || unit.isActive === false) {
      return { ok: false, unitOid: null, code: 'unit_inactive', message: 'Unit not found or inactive' };
    }
    const parent = await findParentCabinForCabinType(unit.cabinTypeId);
    if (!parent || String(parent._id) !== String(cabinId)) {
      return { ok: false, unitOid: null, code: 'unit_parent_mismatch', message: 'Unit does not belong to this parent cabin' };
    }
    return { ok: true, unitOid, message: null };
  }

  if (unitOid) {
    return { ok: false, unitOid: null, code: 'unit_forbidden', message: 'unitId must not be set for single-inventory cabin' };
  }
  return { ok: true, unitOid: null, message: null };
}

function unfoldIcalLines(input) {
  const rawLines = String(input || '').split(/\r?\n/);
  const lines = [];
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function parseDateToken(value) {
  if (!value) return null;
  if (/^\d{8}$/.test(value)) {
    const y = value.slice(0, 4);
    const m = value.slice(4, 6);
    const d = value.slice(6, 8);
    return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
  }
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    const y = value.slice(0, 4);
    const m = value.slice(4, 6);
    const d = value.slice(6, 8);
    const hh = value.slice(9, 11);
    const mm = value.slice(11, 13);
    const ss = value.slice(13, 15);
    return new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}.000Z`);
  }
  return null;
}

function parseIcalEvents(icalText) {
  const lines = unfoldIcalLines(icalText);
  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const keyPart = line.slice(0, sep);
    const value = line.slice(sep + 1).trim();
    const key = keyPart.split(';')[0].toUpperCase();
    if (!current[key]) current[key] = value;
  }

  return events;
}

function deriveDeterministicKey({
  cabinId,
  unitId = null,
  startDate,
  endDate,
  summary = '',
  source = 'airbnb_ical'
}) {
  const u = unitId ? String(unitId) : '';
  const payload = `${cabinId}|${u}|${startDate.toISOString()}|${endDate.toISOString()}|${summary.trim().toLowerCase()}|${source}`;
  return `derived:${crypto.createHash('sha1').update(payload).digest('hex')}`;
}

function normalizeEventToBlockInput(cabinId, eventRaw) {
  const dtStart = parseDateToken(eventRaw.DTSTART);
  const dtEnd = parseDateToken(eventRaw.DTEND);
  if (!dtStart || !dtEnd) return null;
  const normalized = normalizeExclusiveDateRange(dtStart, dtEnd);
  return {
    cabinId,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    uid: eventRaw.UID || null,
    summary: eventRaw.SUMMARY || null
  };
}

async function importIcalForCabin({ cabinId, feedUrl, channel = 'airbnb_ical', unitId: unitIdArg = null }) {
  const runAt = new Date();
  if (!feedUrl) {
    await openManualReviewItem({
      category: 'sync_feed_unreachable',
      severity: 'high',
      entityType: 'Cabin',
      entityId: cabinId,
      title: 'Missing iCal feed URL',
      details: 'No iCal feed URL configured for cabin',
      provenance: { source: channel, sourceReference: String(cabinId), detectedAt: runAt },
      evidence: {}
    });
    await ChannelSyncEvent.create({
      cabinId,
      channel,
      runAt,
      outcome: 'failed',
      message: 'Missing feed URL',
      anomalyType: 'feed_unreachable',
      metadata: {}
    });
    // Never clear persisted feedUrl on a missing-run input — that bricks scheduler/manual retry.
    await CabinChannelSyncState.findOneAndUpdate(
      syncStateFilter(cabinId, channel, parseUnitOidArg(unitIdArg)),
      { $set: { lastSyncedAt: runAt, lastSyncOutcome: 'failed', lastSyncMessage: 'Missing feed URL' } },
      { upsert: true, new: true }
    );
    return { outcome: 'failed', imported: 0, tombstoned: 0 };
  }

  const inbound = await resolveInboundUnitForImport(cabinId, unitIdArg);
  if (!inbound.ok) {
    const attemptedUnit = parseUnitOidArg(unitIdArg);
    await ChannelSyncEvent.create({
      cabinId,
      channel,
      runAt,
      outcome: 'failed',
      message: inbound.message,
      anomalyType: 'sync_unit_mapping',
      metadata: { code: inbound.code, feedUrl }
    });
    await CabinChannelSyncState.findOneAndUpdate(
      syncStateFilter(cabinId, channel, attemptedUnit),
      { $set: { feedUrl, lastSyncedAt: runAt, lastSyncOutcome: 'failed', lastSyncMessage: inbound.message } },
      { upsert: true, new: true }
    );
    return { outcome: 'failed', imported: 0, tombstoned: 0, code: inbound.code };
  }
  const unitOid = inbound.unitOid;

  let responseText = '';
  try {
    const response = await axios.get(feedUrl, {
      timeout: 15000,
      responseType: 'text',
      validateStatus: (status) => status >= 200 && status < 300
    });
    responseText = String(response.data || '');
  } catch (error) {
    await openManualReviewItem({
      category: 'sync_feed_unreachable',
      severity: 'high',
      entityType: 'Cabin',
      entityId: cabinId,
      title: 'iCal feed unreachable',
      details: `Failed to fetch iCal feed: ${error.message}`,
      provenance: { source: channel, sourceReference: feedUrl, detectedAt: runAt },
      evidence: { error: error.message }
    });
    await ChannelSyncEvent.create({
      cabinId,
      channel,
      runAt,
      outcome: 'failed',
      message: `Feed fetch failed: ${error.message}`,
      anomalyType: 'feed_unreachable',
      metadata: { feedUrl }
    });
    await CabinChannelSyncState.findOneAndUpdate(
      syncStateFilter(cabinId, channel, unitOid),
      { $set: { feedUrl, lastSyncedAt: runAt, lastSyncOutcome: 'failed', lastSyncMessage: error.message } },
      { upsert: true, new: true }
    );
    return { outcome: 'failed', imported: 0, tombstoned: 0 };
  }

  let events = [];
  try {
    events = parseIcalEvents(responseText);
  } catch (error) {
    await openManualReviewItem({
      category: 'sync_parse_failure',
      severity: 'high',
      entityType: 'Cabin',
      entityId: cabinId,
      title: 'iCal parse failure',
      details: `Failed to parse iCal payload: ${error.message}`,
      provenance: { source: channel, sourceReference: feedUrl, detectedAt: runAt },
      evidence: {}
    });
    await ChannelSyncEvent.create({
      cabinId,
      channel,
      runAt,
      outcome: 'failed',
      message: `Parse failed: ${error.message}`,
      anomalyType: 'parse_failure',
      metadata: { feedUrl }
    });
    await CabinChannelSyncState.findOneAndUpdate(
      syncStateFilter(cabinId, channel, unitOid),
      { $set: { feedUrl, lastSyncedAt: runAt, lastSyncOutcome: 'failed', lastSyncMessage: error.message } },
      { upsert: true, new: true }
    );
    return { outcome: 'failed', imported: 0, tombstoned: 0 };
  }

  const sourceReferencesSeen = new Set();
  const parsedBlocks = [];
  let warnings = 0;
  for (const eventRaw of events) {
    const blockInput = normalizeEventToBlockInput(cabinId, eventRaw);
    if (!blockInput) {
      warnings += 1;
      continue;
    }
    const derivedKey = blockInput.uid
      ? `uid:${unitOid ? `${String(unitOid)}:` : ''}${String(blockInput.uid)}`
      : deriveDeterministicKey({
          cabinId,
          unitId: unitOid,
          startDate: blockInput.startDate,
          endDate: blockInput.endDate,
          summary: blockInput.summary || '',
          source: channel
        });
    if (sourceReferencesSeen.has(derivedKey)) {
      warnings += 1;
      await openManualReviewItem({
        category: 'sync_duplicate_import',
        severity: 'medium',
        entityType: 'Cabin',
        entityId: cabinId,
        title: 'Duplicate iCal event key during import',
        details: `Duplicate event key ${derivedKey} in single import run`,
        provenance: { source: channel, sourceReference: feedUrl, detectedAt: runAt },
        evidence: { key: derivedKey }
      });
      continue;
    }
    if (derivedKey.startsWith('derived:')) {
      await openManualReviewItem({
        category: 'sync_deterministic_key_risk',
        severity: 'low',
        entityType: 'Cabin',
        entityId: cabinId,
        title: 'iCal event missing UID',
        details: 'Importer used deterministic key because UID was missing',
        provenance: { source: channel, sourceReference: derivedKey, detectedAt: runAt },
        evidence: {
          startDate: blockInput.startDate,
          endDate: blockInput.endDate
        }
      });
    }
    sourceReferencesSeen.add(derivedKey);
    parsedBlocks.push({
      ...blockInput,
      sourceReference: `${channel}:${derivedKey}`
    });
  }

  let createdOrUpdated = 0;
  for (const block of parsedBlocks) {
    await AvailabilityBlock.findOneAndUpdate(
      {
        cabinId: block.cabinId,
        blockType: 'external_hold',
        source: channel,
        sourceReference: block.sourceReference,
        unitId: unitOid || null
      },
      {
        $set: {
          startDate: block.startDate,
          endDate: block.endDate,
          status: 'active',
          tombstonedAt: null,
          tombstoneReason: null,
          unitId: unitOid || null,
          metadata: {
            summary: block.summary || null
          }
        },
        $setOnInsert: {
          reservationId: null,
          importedAt: runAt,
          confidence: 'medium'
        }
      },
      { upsert: true, new: true }
    );
    createdOrUpdated += 1;
  }

  const currentRefs = parsedBlocks.map((b) => b.sourceReference);
  const toTombstone = await AvailabilityBlock.find({
    cabinId,
    blockType: 'external_hold',
    source: channel,
    status: 'active',
    unitId: unitOid || null,
    sourceReference: { $nin: currentRefs }
  }).lean();

  let tombstoned = 0;
  if (toTombstone.length > 0) {
    const ids = toTombstone.map((x) => x._id);
    const result = await AvailabilityBlock.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          status: 'tombstoned',
          tombstonedAt: runAt,
          tombstoneReason: 'removed_from_feed'
        }
      }
    );
    tombstoned = result.modifiedCount || 0;
  }

  const outcome = warnings > 0 ? 'warning' : 'success';
  await ChannelSyncEvent.create({
    cabinId,
    channel,
    runAt,
    outcome,
    message: `Imported ${createdOrUpdated} holds, tombstoned ${tombstoned}`,
    anomalyType: warnings > 0 ? 'import_warning' : null,
    stats: {
      eventsParsed: events.length,
      blocksUpserted: createdOrUpdated,
      tombstoned
    },
    metadata: {
      warnings,
      feedUrl,
      unitId: unitOid ? String(unitOid) : null
    }
  });
  await CabinChannelSyncState.findOneAndUpdate(
    syncStateFilter(cabinId, channel, unitOid),
    {
      $set: {
        feedUrl,
        lastSyncedAt: runAt,
        lastSyncOutcome: outcome,
        lastSyncMessage: `Imported ${createdOrUpdated} holds, tombstoned ${tombstoned}`,
        metadata: {
          warnings
        }
      }
    },
    { upsert: true, new: true }
  );

  return {
    outcome,
    imported: createdOrUpdated,
    tombstoned,
    warnings
  };
}

module.exports = {
  importIcalForCabin,
  parseIcalEvents,
  deriveDeterministicKey,
  resolveInboundUnitForImport,
  syncStateFilter
};
