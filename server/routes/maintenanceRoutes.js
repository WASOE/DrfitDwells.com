const express = require('express');
const { body, validationResult } = require('express-validator');
const { adminAuth } = require('../middleware/adminAuth');
const { requireOpsAdminRole } = require('../middleware/requireOpsAdminRole');
const { validateId } = require('../middleware/validateId');
const {
  previewFixtureContamination,
  applyFixtureContaminationArchive,
  applyTombstoneStaleReservationBlocks,
  runIntegrityPreviews,
  findStaleReservationBlockRows,
  archiveCabin,
  deleteFixtureCabin,
  archiveReservation,
  deleteFixtureReservation,
  listMaintenanceCabins,
  listMaintenanceReservations
} = require('../services/maintenance/maintenanceOpsService');

const router = express.Router();

router.use(adminAuth);
router.use(requireOpsAdminRole);

router.get('/session', (req, res) => {
  res.json({
    success: true,
    data: {
      role: req.user?.role || 'admin',
      actorId: req.user?.id || null
    }
  });
});

router.get('/cabins', async (req, res) => {
  try {
    const data = await listMaintenanceCabins({
      page: req.query.page,
      limit: req.query.limit,
      includeFixtures: req.query.includeFixtures === '1' || req.query.includeFixtures === 'true',
      includeArchived: req.query.includeArchived === '1' || req.query.includeArchived === 'true',
      q: req.query.q || ''
    });
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.post(
  '/cabins/:id/archive',
  validateId('id'),
  [body('reason').isString().trim().isLength({ min: 8 }).withMessage('reason (min 8 chars) is required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }
    try {
      const data = await archiveCabin(req.params.id, req.body.reason, {
        req,
        user: req.user,
        route: 'POST /api/maintenance/cabins/:id/archive'
      });
      return res.json({ success: true, data });
    } catch (e) {
      if (e.code === 'NOT_FOUND') return res.status(404).json({ success: false, message: e.message });
      if (e.code === 'AUDIT_WRITE_FAILED') {
        return res.status(500).json({ success: false, message: 'Action blocked because audit write failed' });
      }
      return res.status(e.status || 500).json({ success: false, message: e.message });
    }
  }
);

router.post(
  '/cabins/:id/delete-fixture',
  validateId('id'),
  [body('reason').isString().trim().isLength({ min: 8 }).withMessage('reason (min 8 chars) is required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }
    try {
      const data = await deleteFixtureCabin(req.params.id, req.body.reason, {
        req,
        user: req.user,
        route: 'POST /api/maintenance/cabins/:id/delete-fixture'
      });
      return res.json({ success: true, data });
    } catch (e) {
      if (e.code === 'NOT_FOUND') return res.status(404).json({ success: false, message: e.message });
      if (e.code === 'FORBIDDEN_DELETE') return res.status(403).json({ success: false, message: e.message });
      if (e.code === 'AUDIT_WRITE_FAILED') {
        return res.status(500).json({ success: false, message: 'Action blocked because audit write failed' });
      }
      return res.status(e.status || 500).json({ success: false, message: e.message });
    }
  }
);

router.get('/reservations', async (req, res) => {
  try {
    const data = await listMaintenanceReservations({
      page: req.query.page,
      limit: req.query.limit,
      includeFixtures: req.query.includeFixtures === '1' || req.query.includeFixtures === 'true',
      includeArchived: req.query.includeArchived === '1' || req.query.includeArchived === 'true',
      q: req.query.q || ''
    });
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.post(
  '/reservations/:id/archive',
  validateId('id'),
  [body('reason').isString().trim().isLength({ min: 8 }).withMessage('reason (min 8 chars) is required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }
    try {
      const data = await archiveReservation(req.params.id, req.body.reason, {
        req,
        user: req.user,
        route: 'POST /api/maintenance/reservations/:id/archive'
      });
      return res.json({ success: true, data });
    } catch (e) {
      if (e.code === 'NOT_FOUND') return res.status(404).json({ success: false, message: e.message });
      if (e.code === 'AUDIT_WRITE_FAILED') {
        return res.status(500).json({ success: false, message: 'Action blocked because audit write failed' });
      }
      return res.status(e.status || 500).json({ success: false, message: e.message });
    }
  }
);

router.post(
  '/reservations/:id/delete-fixture',
  validateId('id'),
  [body('reason').isString().trim().isLength({ min: 8 }).withMessage('reason (min 8 chars) is required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }
    try {
      const data = await deleteFixtureReservation(req.params.id, req.body.reason, {
        req,
        user: req.user,
        route: 'POST /api/maintenance/reservations/:id/delete-fixture'
      });
      return res.json({ success: true, data });
    } catch (e) {
      if (e.code === 'NOT_FOUND') return res.status(404).json({ success: false, message: e.message });
      if (e.code === 'FORBIDDEN_DELETE') return res.status(403).json({ success: false, message: e.message });
      if (e.code === 'AUDIT_WRITE_FAILED') {
        return res.status(500).json({ success: false, message: 'Action blocked because audit write failed' });
      }
      return res.status(e.status || 500).json({ success: false, message: e.message });
    }
  }
);

router.get('/cleanup/preview/fixture-contamination', async (req, res) => {
  try {
    const data = await previewFixtureContamination();
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/cleanup/preview/unsafe-blocking', async (req, res) => {
  try {
    const previews = await runIntegrityPreviews();
    return res.json({ success: true, data: { kind: 'unsafe_blocking', rows: previews.unsafeBlocking, meta: previews } });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/cleanup/preview/ics-exclusion', async (req, res) => {
  try {
    const previews = await runIntegrityPreviews();
    return res.json({ success: true, data: { kind: 'ics_exclusion', rows: previews.icsExcluded, meta: previews } });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/cleanup/preview/stale-reservation-blocks', async (req, res) => {
  try {
    const rows = await findStaleReservationBlockRows();
    return res.json({
      success: true,
      data: {
        count: rows.length,
        sample: rows.slice(0, 50).map((r) => ({
          blockId: String(r._id),
          reservationId: String(r.reservationId),
          bookingStatus: r.bookingStatus
        }))
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.post(
  '/cleanup/fixture-contamination',
  [body('reason').isString().trim().isLength({ min: 8 }).withMessage('reason (min 8 chars) is required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }
    try {
      const data = await applyFixtureContaminationArchive(req.body.reason, {
        req,
        user: req.user,
        route: 'POST /api/maintenance/cleanup/fixture-contamination'
      });
      return res.json({ success: true, data });
    } catch (e) {
      if (e.code === 'VALIDATION') return res.status(400).json({ success: false, message: e.message });
      if (e.code === 'AUDIT_WRITE_FAILED') {
        return res.status(500).json({ success: false, message: 'Action blocked because audit write failed' });
      }
      return res.status(500).json({ success: false, message: e.message });
    }
  }
);

router.post(
  '/cleanup/stale-reservation-blocks',
  [body('reason').isString().trim().isLength({ min: 8 }).withMessage('reason (min 8 chars) is required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }
    try {
      const data = await applyTombstoneStaleReservationBlocks(req.body.reason, {
        req,
        user: req.user,
        route: 'POST /api/maintenance/cleanup/stale-reservation-blocks'
      });
      return res.json({ success: true, data });
    } catch (e) {
      if (e.code === 'VALIDATION') return res.status(400).json({ success: false, message: e.message });
      if (e.code === 'AUDIT_WRITE_FAILED') {
        return res.status(500).json({ success: false, message: 'Action blocked because audit write failed' });
      }
      return res.status(500).json({ success: false, message: e.message });
    }
  }
);

module.exports = router;
