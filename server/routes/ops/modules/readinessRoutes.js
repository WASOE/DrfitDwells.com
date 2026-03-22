const express = require('express');
const { computeOpsReadiness } = require('../../../services/ops/readiness/opsReadinessService');
const {
  setModuleCutover,
  rollbackModuleCutover,
  adminWriteEnforcementStatusForModule
} = require('../../../services/ops/cutover/opsCutoverService');
const { requireOpsAdminRole } = require('../../../middleware/requireOpsAdminRole');

const router = express.Router();

router.get('/summary', async (req, res) => {
  try {
    const readiness = await computeOpsReadiness();
    return res.json({ success: true, data: { computedAt: readiness.computedAt, degradedDependencies: readiness.degradedDependencies, readinessByModule: readiness.readinessByModule } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/modules', async (req, res) => {
  try {
    const readiness = await computeOpsReadiness();
    return res.json({ success: true, data: readiness.readinessByModule });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/overlap', async (req, res) => {
  try {
    const readiness = await computeOpsReadiness();
    const cutoverByModule = {};
    for (const [k, v] of Object.entries(readiness.readinessByModule || {})) {
      cutoverByModule[k] = v?.cutover || null;
    }
    return res.json({
      success: true,
      data: {
        // Parity-based overlap (legacy /admin vs /ops read intent)
        overlapStatusByModule: readiness.overlapStatusByModule,
        // Live enforced cutover state for legacy /admin write enforcement
        cutoverByModule
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/parity-mismatches', async (req, res) => {
  try {
    const readiness = await computeOpsReadiness();
    const parity = readiness.parityByModule;
    return res.json({ success: true, data: parity });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/qa', async (req, res) => {
  try {
    const readiness = await computeOpsReadiness();
    // Minimal QA checklist artifacts are included alongside computed smoke checks.
    const checklist = {
      mobileViewport: 'iPhone 12 width (390px)',
      modules: {
        dashboard: ['Verify cards stack without clipping; verify degraded banner if present; verify quick links are tappable.'],
        calendar: ['Verify block list is readable; verify date window inputs are visible; verify conflict markers render.'],
        reservations: ['Verify filter controls do not overlap; verify reservation cards show guest/cabin/status; verify card tap navigation does not trigger action badges accidentally.'],
        reservation_detail: ['Verify guest fields and notes list are readable; verify notes section shows empty state; verify availability actions buttons fit on mobile.'],
        payments: ['Verify payments summary renders; verify ledger list doesn’t overflow; verify unlinked states show explicit text rather than blank.'],
        sync_center: ['Verify health rows fit; verify anomaly tags appear when present; verify degraded/empty states are not “green”.']
      }
    };

    return res.json({ success: true, data: { qaSmoke: readiness.qaSmoke, checklist } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/cutover/:module/enable', requireOpsAdminRole, async (req, res) => {
  try {
    const { module: moduleKey } = req.params;
    // For enable, enforce read + write primary depending on backend capability.
    // We use computeOpsReadiness-based verdict to decide whether enable is allowed.
    const readiness = await computeOpsReadiness();
    const mod = readiness?.readinessByModule?.[moduleKey];
    if (!mod) return res.status(404).json({ success: false, message: 'Unknown module' });
    if (mod?.readiness?.verdict !== 'ready_for_primary_use') {
      return res.status(409).json({ success: false, errorType: 'cutover_blocked', message: 'Module is not ready for primary cutover' });
    }

    const state = await setModuleCutover({
      moduleKey,
      opsPrimary: true,
      adminWriteOverlapStatus: adminWriteEnforcementStatusForModule(moduleKey)
    });

    return res.json({ success: true, data: state });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/cutover/:module/rollback', requireOpsAdminRole, async (req, res) => {
  try {
    const { module: moduleKey } = req.params;
    const state = await rollbackModuleCutover(moduleKey);
    return res.json({ success: true, data: state });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

