const { runDashboardParity, runCalendarParity, runReservationsWorkspaceParity, runReservationDetailParity, runPaymentsPayoutsParity, runSyncCenterParity, runCabinsDetailParity, runReviewsCommsParity } = require('./opsParityChecks');

const { getOpsHealthReadModel } = require('../readModels/healthReadModel');
const ManualReviewItem = require('../../../models/ManualReviewItem');
const Booking = require('../../../models/Booking');

const { MODULE_VERDICTS, OVERLAP_STATUSES } = require('../../../config/opsReadinessConfig');

const { getDashboardReadModel } = require('../readModels/dashboardReadModel');
const { getCalendarReadModel } = require('../readModels/calendarReadModel');
const { getReservationsWorkspaceReadModel } = require('../readModels/reservationsReadModel');
const { getReservationDetailReadModel } = require('../readModels/reservationDetailReadModel');
const { getPaymentsSummaryReadModel, getPaymentsLedgerReadModel, getPayoutsListReadModel, getPayoutReconciliationSummaryReadModel } = require('../readModels/paymentsReadModel');
const { getSyncCenterReadModel } = require('../readModels/syncCenterReadModel');
const { getCabinsListReadModel, getCabinDetailReadModel } = require('../readModels/cabinsReadModel');
const { getReviewsReadModel, getCommunicationOversightReadModel } = require('../readModels/reviewsCommsReadModel');
const { getModuleState } = require('../cutover/opsCutoverService');
const { getBookings, getCabins } = require('../../../controllers/adminController');

function computeDegradedFromHealth(health) {
  const stripeMissing = !health?.dependencies?.stripeWebhookLastSeenAt;
  const syncFailedOrWarning = (health?.dependencies?.syncLastSeenByCabinChannel || []).some(
    (x) => x.lastSyncOutcome === 'failed' || x.lastSyncOutcome === 'warning'
  );
  return {
    stripeWebhookMissing: Boolean(stripeMissing),
    syncFailedOrWarning: Boolean(syncFailedOrWarning),
    hasAnyDegraded: Boolean(stripeMissing || syncFailedOrWarning)
  };
}

function reduceMismatches(mismatches) {
  const critical = (mismatches || []).filter((m) => m.critical).length;
  const nonCritical = (mismatches || []).filter((m) => !m.critical).length;
  return { critical, nonCritical, total: (mismatches || []).length };
}

function evidenceInsufficient(evidence) {
  if (!evidence) return true;
  return evidence.hasEvidence === false;
}

function computeVerdict({ mismatches, evidence, degradedDependencies, readModelReadyFlag }) {
  const { critical, nonCritical } = reduceMismatches(mismatches);

  if (readModelReadyFlag === false) {
    return { verdict: MODULE_VERDICTS.not_ready, overlapStatus: OVERLAP_STATUSES.target_for_cutover, reason: 'read_model_not_ready' };
  }

  if (critical > 0) {
    return { verdict: MODULE_VERDICTS.not_ready, overlapStatus: OVERLAP_STATUSES.read_only, reason: 'critical_parity_mismatch' };
  }

  if (nonCritical > 0) {
    return { verdict: MODULE_VERDICTS.conditionally_ready, overlapStatus: OVERLAP_STATUSES.read_only, reason: 'non_critical_parity_mismatch' };
  }

  if (degradedDependencies?.hasAnyDegraded) {
    return { verdict: MODULE_VERDICTS.ready_for_restricted_cutover, overlapStatus: OVERLAP_STATUSES.restricted, reason: 'degraded_dependencies' };
  }

  if (evidenceInsufficient(evidence)) {
    return { verdict: MODULE_VERDICTS.conditionally_ready, overlapStatus: OVERLAP_STATUSES.read_only, reason: 'insufficient_evidence' };
  }

  return { verdict: MODULE_VERDICTS.ready_for_primary_use, overlapStatus: OVERLAP_STATUSES.active, reason: 'parity_ok_and_healthy' };
}

