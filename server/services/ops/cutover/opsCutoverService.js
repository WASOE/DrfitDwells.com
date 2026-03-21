const { OpsModuleCutoverState, OVERLAP_STATUSES } = require('../../../models/OpsModuleCutoverState');

const MODULES = ['dashboard', 'calendar', 'reservations', 'payments_payouts', 'sync_center', 'cabins', 'reviews_communications'];

// Current backend capability:
// Only reservations currently have /api/ops reservation write actions implemented (Batch 3).
// Other modules are read-only on /ops in current backend reality, so legacy /admin writes must remain for those modules.
const OPS_WRITE_SUPPORTED = {
  dashboard: false,
  calendar: false,
  reservations: true,
  payments_payouts: false,
  sync_center: false,
  cabins: false,
  reviews_communications: false
};

function adminWriteEnforcementStatusForModule(moduleKey) {
  if (OPS_WRITE_SUPPORTED[moduleKey]) {
    return 'active';
  }
  // ops is still primary for reads, but admin writes remain while ops write actions don't exist.
  return 'restricted';
}

async function getOrInitModuleState(moduleKey) {
  if (!MODULES.includes(moduleKey)) throw new Error(`Unknown moduleKey: ${moduleKey}`);
  const existing = await OpsModuleCutoverState.findOne({ moduleKey });
  if (existing) return existing;

  const created = await OpsModuleCutoverState.create({
    moduleKey,
    opsPrimary: false,
    adminWriteOverlapStatus: 'target_for_cutover',
    rollbackAvailable: false
  });
  return created;
}

async function getModuleState(moduleKey) {
  return getOrInitModuleState(moduleKey);
}

async function getAllModuleStates() {
  const docs = await OpsModuleCutoverState.find({ moduleKey: { $in: MODULES } }).lean();
  const byKey = new Map(docs.map((d) => [d.moduleKey, d]));
  const out = {};
  for (const k of MODULES) out[k] = byKey.get(k) || null;
  return out;
}

async function applyCutoverTargetsFromReadiness(readinessByModule) {
  if (!readinessByModule) throw new Error('readinessByModule required');

  for (const moduleKey of MODULES) {
    const mod = readinessByModule[moduleKey];
    if (!mod) continue;

    // Only auto-enable modules that are evidence-based ready for primary use.
    // This ensures we never "fake" cutover.
    if (mod?.readiness?.verdict !== 'ready_for_primary_use') continue;

    const adminStatus = adminWriteEnforcementStatusForModule(moduleKey);
    await OpsModuleCutoverState.updateOne(
      { moduleKey },
      {
        $set: {
          opsPrimary: true,
          adminWriteOverlapStatus: adminStatus,
          rollbackAvailable: true,
          readinessComputedAt: null,
          readinessVerdict: mod?.readiness?.verdict,
          enabledAt: new Date(),
          rolledBackAt: null
        }
      },
      { upsert: true }
    );
  }
}

async function setModuleCutover({ moduleKey, opsPrimary, adminWriteOverlapStatus }) {
  const statusSet = OVERLAP_STATUSES;
  if (!statusSet.includes(adminWriteOverlapStatus)) throw new Error('Invalid adminWriteOverlapStatus');

  await OpsModuleCutoverState.updateOne(
    { moduleKey },
    {
      $set: {
        opsPrimary: Boolean(opsPrimary),
        adminWriteOverlapStatus,
        rollbackAvailable: adminWriteOverlapStatus !== 'target_for_cutover',
        enabledAt: opsPrimary ? new Date() : null,
        rolledBackAt: adminWriteOverlapStatus === 'target_for_cutover' ? new Date() : null
      }
    },
    { upsert: true }
  );

  return getModuleState(moduleKey);
}

async function rollbackModuleCutover(moduleKey) {
  return setModuleCutover({
    moduleKey,
    opsPrimary: false,
    adminWriteOverlapStatus: 'target_for_cutover'
  });
}

function shouldBlockAdminWrites(adminWriteOverlapStatus) {
  // active + read_only mean legacy writes are blocked.
  return adminWriteOverlapStatus === 'active' || adminWriteOverlapStatus === 'read_only';
}

async function assertAdminModuleWriteAllowed(moduleKey) {
  const state = await getModuleState(moduleKey);
  if (!state?.opsPrimary) return;
  if (shouldBlockAdminWrites(state.adminWriteOverlapStatus)) {
    const err = new Error(`Legacy /admin writes are blocked for module: ${moduleKey}`);
    err.code = 'CUTOVER_WRITE_BLOCKED';
    err.status = 403;
    err.moduleKey = moduleKey;
    throw err;
  }
}

module.exports = {
  MODULES,
  getModuleState,
  getAllModuleStates,
  applyCutoverTargetsFromReadiness,
  adminWriteEnforcementStatusForModule,
  setModuleCutover,
  rollbackModuleCutover,
  assertAdminModuleWriteAllowed
};

