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
    const raw = req.body?.airbnbListingLabel;
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      return res.status(400).json({ success: false, message: 'airbnbListingLabel must be a string' });
    }
    const label =
      raw === undefined || raw === null ? undefined : String(raw).trim().slice(0, 200);

    const unit = await Unit.findByIdAndUpdate(
      unitId,
      label === undefined ? {} : { airbnbListingLabel: label === '' ? null : label },
      { new: true }
    )
      .select('airbnbListingLabel')
      .lean();

    if (!unit) {
      return res.status(404).json({ success: false, message: 'Unit not found' });
    }
    return res.json({
      success: true,
      data: { unitId: String(unitId), airbnbListingLabel: unit.airbnbListingLabel || null }
    });
  } catch (error) {
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