async function runQaSmokeChecks({ sampleWindowDays = 14 } = {}) {
  const now = new Date();
  const to = new Date(now.getTime() + 1000 * 60 * 60 * 24 * sampleWindowDays);

  const firstBooking = await Booking.findOne({}).select('_id').lean();
  const firstCabin = await (require('../../../models/Cabin')).findOne({}).select('_id').lean();
  const firstPayout = await (require('../../../models/Payout')).findOne({}).select('_id').lean();

  const results = {};

  function makeRes() {
    return {
      statusCode: 200,
      _payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this._payload = payload;
        return this._payload;
      }
    };
  }

  async function runAdminController(controllerFn, reqLike) {
    const res = makeRes();
    // Controllers write to res via res.json(...). They do not return payload.
    await controllerFn(reqLike, res);
    return res._payload;
  }

  async function check(name, fn) {
    try {
      await fn();
      results[name] = { ok: true };
    } catch (err) {
      results[name] = { ok: false, error: err?.message || String(err) };
    }
  }

  await check('dashboard', async () => {
    const d = await getDashboardReadModel();
    if (!d?.aggregates) throw new Error('missing aggregates');
  });

  await check('calendar', async () => {
    const c = await getCalendarReadModel({ from: now, to });
    if (!c?.blocks) throw new Error('missing blocks');
  });

  await check('reservations_workspace', async () => {
    const r = await getReservationsWorkspaceReadModel({ page: 1, limit: 5 });
    if (!r?.items) throw new Error('missing items');
  });

  await check('reservation_detail', async () => {
    if (!firstBooking?._id) return;
    const rd = await getReservationDetailReadModel(String(firstBooking._id));
    if (!rd?.notes?.items) throw new Error('missing notes');
  });

  await check('payments_summary', async () => {
    const ps = await getPaymentsSummaryReadModel();
    if (!ps?.totals) throw new Error('missing totals');
  });

  await check('payments_ledger', async () => {
    const pl = await getPaymentsLedgerReadModel({ page: 1, limit: 5 });
    if (!pl?.items) throw new Error('missing items');
  });

  await check('payouts_list', async () => {
    const pl = await getPayoutsListReadModel({ page: 1, limit: 5 });
    if (!pl?.items) throw new Error('missing items');
  });

  await check('payouts_reconciliation_summary', async () => {
    const pr = await getPayoutReconciliationSummaryReadModel();
    if (!pr?.totals) throw new Error('missing totals');
  });

  await check('sync_center', async () => {
    const s = await getSyncCenterReadModel({});
    if (!s?.healthByCabinChannel) throw new Error('missing healthByCabinChannel');
  });

  await check('cabins_detail', async () => {
    if (!firstCabin?._id) return;
    const cd = await getCabinDetailReadModel(String(firstCabin._id));
    if (!cd?.operationalSettings) throw new Error('missing operationalSettings');
  });

  await check('reviews_moderation', async () => {
    const rv = await getReviewsReadModel({ page: 1, limit: 5 });
    if (!rv?.moderationSummary) throw new Error('missing moderationSummary');
  });

  await check('communications_oversight', async () => {
    const co = await getCommunicationOversightReadModel();
    if (!co?.summary) throw new Error('missing summary');
  });

  await check('manual_review_backlog', async () => {
    const n = await ManualReviewItem.countDocuments({ status: 'open' });
    if (typeof n !== 'number') throw new Error('manual review count not numeric');
  });

  await check('admin_bookings_list', async () => {
    const out = await runAdminController(getBookings, { query: { page: 1, limit: 5 } });
    if (!out?.success || !out?.data?.items) throw new Error('admin bookings list shape mismatch');
  });

  await check('admin_cabins_list', async () => {
    const out = await runAdminController(getCabins, { query: { page: 1, limit: 5 } });
    if (!out?.success || !out?.data?.items) throw new Error('admin cabins list shape mismatch');
  });

  return results;
}

