const express = require('express');
const { body, validationResult } = require('express-validator');
const { adminAuth } = require('../middleware/adminAuth');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const featureFlags = require('../utils/featureFlags');

const router = express.Router();

router.use(adminAuth);

const ensureMultiUnitEnabled = (res) => {
  if (!featureFlags.isMultiUnitGloballyEnabled()) {
    res.status(403).json({
      success: false,
      message: 'Multi-unit inventory is disabled'
    });
    return false;
  }
  return true;
};

const transformCabinType = (type, unitsCount = 0) => {
  if (!type) return null;
  const obj = type.toObject();
  obj.meta = {
    isConfigured: featureFlags.isMultiUnitType(obj.slug),
    unitsCount,
    isActive: obj.isActive !== false
  };
  return obj;
};

const CABIN_TYPE_ALLOWED_FIELDS = [
  'name',
  'slug',
  'description',
  'location',
  'hostName',
  'capacity',
  'pricePerNight',
  'minNights',
  'amenities',
  'imageUrl',
  'isActive'
];

const REQUIRED_CABIN_TYPE_FIELDS = ['name', 'slug', 'description', 'location', 'capacity', 'pricePerNight'];
const SLUG_REGEX = /^[a-z0-9-]+$/;

const normalizeNumber = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const sanitizeAmenities = (amenities) => {
  if (amenities === undefined) return { value: undefined };
  if (!Array.isArray(amenities)) {
    return { error: { field: 'amenities', message: 'Amenities must be an array of strings' } };
  }

  const cleaned = [];
  for (const amenity of amenities) {
    if (typeof amenity !== 'string') {
      return { error: { field: 'amenities', message: 'Amenities must be strings' } };
    }
    const trimmed = amenity.trim();
    if (trimmed) cleaned.push(trimmed);
  }

  return { value: cleaned };
};

const sanitizeCabinTypePayload = (input = {}, { isUpdate = false } = {}) => {
  const errors = [];
  const sanitized = {};

  const unknown = Object.keys(input).filter((key) => !CABIN_TYPE_ALLOWED_FIELDS.includes(key));
  if (unknown.length) {
    errors.push({ field: 'root', message: `Unknown fields: ${unknown.join(', ')}` });
  }

  for (const field of REQUIRED_CABIN_TYPE_FIELDS) {
    if (!isUpdate && (input[field] === undefined || input[field] === null || input[field] === '')) {
      errors.push({ field, message: `${field.charAt(0).toUpperCase()}${field.slice(1)} is required` });
    }
  }

  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) {
      errors.push({ field: 'name', message: 'Name must be a non-empty string' });
    } else {
      sanitized.name = input.name.trim();
    }
  }

  if (input.slug !== undefined) {
    if (typeof input.slug !== 'string' || !input.slug.trim()) {
      errors.push({ field: 'slug', message: 'Slug must be a non-empty string' });
    } else {
      const slug = input.slug.trim().toLowerCase();
      if (!SLUG_REGEX.test(slug)) {
        errors.push({ field: 'slug', message: 'Slug must contain only lowercase letters, numbers, or hyphens' });
      } else {
        sanitized.slug = slug;
      }
    }
  }

  if (input.description !== undefined) {
    if (typeof input.description !== 'string' || !input.description.trim()) {
      errors.push({ field: 'description', message: 'Description must be a non-empty string' });
    } else {
      sanitized.description = input.description.trim();
    }
  }

  if (input.location !== undefined) {
    if (typeof input.location !== 'string' || !input.location.trim()) {
      errors.push({ field: 'location', message: 'Location must be a non-empty string' });
    } else {
      sanitized.location = input.location.trim();
    }
  }

  if (input.hostName !== undefined) {
    if (typeof input.hostName !== 'string') {
      errors.push({ field: 'hostName', message: 'Host name must be a string' });
    } else {
      sanitized.hostName = input.hostName.trim();
    }
  }

  if (input.capacity !== undefined) {
    const capacity = normalizeNumber(input.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) {
      errors.push({ field: 'capacity', message: 'Capacity must be a positive integer' });
    } else {
      sanitized.capacity = capacity;
    }
  }

  if (input.pricePerNight !== undefined) {
    const price = normalizeNumber(input.pricePerNight);
    if (price === undefined || price <= 0) {
      errors.push({ field: 'pricePerNight', message: 'Price per night must be a positive number' });
    } else {
      sanitized.pricePerNight = price;
    }
  }

  if (input.minNights !== undefined) {
    const min = normalizeNumber(input.minNights);
    if (!Number.isInteger(min) || min < 1) {
      errors.push({ field: 'minNights', message: 'Minimum nights must be a positive integer' });
    } else {
      sanitized.minNights = min;
    }
  }

  if (input.amenities !== undefined) {
    const { value, error } = sanitizeAmenities(input.amenities);
    if (error) errors.push(error);
    else sanitized.amenities = value;
  }

  if (input.imageUrl !== undefined) {
    if (typeof input.imageUrl !== 'string' || !input.imageUrl.trim()) {
      errors.push({ field: 'imageUrl', message: 'Image URL must be a non-empty string' });
    } else {
      sanitized.imageUrl = input.imageUrl.trim();
    }
  }

  if (input.isActive !== undefined) {
    sanitized.isActive = !!input.isActive;
  }

  Object.keys(sanitized).forEach((key) => {
    if (sanitized[key] === undefined) {
      delete sanitized[key];
    }
  });

  return { sanitized, errors };
};

