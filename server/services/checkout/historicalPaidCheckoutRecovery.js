'use strict';

/**
 * Batch 8 — Controlled historical paid-checkout recovery.
 *
 * Binding: docs/checkout-payment-architecture/02_PAID_BOOKING_FINALIZATION_IMPLEMENTATION_SPEC.md
 *
 * Built on Batch 7 reconcilePaidCheckoutSubject — no duplicated finalize/payment logic.
 * Processes ONLY explicit allowlist entries. No unbounded historical scan.
 *
 * Mutations require ALL of:
 *   1. FINALIZE_RECONCILE_HISTORICAL=1
 *   2. execute=true (--execute)
 *   3. a validated allowlist file
 *
 * Default: dry-run. Not wired into server startup.
 */

const fs = require('fs');
const path = require('path');
const featureFlags = require('../../utils/featureFlags');
const {
  reconcilePaidCheckoutSubject,
  RECONCILE_CLASSIFICATIONS,
  DEFAULT_LIMIT,
  MAX_LIMIT
} = require('./reconcilePaidCheckoutFinalization');

const DEFAULT_HISTORICAL_LIMIT = 25;

class HistoricalRecoveryError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'HistoricalRecoveryError';
    this.code = code;
    this.details = details;
  }
}

function isHistoricalEnabled() {
  return featureFlags.isFinalizeReconcileHistoricalEnabled();
}

function clampLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_HISTORICAL_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(n));
}

function clampOffset(offset) {
  const n = Number(offset);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function redactText(value, max = 400) {
  let s = value == null ? '' : String(value);
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]');
  s = s.replace(/\bsk_(live|test)_[A-Za-z0-9]+\b/g, '[redacted-secret]');
  s = s.replace(/\bclient_secret\b\s*[:=]\s*["']?[\w-]+/gi, 'client_secret=[redacted]');
  s = s.replace(/\bpi_secret_[\w]+\b/gi, '[redacted-secret]');
  s = s.replace(/\b\+?\d[\d\s().-]{7,}\b/g, '[redacted-phone]');
  if (s.length > max) s = s.slice(0, max);
  return s;
}

function normalizeId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function entryIdentityKey(entry) {
  const c = entry.checkoutId || '';
  const p = entry.paymentIntentId || '';
  return `${c}::${p}`;
}

/**
 * Load + validate allowlist JSON array.
 * Identical duplicates collapse; conflicting duplicates reject.
 */
function loadAndValidateAllowlist(allowlistPath) {
  if (!allowlistPath || !String(allowlistPath).trim()) {
    throw new HistoricalRecoveryError(
      'ALLOWLIST_REQUIRED',
      'Historical recovery requires an explicit --allowlist=<file>'
    );
  }

  const resolved = path.resolve(String(allowlistPath).trim());
  if (!fs.existsSync(resolved)) {
    throw new HistoricalRecoveryError(
      'ALLOWLIST_NOT_FOUND',
      `Allowlist file not found: ${resolved}`
    );
  }

  let raw;
  try {
    raw = fs.readFileSync(resolved, 'utf8');
  } catch (err) {
    throw new HistoricalRecoveryError(
      'ALLOWLIST_READ_FAILED',
      `Could not read allowlist: ${err?.message || String(err)}`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new HistoricalRecoveryError(
      'ALLOWLIST_INVALID_JSON',
      `Allowlist is not valid JSON: ${err?.message || String(err)}`
    );
  }

  if (!Array.isArray(parsed)) {
    throw new HistoricalRecoveryError(
      'ALLOWLIST_NOT_ARRAY',
      'Allowlist must be a JSON array of recovery entries'
    );
  }

  const byCheckout = new Map();
  const byPaymentIntent = new Map();
  const seenExact = new Set();
  const entries = [];
  const rejected = [];

  parsed.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      rejected.push({
        index,
        code: 'MALFORMED_ENTRY',
        message: 'Entry must be a plain object'
      });
      return;
    }

    const checkoutId = normalizeId(row.checkoutId);
    const paymentIntentId = normalizeId(row.paymentIntentId);
    const reason =
      row.reason != null ? redactText(String(row.reason).trim(), 200) : null;

    if (!checkoutId && !paymentIntentId) {
      rejected.push({
        index,
        code: 'MISSING_IDENTITY',
        message: 'Each entry requires checkoutId and/or paymentIntentId'
      });
      return;
    }

    const exactKey = entryIdentityKey({ checkoutId, paymentIntentId });
    if (seenExact.has(exactKey)) {
      // Identical duplicate — idempotent collapse
      return;
    }

    if (checkoutId && byCheckout.has(checkoutId)) {
      const prior = byCheckout.get(checkoutId);
      if (
        paymentIntentId &&
        prior.paymentIntentId &&
        prior.paymentIntentId !== paymentIntentId
      ) {
        rejected.push({
          index,
          code: 'CONFLICTING_DUPLICATE',
          message: `checkoutId ${checkoutId} maps to conflicting paymentIntentIds`,
          priorPaymentIntentId: prior.paymentIntentId,
          paymentIntentId
        });
        return;
      }
    }

    if (paymentIntentId && byPaymentIntent.has(paymentIntentId)) {
      const prior = byPaymentIntent.get(paymentIntentId);
      if (checkoutId && prior.checkoutId && prior.checkoutId !== checkoutId) {
        rejected.push({
          index,
          code: 'CONFLICTING_DUPLICATE',
          message: `paymentIntentId ${paymentIntentId} maps to conflicting checkoutIds`,
          priorCheckoutId: prior.checkoutId,
          checkoutId
        });
        return;
      }
    }

    // Merge incomplete duplicates (same checkout, later adds PI)
    if (checkoutId && byCheckout.has(checkoutId)) {
      const prior = byCheckout.get(checkoutId);
      if (!prior.paymentIntentId && paymentIntentId) {
        prior.paymentIntentId = paymentIntentId;
        byPaymentIntent.set(paymentIntentId, prior);
      }
      if (!prior.reason && reason) prior.reason = reason;
      seenExact.add(exactKey);
      return;
    }
    if (paymentIntentId && byPaymentIntent.has(paymentIntentId)) {
      const prior = byPaymentIntent.get(paymentIntentId);
      if (!prior.checkoutId && checkoutId) {
        prior.checkoutId = checkoutId;
        byCheckout.set(checkoutId, prior);
      }
      if (!prior.reason && reason) prior.reason = reason;
      seenExact.add(exactKey);
      return;
    }

    const entry = {
      checkoutId,
      paymentIntentId,
      reason,
      allowlistIndex: index
    };
    seenExact.add(exactKey);
    if (checkoutId) byCheckout.set(checkoutId, entry);
    if (paymentIntentId) byPaymentIntent.set(paymentIntentId, entry);
    entries.push(entry);
  });

  if (rejected.length) {
    throw new HistoricalRecoveryError(
      'ALLOWLIST_VALIDATION_FAILED',
      `Allowlist rejected ${rejected.length} malformed/conflicting entr${
        rejected.length === 1 ? 'y' : 'ies'
      }`,
      { rejected }
    );
  }

  return {
    path: resolved,
    entries,
    entryCount: entries.length
  };
}

