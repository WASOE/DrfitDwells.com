#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * GMA arrival metadata backfill — controlled, idempotent.
 *
 * Sets `propertyKind`, `meetingPoint` (label, googleMapsUrl, what3words only),
 * `arrivalGuideUrl`, and `arrivalWindowDefault` on pinned Cabin / CabinType rows.
 *
 * Modes:
 *   Dry-run (default — NO WRITES):
 *     node scripts/gmaArrivalMetadataBackfill.cjs
 *
 *   Apply (explicit):
 *     node scripts/gmaArrivalMetadataBackfill.cjs --apply
 *
 * Production apply additionally requires:
 *   ALLOW_PRODUCTION_GMA_ARRIVAL_METADATA=1
 *
 * Does not enable GMA rules, templates, env flags, or touch bookings/payments.
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');

const ALLOWED_TOP_LEVEL = Object.freeze([
  'propertyKind',
  'meetingPoint',
  'arrivalGuideUrl',
  'arrivalWindowDefault'
]);

const MEETING_POINT_KEYS = Object.freeze(['label', 'googleMapsUrl', 'what3words']);

const CABIN_ARRIVAL = Object.freeze({
  propertyKind: 'cabin',
  meetingPoint: Object.freeze({
    label: 'Park-and-walk point for The Cabin',
    googleMapsUrl:
      'https://www.google.com/maps/dir/?api=1&destination=41.93357665629961,23.40342403236582&travelmode=driving&dir_action=navigate',
    what3words: ''
  }),
  arrivalGuideUrl: '/guides/the-cabin',
  arrivalWindowDefault: 'From 15:00. Please message us before arrival so we can coordinate.'
});

const VALLEY_ARRIVAL = Object.freeze({
  propertyKind: 'valley',
  meetingPoint: Object.freeze({
    label:
      'Chereshovo parking. Use the route through Eleshnitsa, Palatik and Chereshovo. Ignore Google Maps if it sends you through Kraishte.',
    googleMapsUrl: 'https://maps.app.goo.gl/vTk7jCrGtxvbKsJB6',
    what3words: ''
  }),
  arrivalGuideUrl: '/guides/the-valley',
  arrivalWindowDefault: 'From 15:00. Last 1 km is on foot, jeep, horse or ATV only.'
});

const CABIN_TARGETS = Object.freeze([
  {
    model: 'Cabin',
    id: '69b2ff933a7fff6621e785cc',
    expectedName: 'The Cabin',
    desired: CABIN_ARRIVAL
  },
  {
    model: 'Cabin',
    id: '69b2ff947f141a71ffa7c452',
    expectedName: 'Stone House',
    desired: VALLEY_ARRIVAL
  },
  {
    model: 'Cabin',
    id: '69b2ff947f141a71ffa7c492',
    expectedName: 'Lux Cabin',
    desired: VALLEY_ARRIVAL
  },
  {
    model: 'Cabin',
    id: '69d096b6bd7fb6fc0d3c2a34',
    expectedName: 'A-Frame',
    desired: VALLEY_ARRIVAL
  }
]);

const CABIN_TYPE_TARGETS = Object.freeze([
  {
    model: 'CabinType',
    id: '69b2ff947f141a71ffa7c401',
    expectedName: 'A-Frame',
    desired: VALLEY_ARRIVAL
  }
]);

const ALL_TARGETS = Object.freeze([...CABIN_TARGETS, ...CABIN_TYPE_TARGETS]);

function parseArgs(argv) {
  return { apply: argv.includes('--apply') };
}

function normalizeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function pickMeetingPointSlice(doc) {
  const mp = doc?.meetingPoint;
  if (!mp || typeof mp !== 'object') {
    return { label: '', googleMapsUrl: '', what3words: '' };
  }
  return {
    label: normalizeString(mp.label),
    googleMapsUrl: normalizeString(mp.googleMapsUrl),
    what3words: normalizeString(mp.what3words)
  };
}

function pickArrivalSlice(doc) {
  return {
    propertyKind: normalizeString(doc?.propertyKind),
    meetingPoint: pickMeetingPointSlice(doc),
    arrivalGuideUrl: normalizeString(doc?.arrivalGuideUrl),
    arrivalWindowDefault: normalizeString(doc?.arrivalWindowDefault)
  };
}

function buildDesiredSlice(desired) {
  return {
    propertyKind: desired.propertyKind,
    meetingPoint: {
      label: desired.meetingPoint.label,
      googleMapsUrl: desired.meetingPoint.googleMapsUrl,
      what3words: desired.meetingPoint.what3words ?? ''
    },
    arrivalGuideUrl: desired.arrivalGuideUrl,
    arrivalWindowDefault: desired.arrivalWindowDefault
  };
}

function slicesEqual(a, b) {
  if (a.propertyKind !== b.propertyKind) return false;
  if (a.arrivalGuideUrl !== b.arrivalGuideUrl) return false;
  if (a.arrivalWindowDefault !== b.arrivalWindowDefault) return false;
  for (const key of MEETING_POINT_KEYS) {
    if (a.meetingPoint[key] !== b.meetingPoint[key]) return false;
  }
  return true;
}

