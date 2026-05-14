#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Controlled, idempotent backfill of `propertyKind` for `Cabin` and `CabinType`.
 *
 * Modes:
 *
 *   Dry-run (default — NO WRITES):
 *     node scripts/backfillPropertyKind.js
 *
 *   Apply (explicit, refuses unresolved/conflict):
 *     node scripts/backfillPropertyKind.js --apply
 *
 * Rules (per docs/guest-message-automation/02_V1_SPEC.md §7 and
 * docs/guest-message-automation/03_IMPLEMENTATION_BATCHES.md Batch 2):
 *
 *   - Dry-run is the default and never mutates data.
 *   - Dry-run inspects legacy signals (location, name, slug) AND an explicit
 *     in-script manual allowlist, ONLY to propose values.
 *   - Resolved proposals and unresolved/ambiguous rows are printed separately.
 *   - Apply mode requires `--apply` and aborts (exit 1) if any unresolved or
 *     conflict rows exist. No `--force` flag is supported in Batch 2.
 *   - A "conflict" is a row whose stored `propertyKind` differs from the
 *     proposal; the script never overwrites those.
 *   - Apply is idempotent: rows already matching the proposal are skipped.
 *   - Each successful write emits an AuditEvent via the standard auditWriter.
 *   - No public route. No OPS UI. Run by an engineer with shell access only.
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const { appendAuditEvent } = require('../services/auditWriter');
const { PROPERTY_KINDS } = require('../services/messaging/propertyKindResolver');

/**
 * MANUAL ALLOWLIST
 *
 * Use this section to pin a specific record to a propertyKind when the
 * heuristic cannot safely classify it on its own. The allowlist is the
 * ONLY safe override; everything else flows through the heuristic and the
 * unresolved/conflict guards.
 *
 * Keys are accepted as either a Mongo ObjectId string or, for CabinType,
 * a slug (lowercase). The script will resolve either form at dry-run time.
 *
 * Edit this map in a focused PR; do not edit it during a live backfill run.
 */
const MANUAL_ALLOWLIST = Object.freeze({
  cabin: {
    // '<objectIdString>': 'cabin' | 'valley',
  },
  cabinType: {
    // 'a-frame': 'valley',
    // '<objectIdString>': 'valley',
  }
});

// Heuristic tokens. Kept tight and explicit so that "valley" winning over
// "cabin" requires a real signal — and so a record carrying both words is
// surfaced as ambiguous, not silently classified.
const CABIN_TOKENS = ['cabin', 'stone house', 'lux cabin', 'bachevo'];
const VALLEY_TOKENS = ['valley', 'a-frame', 'a frame', 'aframe'];

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply')
  };
}

function lower(s) {
  return typeof s === 'string' ? s.toLowerCase() : '';
}

function tokensFoundIn(haystack, tokens) {
  return tokens.filter((t) => haystack.includes(t));
}

/**
 * Propose a propertyKind based on (a) the manual allowlist, (b) tight
 * lowercase token matches on name/slug/location. The function returns either
 * a successful proposal or an unresolved record describing why.
 */