const sanitizeUnitPayload = (input = {}) => {
  const errors = [];
  const sanitized = {};

  if (input.unitNumber !== undefined) {
    if (typeof input.unitNumber !== 'string' || !input.unitNumber.trim()) {
      errors.push({ field: 'unitNumber', message: 'Unit number must be a non-empty string' });
    } else {
      sanitized.unitNumber = input.unitNumber.trim();
    }
  }

  if (input.displayName !== undefined) {
    if (typeof input.displayName !== 'string') {
      errors.push({ field: 'displayName', message: 'Display name must be a string' });
    } else {
      sanitized.displayName = input.displayName.trim();
    }
  }

  if (input.adminNotes !== undefined) {
    if (typeof input.adminNotes !== 'string') {
      errors.push({ field: 'adminNotes', message: 'Admin notes must be a string' });
    } else {
      sanitized.adminNotes = input.adminNotes.trim();
    }
  }

  if (input.isActive !== undefined) {
    sanitized.isActive = !!input.isActive;
  }

  Object.keys(sanitized).forEach((key) => {
    if (sanitized[key] === undefined) delete sanitized[key];
  });

  return { sanitized, errors };
};

router.get('/', async (req, res) => {
  try {
    if (!ensureMultiUnitEnabled(res)) return;

    const cabinTypes = await CabinType.find().sort({ createdAt: -1 });
    const ids = cabinTypes.map((type) => type._id);
    const counts = await Unit.aggregate([
      { $match: { cabinTypeId: { $in: ids } } },
      { $group: { _id: '$cabinTypeId', count: { $sum: 1 } } }
    ]);
    const countMap = new Map(counts.map((item) => [item._id.toString(), item.count]));

    res.json({
      success: true,
      data: {
        cabinTypes: cabinTypes.map((type) =>
          transformCabinType(type, countMap.get(type._id.toString()) || 0)
        )
      }
    });
  } catch (error) {
    console.error('Get cabin types error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving cabin types',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    if (!ensureMultiUnitEnabled(res)) return;

    const cabinType = await CabinType.findById(req.params.id);
    if (!cabinType) {
      return res.status(404).json({
        success: false,
        message: 'Cabin type not found'
      });
    }

    const unitsCount = await Unit.countDocuments({ cabinTypeId: cabinType._id });

    res.json({
      success: true,
      data: { cabinType: transformCabinType(cabinType, unitsCount) }
    });
  } catch (error) {
    console.error('Get cabin type error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving cabin type',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

router.post('/', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('slug').trim().notEmpty().withMessage('Slug is required'),
  body('description').trim().notEmpty().withMessage('Description is required'),
  body('location').trim().notEmpty().withMessage('Location is required'),
  body('capacity').isInt({ min: 1 }).withMessage('Capacity must be at least 1'),
  body('pricePerNight').isFloat({ gt: 0 }).withMessage('Price per night must be positive'),
  body('imageUrl').trim().notEmpty().withMessage('Image URL is required')
], async (req, res) => {
  try {
    if (!ensureMultiUnitEnabled(res)) return;

    const validation = validationResult(req);
    if (!validation.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.array()
      });
    }

    const { sanitized, errors } = sanitizeCabinTypePayload(req.body, { isUpdate: false });
    if (errors.length) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    const payload = {
      ...sanitized,
      hostName: sanitized.hostName || 'Drift & Dwells',
      minNights: sanitized.minNights ?? 1,
      amenities: sanitized.amenities || []
    };

    const cabinType = await CabinType.create(payload);

    res.status(201).json({
      success: true,
      message: 'Cabin type created successfully',
      data: { cabinType: transformCabinType(cabinType, 0) }
    });
  } catch (error) {
    console.error('Create cabin type error:', error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Cabin type with this name or slug already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error creating cabin type',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    if (!ensureMultiUnitEnabled(res)) return;

    const cabinType = await CabinType.findById(req.params.id);
    if (!cabinType) {
      return res.status(404).json({
        success: false,
        message: 'Cabin type not found'
      });
    }

    const { sanitized, errors } = sanitizeCabinTypePayload(req.body, { isUpdate: true });
    if (errors.length) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    Object.assign(cabinType, sanitized);
    await cabinType.save();

    const unitsCount = await Unit.countDocuments({ cabinTypeId: cabinType._id });

    res.json({
      success: true,
      message: 'Cabin type updated successfully',
      data: { cabinType: transformCabinType(cabinType, unitsCount) }
    });
  } catch (error) {
    console.error('Update cabin type error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating cabin type',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

router.get('/:id/units', async (req, res) => {
  try {
    if (!ensureMultiUnitEnabled(res)) return;

    const cabinType = await CabinType.findById(req.params.id);
    if (!cabinType) {
      return res.status(404).json({
        success: false,
        message: 'Cabin type not found'
      });
    }

    const units = await Unit.find({ cabinTypeId: cabinType._id }).sort({ unitNumber: 1 });
    res.json({ success: true, data: { units } });
  } catch (error) {
    console.error('Get units error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving units',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

router.post('/:id/units', [
  body('unitNumber').trim().notEmpty().withMessage('Unit number is required')
], async (req, res) => {
  try {
    if (!ensureMultiUnitEnabled(res)) return;

    const validation = validationResult(req);
    if (!validation.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validation.array()
      });
    }

    const cabinType = await CabinType.findById(req.params.id);
    if (!cabinType) {
      return res.status(404).json({
        success: false,
        message: 'Cabin type not found'
      });
    }

    const { sanitized, errors } = sanitizeUnitPayload(req.body);
    if (errors.length) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    const unit = await Unit.create({
      cabinTypeId: cabinType._id,
      unitNumber: sanitized.unitNumber,
      displayName: sanitized.displayName,
      adminNotes: sanitized.adminNotes,
      isActive: sanitized.isActive !== false
    });

    res.status(201).json({
      success: true,
      message: 'Unit created successfully',
      data: { unit }
    });
  } catch (error) {
    console.error('Create unit error:', error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Unit with this number already exists for this cabin type'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error creating unit',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

router.patch('/units/:id', async (req, res) => {
  try {
    if (!ensureMultiUnitEnabled(res)) return;

    const unit = await Unit.findById(req.params.id);
    if (!unit) {
      return res.status(404).json({
        success: false,
        message: 'Unit not found'
      });
    }

    const { sanitized, errors } = sanitizeUnitPayload(req.body);
    if (errors.length) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    Object.assign(unit, sanitized);
    await unit.save();

    res.json({
      success: true,
      message: 'Unit updated successfully',
      data: { unit }
    });
  } catch (error) {
    console.error('Update unit error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating unit',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;

