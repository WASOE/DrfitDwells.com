const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const Unit = require('../../../models/Unit');
const { upload, validateMagicBytes } = require('../../../middleware/upload');
const { validateId } = require('../../../middleware/validateId');
const { adminModuleWriteGate } = require('../../../middleware/adminModuleCutoverEnforcement');
const { getCabinsListReadModel, getCabinDetailReadModel } = require('../../../services/ops/readModels/cabinsReadModel');
const { updateCabinFromAdminPayload } = require('../../../services/cabins/cabinManagementService');
const {
  uploadCabinImage,
  reorderCabinImages,
  updateCabinImageMetadata,
  batchUpdateCabinImages,
  deleteCabinImage
} = require('../../../services/cabins/cabinMediaService');

const router = express.Router();
const OPS_CABIN_CONTENT_ALLOWED_FIELDS = new Set([
  'name',
  'description',
  'hostName',
  'avgResponseTimeHours',
  'highlights',
  'badges'
]);
const OPS_CABIN_ARRIVAL_ALLOWED_FIELDS = new Set([
  'location',
  'geoLocation',
  'meetingPoint',
  'arrivalWindowDefault',
  'arrivalGuideUrl',
  'safetyNotes',
  'emergencyContact',
  'packingList'
]);
const OPS_CABIN_ARRIVAL_EXCLUDED_FIELDS = new Set([
  'transportOptions',
  'transportCutoffs',
  'pricePerNight',
  'minNights',
  'capacity',
  'minGuests',
  'pricingModel',
  'blockedDates',
  'experiences',
  'inventoryType',
  'units'
]);
const OPS_CABIN_TRANSPORT_CUTOFFS_ALLOWED_FIELDS = new Set(['transportCutoffs']);
const OPS_CABIN_TRANSPORT_CUTOFFS_EXCLUDED_FIELDS = new Set([
  'transportOptions',
  'pricePerNight',
  'minNights',
  'capacity',
  'minGuests',
  'pricingModel',
  'blockedDates',
  'experiences',
  'inventoryType',
  'units'
]);
const OPS_CABIN_TRANSPORT_OPTIONS_ALLOWED_FIELDS = new Set(['transportOptions']);
const OPS_CABIN_TRANSPORT_OPTIONS_EXCLUDED_FIELDS = new Set([
  'transportCutoffs',
  'pricePerNight',
  'minNights',
  'capacity',
  'minGuests',
  'pricingModel',
  'blockedDates',
  'experiences',
  'inventoryType',
  'units'
]);
const OPS_CABIN_OCCUPANCY_ALLOWED_FIELDS = new Set([
  'capacity',
  'minNights'
]);
const OPS_CABIN_OCCUPANCY_EXCLUDED_FIELDS = new Set([
  'minGuests',
  'pricePerNight',
  'pricingModel',
  'blockedDates',
  'experiences',
  'transportOptions',
  'transportCutoffs',
  'inventoryType',
  'units'
]);
const OPS_CABIN_PRICING_ALLOWED_FIELDS = new Set([
  'pricePerNight'
]);
const OPS_CABIN_PRICING_EXCLUDED_FIELDS = new Set([
  'pricingModel',
  'minGuests',
  'blockedDates',
  'experiences',
  'transportOptions',
  'transportCutoffs',
  'inventoryType',
  'units'
]);
const OPS_CABIN_EXPERIENCES_ALLOWED_FIELDS = new Set([
  'experiences'
]);
const OPS_CABIN_EXPERIENCES_EXCLUDED_FIELDS = new Set([
  'pricePerNight',
  'pricingModel',
  'minGuests',
  'blockedDates',
  'transportOptions',
  'transportCutoffs',
  'inventoryType',
  'units'
]);
const OPS_UNIT_ALLOWED_FIELDS = new Set([
  'displayName',
  'adminNotes',
  'isActive',
  'airbnbListingLabel'
]);
const OPS_UNIT_EXCLUDED_FIELDS = new Set([
  'unitNumber',
  'blockedDates',
  'cabinTypeId'
]);