function buildRedactedReportEntry({
  allowlistEntry,
  outcome,
  stripeVerified = null
}) {
  const inspection = outcome?.inspection || {};
  const repair = outcome?.repair || {};
  const bookingId =
    repair?.details?.bookingId ||
    inspection?.booking?.id ||
    inspection?.session?.bookingId ||
    null;
  const jobId =
    repair?.details?.job?.jobId ||
    repair?.details?.jobId ||
    inspection?.job?.id ||
    null;

  return {
    allowlistIndex: allowlistEntry.allowlistIndex,
    allowlistReason: allowlistEntry.reason || null,
    checkoutId: outcome?.checkoutId || allowlistEntry.checkoutId || null,
    paymentIntentId:
      outcome?.paymentIntentId || allowlistEntry.paymentIntentId || null,
    classification: outcome?.classification || null,
    verification: {
      stripeRetrieved: stripeVerified === true,
      stripePaymentIntentStatus: inspection.stripePaymentIntentStatus || null,
      ok:
        outcome?.classification === RECONCILE_CLASSIFICATIONS.VERIFICATION_MISMATCH ||
        outcome?.classification ===
          RECONCILE_CLASSIFICATIONS.SUPERSEDED_OR_NONCANONICAL_PI ||
        outcome?.classification ===
          RECONCILE_CLASSIFICATIONS.PAYMENT_RECORD_MISSING_OR_NOT_PAID
          ? false
          : inspection.stripePaymentIntentStatus === 'succeeded' ||
            inspection.payment?.status === 'paid' ||
            null
    },
    proposedAction: outcome?.repairAction || repair?.wouldAction || 'none',
    executedAction: outcome?.dryRun
      ? null
      : repair?.action || outcome?.repairAction || null,
    dryRun: outcome?.dryRun === true,
    mutated: repair?.mutated === true,
    safeToMutate: outcome?.safeToMutate === true,
    failureStage: outcome?.failureStage || null,
    reason: redactText(outcome?.reason || ''),
    bookingId: bookingId ? String(bookingId) : null,
    jobId: jobId ? String(jobId) : null,
    refundAttempted: false,
    paymentIntentCreateAttempted: false,
    emailResendAttempted: repair?.emailResendAttempted === true,
    bookingCreated: repair?.bookingCreated === true,
    error: repair?.error ? redactText(repair.error) : null
  };
}