function proposeKind({ model, doc }) {
  const id = String(doc._id);
  const name = doc.name || '';
  const slug = doc.slug || null;
  const location = doc.location || '';

  // 1. Manual allowlist (id wins; slug second).
  const allowlistTable = model === 'Cabin' ? MANUAL_ALLOWLIST.cabin : MANUAL_ALLOWLIST.cabinType;
  if (allowlistTable[id]) {
    const proposed = allowlistTable[id];
    if (!PROPERTY_KINDS.includes(proposed)) {
      return {
        status: 'unresolved',
        reason: `manual_allowlist_invalid:${proposed}`,
        signals: { source: 'manual_allowlist_by_id' }
      };
    }
    return {
      status: 'resolved',
      proposed,
      source: 'manual_allowlist_by_id',
      signals: { matched: id }
    };
  }
  if (slug && allowlistTable[slug]) {
    const proposed = allowlistTable[slug];
    if (!PROPERTY_KINDS.includes(proposed)) {
      return {
        status: 'unresolved',
        reason: `manual_allowlist_invalid:${proposed}`,
        signals: { source: 'manual_allowlist_by_slug' }
      };
    }
    return {
      status: 'resolved',
      proposed,
      source: 'manual_allowlist_by_slug',
      signals: { matched: slug }
    };
  }

  // 2. Heuristic.
  const haystack = `${lower(name)} | ${lower(slug || '')} | ${lower(location)}`;
  const cabinHits = tokensFoundIn(haystack, CABIN_TOKENS);
  const valleyHits = tokensFoundIn(haystack, VALLEY_TOKENS);

  const cabinScore = cabinHits.length;
  const valleyScore = valleyHits.length;

  if (cabinScore > 0 && valleyScore === 0) {
    return {
      status: 'resolved',
      proposed: 'cabin',
      source: 'heuristic',
      signals: { cabinHits, valleyHits }
    };
  }
  if (valleyScore > 0 && cabinScore === 0) {
    return {
      status: 'resolved',
      proposed: 'valley',
      source: 'heuristic',
      signals: { cabinHits, valleyHits }
    };
  }
  if (cabinScore > 0 && valleyScore > 0) {
    return {
      status: 'unresolved',
      reason: 'ambiguous_signals',
      signals: { cabinHits, valleyHits }
    };
  }
  return {
    status: 'unresolved',
    reason: 'no_signal_match',
    signals: { cabinHits, valleyHits }
  };
}

function snapshotForReport(model, doc, proposal) {
  return {
    model,
    _id: String(doc._id),
    name: doc.name || null,
    slug: doc.slug || null,
    location: doc.location || null,
    isActive: typeof doc.isActive === 'boolean' ? doc.isActive : null,
    currentPropertyKind: doc.propertyKind ?? null,
    proposedPropertyKind: proposal.status === 'resolved' ? proposal.proposed : null,
    proposalSource: proposal.source || null,
    signals: proposal.signals || null,
    reason: proposal.reason || null
  };
}

/**
 * Classify each row into one of:
 *   - already_correct: stored value === proposed; apply is a no-op.
 *   - to_write:        proposal resolved, no stored value yet.
 *   - conflict:        proposal resolved, stored value differs.
 *   - unresolved:      heuristic + allowlist did not produce a confident value.
 */
function classifyRow(model, doc) {
  const proposal = proposeKind({ model, doc });
  const report = snapshotForReport(model, doc, proposal);

  if (proposal.status === 'unresolved') {
    return { kind: 'unresolved', report };
  }

  const stored = doc.propertyKind || null;
  if (stored === proposal.proposed) {
    return { kind: 'already_correct', report };
  }
  if (stored == null || stored === '') {
    return { kind: 'to_write', report, proposal };
  }
  return { kind: 'conflict', report };
}

async function loadAllRows() {
  const [cabins, cabinTypes] = await Promise.all([
    Cabin.find({}).select('_id name location isActive propertyKind').lean(),
    CabinType.find({}).select('_id name slug location isActive propertyKind').lean()
  ]);
  return { cabins, cabinTypes };
}

function classifyAll(rows) {
  const buckets = {
    already_correct: [],
    to_write: [],
    conflict: [],
    unresolved: []
  };
  for (const doc of rows.cabins) {
    const c = classifyRow('Cabin', doc);
    buckets[c.kind].push(c);
  }
  for (const doc of rows.cabinTypes) {
    const c = classifyRow('CabinType', doc);
    buckets[c.kind].push(c);
  }
  return buckets;
}

