const express = require('express');
const { createBlock, editBlock, tombstoneBlock } = require('../../../services/ops/domain/availabilityWriteService');
const {
  previewLocationBlock,
  createLocationBlock,
  removeLocationBlockGroup
} = require('../../../services/ops/domain/locationBlockService');
const {
  convertManualBlockToReservation
} = require('../../../services/ops/domain/manualBlockConversionService');
const { reconcileManualBlockConversions } = require('../../../services/ops/domain/manualBlockConversionReconciliationService');
const { requirePermission, ACTIONS } = require('../../../services/permissionService');

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
      targetScope: req.body?.targetScope || null,
      startDate: req.body?.startDate,
      endDate: req.body?.endDate,
      reason: req.body?.reason || null,
      manualBlockPurpose: req.body?.manualBlockPurpose || null,
      operatorNote: req.body?.operatorNote,
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
      manualBlockPurpose: req.body?.manualBlockPurpose,
      operatorNote: req.body?.operatorNote,
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

router.post('/manual-blocks/:id/convert', async (req, res) => {
  try {
    const data = await convertManualBlockToReservation({
      blockId: req.params.id,
      guestInfo: req.body?.guestInfo,
      adults: req.body?.adults,
      children: req.body?.children,
      unitId: req.body?.unitId || null,
      initialStatus: req.body?.initialStatus ?? 'pending',
      manualReservationPurpose: req.body?.manualReservationPurpose,
      sendGuestConfirmationEmail: req.body?.sendGuestConfirmationEmail === true,
      acceptExternalHoldWarnings: Boolean(req.body?.acceptExternalHoldWarnings),
      reason: req.body?.reason || null,
      ctx: { req, user: req.user, route: 'POST /api/ops/availability/manual-blocks/:id/convert' }
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

router.get('/manual-blocks/reconciliation', async (req, res) => {
  try {
    requirePermission({
      role: req.user?.role,
      action: ACTIONS.OPS_AVAILABILITY_MANUAL_BLOCK_REMOVE
    });
    const data = await reconcileManualBlockConversions({
      limit: req.query?.limit
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
      targetScope: req.body?.targetScope || null,
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

router.post('/location-blocks/preview', async (req, res) => {
  try {
    const data = await previewLocationBlock({
      locationKey: req.body?.locationKey,
      startDate: req.body?.startDate,
      endDate: req.body?.endDate
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

router.post('/location-blocks', async (req, res) => {
  try {
    const data = await createLocationBlock({
      locationKey: req.body?.locationKey,
      startDate: req.body?.startDate,
      endDate: req.body?.endDate,
      blockType: req.body?.blockType || 'manual_block',
      manualBlockPurpose: req.body?.manualBlockPurpose || null,
      operatorNote: req.body?.operatorNote,
      reason: req.body?.reason || null,
      ctx: { req, user: req.user, route: 'POST /api/ops/availability/location-blocks' }
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

router.post('/location-blocks/:groupId/remove', async (req, res) => {
  try {
    const data = await removeLocationBlockGroup({
      locationBlockGroupId: req.params.groupId,
      reason: req.body?.reason || 'location_block_group_remove',
      ctx: { req, user: req.user, route: 'POST /api/ops/availability/location-blocks/:groupId/remove' }
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

module.exports = router;