router.get('/', async (req, res) => {
  try {
    const data = await getCabinsListReadModel(req.query);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/units/:unitId', async (req, res) => {
  try {
    const { unitId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(unitId))) {
      return res.status(400).json({ success: false, message: 'Invalid unit id' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const incomingKeys = Object.keys(body);
    const excludedKeys = incomingKeys.filter((key) => OPS_UNIT_EXCLUDED_FIELDS.has(key));
    if (excludedKeys.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Fields not allowed in unit edit: ${excludedKeys.join(', ')}`
      });
    }

    const unknownKeys = incomingKeys.filter((key) => !OPS_UNIT_ALLOWED_FIELDS.has(key));
    if (unknownKeys.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Unsupported unit fields: ${unknownKeys.join(', ')}`
      });
    }

    const updates = {};
    if (Object.prototype.hasOwnProperty.call(body, 'displayName')) {
      const rawDisplayName = body.displayName;
      if (typeof rawDisplayName !== 'string') {
        return res.status(400).json({ success: false, message: 'displayName must be a string' });
      }
      updates.displayName = rawDisplayName.trim().slice(0, 100);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'adminNotes')) {
      const rawAdminNotes = body.adminNotes;
      if (typeof rawAdminNotes !== 'string') {
        return res.status(400).json({ success: false, message: 'adminNotes must be a string' });
      }
      updates.adminNotes = rawAdminNotes.trim().slice(0, 500);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'isActive')) {
      if (typeof body.isActive !== 'boolean') {
        return res.status(400).json({ success: false, message: 'isActive must be a boolean' });
      }
      updates.isActive = body.isActive;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'airbnbListingLabel')) {
      const raw = body.airbnbListingLabel;
      if (raw !== undefined && raw !== null && typeof raw !== 'string') {
        return res.status(400).json({ success: false, message: 'airbnbListingLabel must be a string' });
      }
      const label =
        raw === undefined || raw === null ? undefined : String(raw).trim().slice(0, 200);
      if (label !== undefined) {
        updates.airbnbListingLabel = label === '' ? null : label;
      }
    }

    const unit = await Unit.findByIdAndUpdate(
      unitId,
      updates,
      { new: true, runValidators: true }
    )
      .select('displayName adminNotes isActive airbnbListingLabel')
      .lean();

    if (!unit) {
      return res.status(404).json({ success: false, message: 'Unit not found' });
    }
    return res.json({
      success: true,
      data: {
        unitId: String(unitId),
        displayName: unit.displayName || '',
        adminNotes: unit.adminNotes || '',
        isActive: unit.isActive !== false,
        airbnbListingLabel: unit.airbnbListingLabel || null
      }
    });
  } catch (error) {
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/:id/content', validateId('id'), adminModuleWriteGate('cabins'), async (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const incomingKeys = Object.keys(payload);
    if (Object.prototype.hasOwnProperty.call(payload, 'experiences')) {
      return res.status(400).json({
        success: false,
        message: 'experiences are not editable in this content slice'
      });
    }
    const unknownKeys = incomingKeys.filter((key) => !OPS_CABIN_CONTENT_ALLOWED_FIELDS.has(key));
    if (unknownKeys.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Unsupported content fields: ${unknownKeys.join(', ')}`
      });
    }

    const result = await updateCabinFromAdminPayload(req.params.id, payload, {});
    if (!result.ok) {
      return res.status(result.status).json(result.payload);
    }
    return res.status(result.status).json(result.payload);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/:id/arrival', validateId('id'), adminModuleWriteGate('cabins'), async (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? { ...req.body } : {};
    const incomingKeys = Object.keys(payload);

    const excludedKeys = incomingKeys.filter((key) => OPS_CABIN_ARRIVAL_EXCLUDED_FIELDS.has(key));
    if (excludedKeys.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Fields not allowed in arrival edit: ${excludedKeys.join(', ')}`
      });
    }

    const unknownKeys = incomingKeys.filter((key) => !OPS_CABIN_ARRIVAL_ALLOWED_FIELDS.has(key));
    if (unknownKeys.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Unsupported arrival fields: ${unknownKeys.join(', ')}`
      });
    }

    if (payload.geoLocation && typeof payload.geoLocation === 'object') {
      const nextGeo = { ...payload.geoLocation };
      if (Object.prototype.hasOwnProperty.call(nextGeo, 'lat') && !Object.prototype.hasOwnProperty.call(nextGeo, 'latitude')) {
        nextGeo.latitude = nextGeo.lat;
      }
      if (Object.prototype.hasOwnProperty.call(nextGeo, 'lng') && !Object.prototype.hasOwnProperty.call(nextGeo, 'longitude')) {
        nextGeo.longitude = nextGeo.lng;
      }
      delete nextGeo.lat;
      delete nextGeo.lng;
      payload.geoLocation = nextGeo;
    }

    const result = await updateCabinFromAdminPayload(req.params.id, payload, {});
    if (!result.ok) {
      return res.status(result.status).json(result.payload);
    }
    return res.status(result.status).json(result.payload);
  } catch (error) {
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/:id/transport-cutoffs', validateId('id'), adminModuleWriteGate('cabins'), async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const incomingKeys = Object.keys(body);

    const excludedKeys = incomingKeys.filter((key) => OPS_CABIN_TRANSPORT_CUTOFFS_EXCLUDED_FIELDS.has(key));
    if (excludedKeys.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Fields not allowed in transport cutoffs edit: ${excludedKeys.join(', ')}`
      });
    }

    const unknownKeys = incomingKeys.filter((key) => !OPS_CABIN_TRANSPORT_CUTOFFS_ALLOWED_FIELDS.has(key));
    if (unknownKeys.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Unsupported transport cutoff fields: ${unknownKeys.join(', ')}`
      });
    }

    const result = await updateCabinFromAdminPayload(
      req.params.id,
      { transportCutoffs: body.transportCutoffs },
      {}
    );
    if (!result.ok) {
      return res.status(result.status).json(result.payload);
    }
    return res.status(result.status).json(result.payload);
  } catch (error) {
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/:id/transport-options', validateId('id'), adminModuleWriteGate('cabins'), async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const incomingKeys = Object.keys(body);

    const excludedKeys = incomingKeys.filter((key) => OPS_CABIN_TRANSPORT_OPTIONS_EXCLUDED_FIELDS.has(key));
    if (excludedKeys.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Fields not allowed in transport options edit: ${excludedKeys.join(', ')}`
      });
    }

    const unknownKeys = incomingKeys.filter((key) => !OPS_CABIN_TRANSPORT_OPTIONS_ALLOWED_FIELDS.has(key));
    if (unknownKeys.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Unsupported transport option fields: ${unknownKeys.join(', ')}`
      });
    }

    const result = await updateCabinFromAdminPayload(
      req.params.id,
      { transportOptions: body.transportOptions },
      {}
    );
    if (!result.ok) {
      return res.status(result.status).json(result.payload);
    }
    return res.status(result.status).json(result.payload);
  } catch (error) {
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/:id/occupancy', validateId('id'), adminModuleWriteGate('cabins'), async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const incomingKeys = Object.keys(body);

    const excludedKeys = incomingKeys.filter((key) => OPS_CABIN_OCCUPANCY_EXCLUDED_FIELDS.has(key));
    if (excludedKeys.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Fields not allowed in occupancy edit: ${excludedKeys.join(', ')}`
      });
    }

    const unknownKeys = incomingKeys.filter((key) => !OPS_CABIN_OCCUPANCY_ALLOWED_FIELDS.has(key));
    if (unknownKeys.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Unsupported occupancy fields: ${unknownKeys.join(', ')}`
      });
    }

    const payload = {
      capacity: body.capacity,
      minNights: body.minNights
    };
    const result = await updateCabinFromAdminPayload(req.params.id, payload, {});
    if (!result.ok) {
      return res.status(result.status).json(result.payload);
    }
    return res.status(result.status).json(result.payload);
  } catch (error) {
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/:id/pricing', validateId('id'), adminModuleWriteGate('cabins'), async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const incomingKeys = Object.keys(body);

    const excludedKeys = incomingKeys.filter((key) => OPS_CABIN_PRICING_EXCLUDED_FIELDS.has(key));
    if (excludedKeys.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Fields not allowed in pricing edit: ${excludedKeys.join(', ')}`
      });
    }

    const unknownKeys = incomingKeys.filter((key) => !OPS_CABIN_PRICING_ALLOWED_FIELDS.has(key));
    if (unknownKeys.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Unsupported pricing fields: ${unknownKeys.join(', ')}`
      });
    }

    const result = await updateCabinFromAdminPayload(
      req.params.id,
      { pricePerNight: body.pricePerNight },
      {}
    );
    if (!result.ok) {
      return res.status(result.status).json(result.payload);
    }
    return res.status(result.status).json(result.payload);
  } catch (error) {
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/:id/experiences', validateId('id'), adminModuleWriteGate('cabins'), async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const incomingKeys = Object.keys(body);

    const excludedKeys = incomingKeys.filter((key) => OPS_CABIN_EXPERIENCES_EXCLUDED_FIELDS.has(key));
    if (excludedKeys.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Fields not allowed in experiences edit: ${excludedKeys.join(', ')}`
      });
    }

    const unknownKeys = incomingKeys.filter((key) => !OPS_CABIN_EXPERIENCES_ALLOWED_FIELDS.has(key));
    if (unknownKeys.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Unsupported experiences fields: ${unknownKeys.join(', ')}`
      });
    }

    const result = await updateCabinFromAdminPayload(
      req.params.id,
      { experiences: body.experiences },
      {}
    );
    if (!result.ok) {
      return res.status(result.status).json(result.payload);
    }
    return res.status(result.status).json(result.payload);
  } catch (error) {
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/:id/images', validateId('id'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!validateMagicBytes(req.file.path, ext)) {
      fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ success: false, message: 'File content does not match its extension' });
    }

    const data = await uploadCabinImage({ cabinId: req.params.id, file: req.file });
    return res.json({ success: true, data });
  } catch (e) {
    if (e.status === 404) {
      return res.status(404).json({ success: false, message: e.message });
    }
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.patch('/:id/images/reorder', validateId('id'), async (req, res) => {
  try {
    const data = await reorderCabinImages({ cabinId: req.params.id, rawBody: req.body });
    return res.json({ success: true, data });
  } catch (e) {
    if (e.status === 404) {
      return res.status(404).json({ success: false, message: e.message });
    }
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.patch('/:id/images/:imageId', validateId('id'), validateId('imageId'), async (req, res) => {
  try {
    const data = await updateCabinImageMetadata({
      cabinId: req.params.id,
      imageId: req.params.imageId,
      payload: req.body
    });
    return res.json({ success: true, data });
  } catch (e) {
    if (e.status === 404) {
      return res.status(404).json({ success: false, message: e.message });
    }
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.patch('/:id/images/batch', async (req, res) => {
  try {
    const data = await batchUpdateCabinImages({ cabinId: req.params.id, updates: req.body?.updates });
    return res.json({ success: true, data });
  } catch (e) {
    if (e.status === 404) {
      return res.status(404).json({ success: false, message: e.message });
    }
    if (e.status === 400) {
      return res.status(400).json({ success: false, message: e.message });
    }
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.delete('/:id/images/:imageId', validateId('id'), validateId('imageId'), async (req, res) => {
  try {
    const data = await deleteCabinImage({
      cabinId: req.params.id,
      imageId: req.params.imageId,
      user: req.user,
      req,
      sourceRoute: 'DELETE /api/ops/cabins/:id/images/:imageId'
    });
    return res.json({ success: true, data });
  } catch (e) {
    if (e.status === 404) {
      return res.status(404).json({ success: false, message: e.message });
    }
    if (e.code === 'PERMISSION_DENIED') {
      return res.status(e.status || 403).json({ success: false, message: e.message });
    }
    if (e.code === 'AUDIT_WRITE_FAILED') {
      return res.status(500).json({ success: false, message: 'Delete blocked because audit write failed' });
    }
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const data = await getCabinDetailReadModel(req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Cabin or cabin type not found' });
    }
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