async function computeOpsReadiness() {
  const health = await getOpsHealthReadModel();
  const degradedDependencies = computeDegradedFromHealth(health);

  const now = new Date();
  const to = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 14);

  const sample = {
    from: now,
    to,
    reservationsQuery: { page: 1, limit: 20 }
  };

  const firstCabin = await (require('../../../models/Cabin')).findOne({}).select('_id').lean();
  const firstBooking = await Booking.findOne({}).select('_id').lean();

  const cabinSampleId = firstCabin?._id ? String(firstCabin._id) : null;
  const reservationSampleId = firstBooking?._id ? String(firstBooking._id) : null;

  const [
    dashboardParity,
    calendarParity,
    reservationsWorkspaceParity,
    reservationDetailParity,
    paymentsPayoutsParity,
    syncCenterParity,
    cabinsParity,
    reviewsCommsParity
  ] = await Promise.all([
    runDashboardParity({ comparisonDate: now }),
    runCalendarParity({ from: now, to, cabinId: cabinSampleId || null }),
    runReservationsWorkspaceParity({ query: sample.reservationsQuery }),
    runReservationDetailParity({ reservationId: reservationSampleId }),
    runPaymentsPayoutsParity({ ledgerPage: 1, ledgerLimit: 5, payoutsPage: 1, payoutsLimit: 5 }),
    runSyncCenterParity({ cabinId: null }),
    runCabinsDetailParity({ cabinId: cabinSampleId }),
    runReviewsCommsParity({ page: 1, limit: 20 })
  ]);

  const parityByModule = {
    dashboard: dashboardParity,
    calendar: calendarParity,
    reservations: {
      workspace: reservationsWorkspaceParity,
      detail: reservationDetailParity
    },
    payments_payouts: paymentsPayoutsParity,
    sync_center: syncCenterParity,
    cabins: cabinsParity,
    reviews_communications: reviewsCommsParity
  };

  const readinessByModule = {
    dashboard: null,
    calendar: null,
    reservations: null,
    payments_payouts: null,
    sync_center: null,
    cabins: null,
    reviews_communications: null
  };

  function collectModuleMismatches(moduleKey) {
    if (moduleKey === 'reservations') {
      return [
        ...(parityByModule.reservations.workspace?.mismatches || []),
        ...(parityByModule.reservations.detail?.mismatches || [])
      ];
    }
    return parityByModule[moduleKey]?.mismatches || [];
  }

  function collectModuleEvidence(moduleKey) {
    if (moduleKey === 'reservations') {
      return {
        hasEvidence:
          parityByModule.reservations.workspace?.evidence?.hasEvidence ||
          parityByModule.reservations.detail?.evidence?.hasEvidence
      };
    }
    return parityByModule[moduleKey]?.evidence || { hasEvidence: false };
  }

  function moduleReadModelReadyFlag(moduleKey) {
    const map = {
      dashboard: 'dashboard',
      calendar: 'calendar',
      reservations: 'reservations',
      payments_payouts: 'payments',
      sync_center: 'syncCenter',
      cabins: 'cabins',
      reviews_communications: 'reviews'
    };
    const flag = map[moduleKey];
    if (!flag) return true;
    return health?.readModelReadiness?.[flag] !== false;
  }

  for (const moduleKey of Object.keys(readinessByModule)) {
    const mismatches = collectModuleMismatches(moduleKey);
    const evidence = collectModuleEvidence(moduleKey);
    const readModelReadyFlag = moduleReadModelReadyFlag(moduleKey);

    const verdictObj = computeVerdict({
      mismatches,
      evidence,
      degradedDependencies,
      readModelReadyFlag
    });

    const { critical, nonCritical, total } = reduceMismatches(mismatches);

    const blockingIssues = mismatches
      .filter((m) => m.critical)
      .slice(0, 20)
      .map((m) => `${m.key}: expected=${String(m.expected).slice(0, 120)} got=${String(m.got).slice(0, 120)}`);

    readinessByModule[moduleKey] = {
      module: moduleKey,
      parity: {
        mismatchCount: total,
        criticalMismatchCount: critical,
        nonCriticalMismatchCount: nonCritical,
        sampleScope: {
          calendar: { cabinId: cabinSampleId || null, from: now.toISOString(), to: to.toISOString() },
          reservationsWorkspace: sample.reservationsQuery
        }
      },
      evidence: {
        hasEvidence: evidence?.hasEvidence === true,
        insufficientEvidence: evidence?.hasEvidence === false
      },
      degraded: {
        dependencies: degradedDependencies
      },
      readiness: {
        verdict: verdictObj.verdict,
        overlapStatus: verdictObj.overlapStatus,
        reason: verdictObj.reason,
        blockingErrorCount: critical
      },
      blockingIssues,
      manualReviewLinkage: {
        openManualReviewCount: await ManualReviewItem.countDocuments({ status: 'open' }),
        relevantCategories: (() => {
          if (moduleKey === 'payments_payouts') return ['payment_unlinked', 'payout_unlinked'];
          if (moduleKey === 'sync_center') return ['sync_anomaly', 'sync_feed_unreachable', 'sync_parse_failure', 'sync_duplicate_import', 'sync_deterministic_key_risk'];
          return null;
        })()
      },
      cutover: null
    };
  }

  // Merge live cutover enforcement state (evidence-based cutover already applied by operator scripts).
  for (const moduleKey of Object.keys(readinessByModule)) {
    try {
      const state = await getModuleState(moduleKey);
      readinessByModule[moduleKey].cutover = {
        module: moduleKey,
        opsPrimary: Boolean(state.opsPrimary),
        adminWriteOverlapStatus: state.adminWriteOverlapStatus,
        rollbackAvailable: Boolean(state.rollbackAvailable),
        enabledAt: state.enabledAt ? state.enabledAt.toISOString() : null,
        rolledBackAt: state.rolledBackAt ? state.rolledBackAt.toISOString() : null
      };
    } catch {
      readinessByModule[moduleKey].cutover = { module: moduleKey, opsPrimary: false, adminWriteOverlapStatus: 'target_for_cutover', rollbackAvailable: false };
    }
  }

  const overlapStatusByModule = Object.fromEntries(
    Object.entries(readinessByModule).map(([k, v]) => [k, v.readiness.overlapStatus])
  );

  const qaSmoke = await runQaSmokeChecks();

  return {
    computedAt: new Date().toISOString(),
    dependencies: health.dependencies,
    degradedDependencies,
    parityByModule,
    readinessByModule,
    overlapStatusByModule,
    qaSmoke,
    manualReview: {
      openCount: await ManualReviewItem.countDocuments({ status: 'open' })
    }
  };
}

module.exports = {
  computeOpsReadiness
};