function printReport({ mode, buckets, willApply }) {
  const summary = {
    mode,
    counts: {
      already_correct: buckets.already_correct.length,
      to_write: buckets.to_write.length,
      conflict: buckets.conflict.length,
      unresolved: buckets.unresolved.length
    },
    willApply
  };
  console.log(JSON.stringify({ kind: 'summary', ...summary }, null, 2));

  if (buckets.to_write.length > 0) {
    console.log(JSON.stringify({ kind: 'to_write', rows: buckets.to_write.map((r) => r.report) }, null, 2));
  }
  if (buckets.already_correct.length > 0) {
    console.log(JSON.stringify({ kind: 'already_correct', rows: buckets.already_correct.map((r) => r.report) }, null, 2));
  }
  if (buckets.conflict.length > 0) {
    console.log(JSON.stringify({ kind: 'conflict', rows: buckets.conflict.map((r) => r.report) }, null, 2));
  }
  if (buckets.unresolved.length > 0) {
    console.log(JSON.stringify({ kind: 'unresolved', rows: buckets.unresolved.map((r) => r.report) }, null, 2));
  }
}

async function applyWrites(toWrite) {
  const results = [];
  for (const entry of toWrite) {
    const { report, proposal } = entry;
    const model = report.model === 'Cabin' ? Cabin : CabinType;

    const before = { propertyKind: report.currentPropertyKind };
    const after = { propertyKind: proposal.proposed };

    const updateRes = await model.updateOne(
      { _id: report._id, $or: [{ propertyKind: { $exists: false } }, { propertyKind: null }, { propertyKind: '' }] },
      { $set: { propertyKind: proposal.proposed } }
    );

    if (updateRes.modifiedCount === 1) {
      await appendAuditEvent({
        actorType: 'system',
        actorId: 'property_kind_backfill',
        entityType: report.model,
        entityId: report._id,
        action: 'property_kind_set',
        beforeSnapshot: before,
        afterSnapshot: after,
        metadata: {
          name: report.name,
          slug: report.slug,
          location: report.location,
          proposalSource: report.proposalSource,
          signals: report.signals
        },
        sourceContext: { source: 'scripts/backfillPropertyKind.js' }
      });
      results.push({ _id: report._id, model: report.model, written: true });
    } else {
      // Lost the race: the document changed under us (now has a value or no longer
      // exists). Skip silently in the report but flag it for visibility.
      results.push({
        _id: report._id,
        model: report.model,
        written: false,
        skipped: true,
        reason: 'precondition_not_met_at_write'
      });
    }
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;

  await mongoose.connect(mongoUri);

  try {
    const rows = await loadAllRows();
    const buckets = classifyAll(rows);

    // Dry-run report (always printed before any write).
    printReport({
      mode: args.apply ? 'apply' : 'dry-run',
      buckets,
      willApply: args.apply
    });

    if (!args.apply) {
      // Dry-run policy: succeed (exit 0) even when unresolved exist; the count
      // is loud in the summary block so the human reviewer can see it.
      return 0;
    }

    // Apply policy: refuse to write anything if there is ANY unresolved or
    // conflict row in the dataset. propertyKind is foundational; we do not
    // partially backfill.
    if (buckets.unresolved.length > 0 || buckets.conflict.length > 0) {
      console.error(
        JSON.stringify(
          {
            kind: 'apply_aborted',
            reason: 'unresolved_or_conflict_rows_present',
            counts: {
              unresolved: buckets.unresolved.length,
              conflict: buckets.conflict.length
            },
            guidance:
              'Resolve unresolved rows via MANUAL_ALLOWLIST or by correcting catalog data. Conflict rows must be manually reconciled (no --force is provided in Batch 2). Re-run dry-run, then --apply.'
          },
          null,
          2
        )
      );
      return 1;
    }

    if (buckets.to_write.length === 0) {
      console.log(JSON.stringify({ kind: 'apply_noop', message: 'All rows already correct; nothing to write.' }, null, 2));
      return 0;
    }

    const writes = await applyWrites(buckets.to_write);
    console.log(JSON.stringify({ kind: 'apply_results', writes }, null, 2));
    return 0;
  } finally {
    await mongoose.disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch(async (err) => {
    console.error(err?.stack || err?.message || err);
    try {
      await mongoose.disconnect();
    } catch {
      // ignore
    }
    process.exit(1);
  });
