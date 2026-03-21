const express = require('express');
const { createBlock, editBlock, tombstoneBlock } = require('../../../services/ops/domain/availabilityWriteService');

const router = express.Router();

function handleDomainError(res, error) {
  if (error.code === 'PERMISSION_DENIED') {
    return res.status(error.status || 403).json({ success: false, errorType: 'permission', message: error.message });
  }
  if (error.code === 'AUDIT_WRITE_FAILED') {
    return res.status(500).json({ success: false, errorType: 'audit_failure', message: 'Action blocked because audit write failed' });
  }
  if (error.type) {
    const status = error.status || (error.type === 'conflict' ? 409 : error.type === 'dependency_failure' ? 502 : 400);
    return res.status(status).json({ success: false, errorType: error.type, message: error.message, details: error.details || null });
  }
  return res.status(500).json({ success: false, errorType: 'dependency_failure', message: error.message });
}

router.post('/manual-blocks', async (req, res) => {
  try {
    const data = await createBlock({
      blockType: 'manual_block',
      cabinId: req.body?.cabinId,
      unitId: req.body?.unitId || null,
      startDate: req.body?.startDate,
      endDate: req.body?.endDate,
      reason: req.body?.reason || null,
      metadata: req.body?.metadata || {},
      ctx: { req, user: req.user, route: 'POST /api/ops/availability/manual-blocks' }
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

router.post('/manual-blocks/:id/edit', async (req, res) => {
  try {
    const data = await editBlock({
      blockId: req.params.id,
      startDate: req.body?.startDate,
      endDate: req.body?.endDate,
      reason: req.body?.reason || null,
      metadata: req.body?.metadata || {},
      ctx: { req, user: req.user, route: 'POST /api/ops/availability/manual-blocks/:id/edit' }
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

router.post('/manual-blocks/:id/remove', async (req, res) => {
  try {
    const data = await tombstoneBlock({
      blockId: req.params.id,
      reason: req.body?.reason || 'manual_block_remove',
      ctx: { req, user: req.user, route: 'POST /api/ops/availability/manual-blocks/:id/remove' }
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

router.post('/maintenance-blocks', async (req, res) => {
  try {
    const data = await createBlock({
      blockType: 'maintenance',
      cabinId: req.body?.cabinId,
      unitId: req.body?.unitId || null,
      startDate: req.body?.startDate,
      endDate: req.body?.endDate,
      reason: req.body?.reason || null,
      metadata: req.body?.metadata || {},
      ctx: { req, user: req.user, route: 'POST /api/ops/availability/maintenance-blocks' }
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

router.post('/maintenance-blocks/:id/edit', async (req, res) => {
  try {
    const data = await editBlock({
      blockId: req.params.id,
      startDate: req.body?.startDate,
      endDate: req.body?.endDate,
      reason: req.body?.reason || null,
      metadata: req.body?.metadata || {},
      ctx: { req, user: req.user, route: 'POST /api/ops/availability/maintenance-blocks/:id/edit' }
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

router.post('/maintenance-blocks/:id/remove', async (req, res) => {
  try {
    const data = await tombstoneBlock({
      blockId: req.params.id,
      reason: req.body?.reason || 'maintenance_block_remove',
      ctx: { req, user: req.user, route: 'POST /api/ops/availability/maintenance-blocks/:id/remove' }
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

module.exports = router;