function nameMatches(docName, expectedName) {
  const hay = normalizeString(docName).toLowerCase();
  const needle = normalizeString(expectedName).toLowerCase();
  if (!hay || !needle) return false;
  return hay.includes(needle);
}

function buildMongoSet(desired) {
  return {
    propertyKind: desired.propertyKind,
    'meetingPoint.label': desired.meetingPoint.label,
    'meetingPoint.googleMapsUrl': desired.meetingPoint.googleMapsUrl,
    'meetingPoint.what3words': desired.meetingPoint.what3words ?? '',
    arrivalGuideUrl: desired.arrivalGuideUrl,
    arrivalWindowDefault: desired.arrivalWindowDefault
  };
}

function getModelForTarget(target) {
  return target.model === 'CabinType' ? CabinType : Cabin;
}

function assertProductionGate(apply) {
  if (!apply) return;
  if (process.env.NODE_ENV !== 'production') return;
  const flag = String(process.env.ALLOW_PRODUCTION_GMA_ARRIVAL_METADATA || '').trim();
  if (flag !== '1') {
    console.error(
      '[gma-arrival-metadata] Refused: NODE_ENV=production. Set ALLOW_PRODUCTION_GMA_ARRIVAL_METADATA=1 to apply.'
    );
    process.exit(1);
  }
}

function printPreviewLine({ target, status, before, after }) {
  console.log(`\n--- ${target.model} ${target.id} (${target.expectedName}) — ${status} ---`);
  console.log('BEFORE:', JSON.stringify(before, null, 2));
  if (after) {
    console.log('AFTER:', JSON.stringify(after, null, 2));
  }
}

/**
 * Process all pinned targets. Returns summary and exit code hint.
 */
async function runBackfill({ apply }) {
  const summary = {
    already_correct: 0,
    to_write: 0,
    written: 0,
    missing: 0,
    name_mismatch: 0
  };

  let fatal = false;

  for (const target of ALL_TARGETS) {
    if (!mongoose.isValidObjectId(target.id)) {
      console.error(`[gma-arrival-metadata] Invalid ObjectId: ${target.id}`);
      fatal = true;
      summary.missing += 1;
      continue;
    }

    const Model = getModelForTarget(target);
    const doc = await Model.findById(target.id).lean();

    if (!doc) {
      console.error(`[gma-arrival-metadata] Missing ${target.model} id=${target.id}`);
      summary.missing += 1;
      fatal = true;
      continue;
    }

    if (!nameMatches(doc.name, target.expectedName)) {
      console.error(
        `[gma-arrival-metadata] Name mismatch ${target.model} id=${target.id}: `
        + `expected name containing "${target.expectedName}", got "${doc.name}"`
      );
      summary.name_mismatch += 1;
      fatal = true;
      continue;
    }

    const before = pickArrivalSlice(doc);
    const after = buildDesiredSlice(target.desired);

    if (slicesEqual(before, after)) {
      summary.already_correct += 1;
      printPreviewLine({ target, status: 'already_correct', before, after: null });
      continue;
    }

    summary.to_write += 1;
    printPreviewLine({
      target,
      status: apply ? 'will_write' : 'would_write',
      before,
      after
    });

    if (!apply) continue;

    const $set = buildMongoSet(target.desired);
    await Model.updateOne({ _id: target.id }, { $set });
    summary.written += 1;
  }

  return { summary, fatal };
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  assertProductionGate(apply);

  const uri = process.env.MONGODB_URI || DEFAULT_MONGO_URI;
  if (!uri) {
    console.error('[gma-arrival-metadata] MONGODB_URI (or DEFAULT_MONGO_URI) is required.');
    process.exit(1);
  }

  await mongoose.connect(uri);

  console.log(`[gma-arrival-metadata] Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`[gma-arrival-metadata] Targets: ${ALL_TARGETS.length}`);

  const { summary, fatal } = await runBackfill({ apply });

  console.log('\n=== Summary ===');
  console.log(JSON.stringify(summary, null, 2));

  await mongoose.disconnect();

  if (fatal) {
    process.exit(1);
  }
  if (apply && summary.to_write > 0 && summary.written !== summary.to_write) {
    process.exit(1);
  }
}

const __exports = {
  ALLOWED_TOP_LEVEL,
  MEETING_POINT_KEYS,
  CABIN_ARRIVAL,
  VALLEY_ARRIVAL,
  CABIN_TARGETS,
  CABIN_TYPE_TARGETS,
  ALL_TARGETS,
  pickArrivalSlice,
  buildDesiredSlice,
  slicesEqual,
  nameMatches,
  buildMongoSet,
  runBackfill,
  getModelForTarget
};

module.exports = __exports;

if (require.main === module) {
  main().catch((err) => {
    console.error('[gma-arrival-metadata] Fatal:', err?.message || err);
    mongoose.disconnect().finally(() => process.exit(1));
  });
}