function assertExecutionGates({ execute, allowlistPath }) {
  if (!allowlistPath) {
    throw new HistoricalRecoveryError(
      'ALLOWLIST_REQUIRED',
      'Historical recovery requires --allowlist=<file>'
    );
  }
  if (execute === true && !isHistoricalEnabled()) {
    throw new HistoricalRecoveryError(
      'HISTORICAL_FLAG_REQUIRED',
      'Execute requires FINALIZE_RECONCILE_HISTORICAL=1'
    );
  }
}

/**
 * Run controlled historical recovery for an allowlist.
 */
async function recoverHistoricalPaidCheckouts({
  allowlistPath,
  execute = false,
  limit = DEFAULT_HISTORICAL_LIMIT,
  offset = 0,
  stripe = null,
  now = new Date(),
  checkpointPath = null
} = {}) {
  assertExecutionGates({ execute, allowlistPath });

  const allowlist = loadAndValidateAllowlist(allowlistPath);
  const cappedLimit = clampLimit(limit);
  const start = clampOffset(offset);
  const slice = allowlist.entries.slice(start, start + cappedLimit);

  const reports = [];
  const byClassification = {};
  let mutatedCount = 0;
  let errorCount = 0;

  for (const entry of slice) {
    let outcome;
    try {
      outcome = await reconcilePaidCheckoutSubject({
        checkoutId: entry.checkoutId,
        paymentIntentId: entry.paymentIntentId,
        execute: execute === true,
        mutationFlag: 'historical',
        stripe,
        now
      });
    } catch (err) {
      errorCount += 1;
      reports.push({
        allowlistIndex: entry.allowlistIndex,
        allowlistReason: entry.reason || null,
        checkoutId: entry.checkoutId,
        paymentIntentId: entry.paymentIntentId,
        classification: null,
        verification: { stripeRetrieved: false, ok: null },
        proposedAction: 'none',
        executedAction: null,
        dryRun: execute !== true || !isHistoricalEnabled(),
        mutated: false,
        safeToMutate: false,
        failureStage: 'unknown',
        reason: redactText(err?.message || String(err)),
        bookingId: null,
        jobId: null,
        refundAttempted: false,
        paymentIntentCreateAttempted: false,
        emailResendAttempted: false,
        bookingCreated: false,
        error: redactText(err?.message || String(err))
      });
      continue;
    }

    const report = buildRedactedReportEntry({
      allowlistEntry: entry,
      outcome,
      stripeVerified: Boolean(outcome.inspection?.stripePaymentIntentStatus)
    });
    reports.push(report);
    byClassification[report.classification] =
      (byClassification[report.classification] || 0) + 1;
    if (report.mutated) mutatedCount += 1;
  }

  const nextOffset = start + slice.length;
  const exhausted = nextOffset >= allowlist.entryCount;
  const summary = {
    mode: 'historical_recovery',
    dryRun: !(execute === true && isHistoricalEnabled()),
    executeRequested: execute === true,
    flagEnabled: isHistoricalEnabled(),
    allowlistPath: allowlist.path,
    allowlistEntryCount: allowlist.entryCount,
    offset: start,
    limit: cappedLimit,
    processed: slice.length,
    nextOffset,
    exhausted,
    resumable: !exhausted,
    mutatedCount,
    errorCount,
    byClassification,
    results: reports,
    refundAttempted: false,
    paymentIntentCreateAttempted: false,
    invariants: {
      noGuestPiiInReport: true,
      noClientSecretInReport: true,
      noFullStripeObjects: true,
      noUnboundedScan: true
    }
  };

  if (checkpointPath) {
    const checkpoint = {
      allowlistPath: allowlist.path,
      nextOffset,
      exhausted,
      updatedAt: new Date().toISOString(),
      lastProcessedCount: slice.length
    };
    fs.writeFileSync(
      path.resolve(String(checkpointPath)),
      `${JSON.stringify(checkpoint, null, 2)}\n`,
      'utf8'
    );
    summary.checkpointPath = path.resolve(String(checkpointPath));
  }

  // Hard assert report payload has no obvious secrets/PII keys
  const serialized = JSON.stringify(summary);
  if (/client_secret/i.test(serialized) || /sk_(live|test)_/.test(serialized)) {
    throw new HistoricalRecoveryError(
      'REPORT_REDACTION_FAILED',
      'Historical recovery report contained disallowed secret material'
    );
  }

  return summary;
}

module.exports = {
  HistoricalRecoveryError,
  DEFAULT_HISTORICAL_LIMIT,
  isHistoricalEnabled,
  loadAndValidateAllowlist,
  recoverHistoricalPaidCheckouts,
  buildRedactedReportEntry,
  assertExecutionGates,
  RECONCILE_CLASSIFICATIONS
};
