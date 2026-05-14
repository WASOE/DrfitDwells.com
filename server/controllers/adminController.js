const crypto = require('crypto');
const { createToken } = require('../middleware/adminAuth');
const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const {
  resolveReviewOwnerObjectIds,
  aggregateNonDeletedReviewStatsForOwnerIds,
  aggregateNonDeletedReviewStatsForContext
} = require('../services/reviewOwnershipService');
const { isSafeArrivalGuideUrl } = require('../utils/arrivalGuideUrl');
const Unit = require('../models/Unit');
const featureFlags = require('../utils/featureFlags');
const authDefaults = require('../config/defaults');
const bookingLifecycleEmailService = require('../services/bookingLifecycleEmailService');
const { requirePermission, ACTIONS } = require('../services/permissionService');
const { appendAuditEvent } = require('../services/auditWriter');
const { assertAdminModuleWriteAllowed } = require('../services/ops/cutover/opsCutoverService');
const {
  FIXTURE_CABIN_NAME_PATTERN,
  FIXTURE_BOOKING_EMAIL_PATTERN
} = require('../utils/fixtureExclusion');
const { processMetaPurchaseAfterConfirm } = require('../services/bookingPurchaseTracking');
const { syncMultiUnitGalleryToCabinType } = require('../services/syncMultiUnitGalleryToCabinType');
const { formatSofiaDateOnly } = require('../utils/dateTime');
const {
  createCabinFromAdminPayload,
  updateCabinFromAdminPayload
} = require('../services/cabins/cabinManagementService');

const DEFAULT_CABIN_IMAGE_URL = 'https://placehold.co/1200x800?text=Cabin';

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const CABIN_ALLOWED_FIELDS = [
  'name', 'description', 'location', 'hostName', 'capacity', 'pricePerNight', 'minNights',
  'transportOptions', 'blockedDates', 'meetingPoint', 'packingList',
  'arrivalGuideUrl', 'safetyNotes', 'emergencyContact', 'arrivalWindowDefault',
  'transportCutoffs', 'badges', 'highlights', 'experiences',
  'avgResponseTimeHours', 'geoLocation', 'imageUrl',
  'inventoryMode', 'multiUnitConfig', 'units'
];

const REQUIRED_CABIN_FIELDS = ['name', 'description', 'location', 'capacity', 'pricePerNight'];

const normalizeNumber = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const sanitizeTransportOptions = (options = []) => {
  if (!Array.isArray(options)) {
    return { error: { field: 'transportOptions', message: 'Transport options must be an array' } };
  }

  const sanitized = [];
  for (const option of options) {
    if (typeof option !== 'object' || option === null) {
      return { error: { field: 'transportOptions', message: 'Each transport option must be an object' } };
    }

    const cleaned = {
      type: typeof option.type === 'string' ? option.type.trim() : '',
      pricePerPerson: normalizeNumber(option.pricePerPerson) ?? 0,
      description: typeof option.description === 'string' ? option.description.trim() : '',
      duration: typeof option.duration === 'string' ? option.duration.trim() : '',
      isAvailable: option.isAvailable !== false
    };

    if (!cleaned.type) {
      return { error: { field: 'transportOptions', message: 'Transport option type is required' } };
    }

    if (cleaned.pricePerPerson < 0) {
      return { error: { field: 'transportOptions', message: 'Transport price must be a non-negative number' } };
    }

    sanitized.push(cleaned);
  }

  return { value: sanitized };
};

const sanitizeBlockedDates = (dates = []) => {
  if (!Array.isArray(dates)) {
    return { error: { field: 'blockedDates', message: 'Blocked dates must be an array' } };
  }

  const sanitized = [];
  const seen = new Set();
  for (const dateStr of dates) {
    if (typeof dateStr !== 'string') {
      return { error: { field: 'blockedDates', message: 'Blocked dates must be strings in YYYY-MM-DD format' } };
    }

    const trimmed = dateStr.trim();
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(trimmed)) {
      return { error: { field: 'blockedDates', message: `Invalid date format: ${trimmed}. Use YYYY-MM-DD.` } };
    }

    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      sanitized.push(trimmed);
    }
  }

  sanitized.sort();
  return { value: sanitized };
};

const sanitizeStringList = (items = [], field, { maxLength } = {}) => {
  if (!Array.isArray(items)) {
    return { error: { field, message: `${field} must be an array` } };
  }

  const sanitized = [];
  for (const item of items) {
    if (typeof item !== 'string') {
      return { error: { field, message: `${field} must contain only strings` } };
    }
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (maxLength && trimmed.length > maxLength) {
      return { error: { field, message: `${field} items must be ${maxLength} characters or less` } };
    }
    sanitized.push(trimmed);
  }

  return { value: sanitized };
};

const sanitizeExperiences = (experiences = []) => {
  if (!Array.isArray(experiences)) {
    return { error: { field: 'experiences', message: 'Experiences must be an array' } };
  }

  const sanitized = [];
  for (const exp of experiences) {
    if (typeof exp !== 'object' || exp === null) {
      return { error: { field: 'experiences', message: 'Each experience must be an object' } };
    }

    const name = typeof exp.name === 'string' ? exp.name.trim() : '';
    if (!name) {
      return { error: { field: 'experiences', message: 'Each experience must have a name' } };
    }

    const price = normalizeNumber(exp.price);
    if (price === undefined || price < 0) {
      return { error: { field: 'experiences', message: 'Experience price must be a non-negative number' } };
    }

    const unit = exp.unit === 'per_guest' ? 'per_guest' : 'flat_per_stay';

    sanitized.push({
      key: typeof exp.key === 'string' && exp.key ? exp.key : `exp_${Date.now()}_${Math.random()}`,
      name,
      price,
      currency: typeof exp.currency === 'string' && exp.currency ? exp.currency : 'BGN',
      unit,
      active: exp.active !== false,
      sortOrder: normalizeNumber(exp.sortOrder) ?? 0
    });
  }

  return { value: sanitized };
};

const sanitizeGeoLocation = (geo) => {
  if (geo === undefined) return { value: undefined };
  if (geo === null || typeof geo !== 'object') {
    return { error: { field: 'geoLocation', message: 'Geo location must be an object' } };
  }

  const latitude = normalizeNumber(geo.latitude);
  const longitude = normalizeNumber(geo.longitude);
  const zoom = normalizeNumber(geo.zoom);

  if (latitude !== undefined && (latitude < -90 || latitude > 90)) {
    return { error: { field: 'geoLocation', message: 'Latitude must be between -90 and 90' } };
  }
  if (longitude !== undefined && (longitude < -180 || longitude > 180)) {
    return { error: { field: 'geoLocation', message: 'Longitude must be between -180 and 180' } };
  }
  if (zoom !== undefined && (zoom < 1 || zoom > 20)) {
    return { error: { field: 'geoLocation', message: 'Zoom must be between 1 and 20' } };
  }

  if (latitude === undefined && longitude === undefined) {
    return { value: undefined };
  }

  return {
    value: {
      latitude,
      longitude,
      zoom: zoom ?? 11
    }
  };
};

const sanitizeBadges = (badges) => {
  if (badges === undefined) return { value: undefined };
  if (typeof badges !== 'object' || badges === null) {
    return { error: { field: 'badges', message: 'Badges must be an object' } };
  }

  const sanitizeBadge = (badgeKey, defaultLabel) => {
    const badge = badges[badgeKey] || {};
    const enabled = badge.enabled === true;
    const label = typeof badge.label === 'string' ? badge.label.trim() : '';
    return {
      enabled,
      label: enabled ? (label || defaultLabel) : label
    };
  };

  return {
    value: {
      superhost: sanitizeBadge('superhost', 'Superhost'),
      guestFavorite: sanitizeBadge('guestFavorite', 'Guest favorite')
    }
  };
};

const sanitizeMeetingPoint = (meetingPoint) => {
  if (meetingPoint === undefined) return { value: undefined };
  if (meetingPoint === null) return { value: undefined };
  if (typeof meetingPoint !== 'object') {
    return { error: { field: 'meetingPoint', message: 'Meeting point must be an object' } };
  }

  const value = {
    label: typeof meetingPoint.label === 'string' ? meetingPoint.label.trim() : '',
    googleMapsUrl: typeof meetingPoint.googleMapsUrl === 'string' ? meetingPoint.googleMapsUrl.trim() : '',
    what3words: typeof meetingPoint.what3words === 'string' ? meetingPoint.what3words.trim() : '',
    lat: meetingPoint.lat !== undefined ? normalizeNumber(meetingPoint.lat) : undefined,
    lng: meetingPoint.lng !== undefined ? normalizeNumber(meetingPoint.lng) : undefined
  };

  return { value };
};

const sanitizeTransportCutoffs = (cutoffs = []) => {
  if (!Array.isArray(cutoffs)) {
    return { error: { field: 'transportCutoffs', message: 'Transport cutoffs must be an array' } };
  }

  const sanitized = [];
  for (const cutoff of cutoffs) {
    if (typeof cutoff !== 'object' || cutoff === null) {
      return { error: { field: 'transportCutoffs', message: 'Each transport cutoff must be an object' } };
    }
    const type = typeof cutoff.type === 'string' ? cutoff.type.trim() : '';
    const lastDeparture = typeof cutoff.lastDeparture === 'string' ? cutoff.lastDeparture.trim() : '';
    if (!type || !lastDeparture) {
      return { error: { field: 'transportCutoffs', message: 'Transport cutoff requires type and last departure time' } };
    }
    sanitized.push({ type, lastDeparture });
  }

  return { value: sanitized };
};

const sanitizeMultiUnitConfig = (config) => {
  if (config === undefined || config === null) {
    return { value: undefined };
  }
  if (typeof config !== 'object') {
    return { error: { field: 'multiUnitConfig', message: 'Multi-unit config must be an object' } };
  }

  const sanitized = {};
  if (config.prefix !== undefined) {
    if (typeof config.prefix !== 'string') {
      return { error: { field: 'multiUnitConfig', message: 'Prefix must be a string' } };
    }
    sanitized.prefix = config.prefix.trim();
  }
  if (config.autoGeneratedCount !== undefined && config.autoGeneratedCount !== null && config.autoGeneratedCount !== '') {
    const count = Number(config.autoGeneratedCount);
    if (!Number.isInteger(count) || count < 0) {
      return { error: { field: 'multiUnitConfig', message: 'Auto-generated count must be a non-negative integer' } };
    }
    sanitized.autoGeneratedCount = count;
  }

  return { value: sanitized };
};

const sanitizeUnits = (units = []) => {
  if (!Array.isArray(units)) {
    return { error: { field: 'units', message: 'Units must be an array' } };
  }

  const sanitized = [];
  const seen = new Set();

  for (const unit of units) {
    if (typeof unit !== 'object' || unit === null) {
      return { error: { field: 'units', message: 'Each unit must be an object' } };
    }

    const unitNumber = typeof unit.unitNumber === 'string' ? unit.unitNumber.trim() : '';
    if (!unitNumber) {
      return { error: { field: 'units', message: 'Each unit requires a code/label' } };
    }

    const key = unitNumber.toLowerCase();
    if (seen.has(key)) {
      return { error: { field: 'units', message: `Duplicate unit code: ${unitNumber}` } };
    }
    seen.add(key);

    sanitized.push({
      _id: unit._id ? unit._id.toString() : undefined,
      unitNumber,
      displayName: typeof unit.displayName === 'string' ? unit.displayName.trim() : '',
      adminNotes: typeof unit.adminNotes === 'string' ? unit.adminNotes.trim() : '',
      isActive: unit.isActive !== false
    });
  }

  return { value: sanitized };
};

const slugifyName = (name) => {
  if (!name || typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .substring(0, 60) || `property-${Date.now()}`;
};

const ensureUniqueCabinTypeSlug = async (name, currentId = null) => {
  const base = slugifyName(name);
  let slug = base;
  let counter = 1;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await CabinType.findOne(currentId ? { slug, _id: { $ne: currentId } } : { slug }).select('_id');
    if (!existing) break;
    slug = `${base}-${counter++}`;
  }

  return slug;
};

const sanitizeCabinPayload = (input = {}, { isUpdate = false, allowMulti = false } = {}) => {
  const errors = [];
  const sanitized = {};

  for (const field of REQUIRED_CABIN_FIELDS) {
    if (!isUpdate && (input[field] === undefined || input[field] === null || input[field] === '')) {
      errors.push({ field, message: `${field.charAt(0).toUpperCase()}${field.slice(1)} is required` });
    }
  }

  let inventoryMode = 'single';
  if (input.inventoryMode !== undefined && input.inventoryMode !== null && input.inventoryMode !== '') {
    const value = String(input.inventoryMode).toLowerCase();
    if (!['single', 'multi'].includes(value)) {
      errors.push({ field: 'inventoryMode', message: 'Cabin type must be single or multi-unit' });
    } else {
      inventoryMode = value;
    }
  } else if (isUpdate && input.inventoryMode === undefined) {
    inventoryMode = undefined; // preserve existing value when updating and field omitted
  }

  if (inventoryMode === 'multi' && !allowMulti) {
    errors.push({ field: 'inventoryMode', message: 'Multi-unit inventory is disabled' });
  }

  if (inventoryMode !== undefined) {
    sanitized.inventoryMode = inventoryMode;
  }

  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) {
      errors.push({ field: 'name', message: 'Name must be a non-empty string' });
    } else {
      sanitized.name = input.name.trim();
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
    const minNights = normalizeNumber(input.minNights);
    if (!Number.isInteger(minNights) || minNights < 1) {
      errors.push({ field: 'minNights', message: 'Minimum nights must be a positive integer' });
    } else {
      sanitized.minNights = minNights;
    }
  }

  if (input.transportOptions !== undefined) {
    const { value, error } = sanitizeTransportOptions(input.transportOptions);
    if (error) errors.push(error);
    else sanitized.transportOptions = value;
  }

  if (input.blockedDates !== undefined) {
    const { value, error } = sanitizeBlockedDates(input.blockedDates);
    if (error) errors.push(error);
    else sanitized.blockedDates = value;
  }

  if (input.packingList !== undefined) {
    const { value, error } = sanitizeStringList(input.packingList, 'packingList', {});
    if (error) errors.push(error);
    else sanitized.packingList = value;
  }

  if (input.highlights !== undefined) {
    const { value, error } = sanitizeStringList(input.highlights, 'highlights', { maxLength: 100 });
    if (error) errors.push(error);
    else sanitized.highlights = value.slice(0, 5);
  }

  if (input.experiences !== undefined) {
    const { value, error } = sanitizeExperiences(input.experiences);
    if (error) errors.push(error);
    else sanitized.experiences = value;
  }

  if (input.arrivalGuideUrl !== undefined) {
    if (typeof input.arrivalGuideUrl !== 'string') {
      errors.push({ field: 'arrivalGuideUrl', message: 'Arrival guide URL must be a string' });
    } else {
      const arrivalGuideUrl = input.arrivalGuideUrl.trim();
      if (!isSafeArrivalGuideUrl(arrivalGuideUrl)) {
        errors.push({
          field: 'arrivalGuideUrl',
          message: 'Arrival guide URL must be an absolute http(s) URL or a safe /guides/... path'
        });
      } else {
        sanitized.arrivalGuideUrl = arrivalGuideUrl;
      }
    }
  }

  if (input.safetyNotes !== undefined) {
    if (typeof input.safetyNotes !== 'string') {
      errors.push({ field: 'safetyNotes', message: 'Safety notes must be a string' });
    } else {
      sanitized.safetyNotes = input.safetyNotes.trim();
    }
  }

  if (input.emergencyContact !== undefined) {
    if (typeof input.emergencyContact !== 'string') {
      errors.push({ field: 'emergencyContact', message: 'Emergency contact must be a string' });
    } else {
      sanitized.emergencyContact = input.emergencyContact.trim();
    }
  }

  if (input.arrivalWindowDefault !== undefined) {
    if (typeof input.arrivalWindowDefault !== 'string') {
      errors.push({ field: 'arrivalWindowDefault', message: 'Arrival window must be a string' });
    } else {
      sanitized.arrivalWindowDefault = input.arrivalWindowDefault.trim();
    }
  }

  if (input.transportCutoffs !== undefined) {
    const { value, error } = sanitizeTransportCutoffs(input.transportCutoffs);
    if (error) errors.push(error);
    else sanitized.transportCutoffs = value;
  }

  if (inventoryMode === 'multi') {
    const { value: multiConfig, error: multiError } = sanitizeMultiUnitConfig(input.multiUnitConfig);
    if (multiError) errors.push(multiError);
    else if (multiConfig) sanitized.multiUnitConfig = multiConfig;

    const { value: units, error: unitsError } = sanitizeUnits(input.units);
    if (unitsError) errors.push(unitsError);
    else sanitized.units = units;

    if (!sanitized.units || sanitized.units.length === 0) {
      errors.push({ field: 'units', message: 'Add at least one unit when using multi-unit inventory' });
    }
  }

  if (input.avgResponseTimeHours !== undefined && input.avgResponseTimeHours !== '') {
    const hours = normalizeNumber(input.avgResponseTimeHours);
    if (hours === undefined || hours < 0) {
      errors.push({ field: 'avgResponseTimeHours', message: 'Average response time must be a non-negative number' });
    } else {
      sanitized.avgResponseTimeHours = hours;
    }
  }

  if (input.geoLocation !== undefined) {
    const { value, error } = sanitizeGeoLocation(input.geoLocation);
    if (error) errors.push(error);
    else sanitized.geoLocation = value;
  }

  if (input.badges !== undefined) {
    const { value, error } = sanitizeBadges(input.badges);
    if (error) errors.push(error);
    else sanitized.badges = value;
  }

  if (input.meetingPoint !== undefined) {
    const { value, error } = sanitizeMeetingPoint(input.meetingPoint);
    if (error) errors.push(error);
    else sanitized.meetingPoint = value;
  }

  if (input.imageUrl !== undefined) {
    if (typeof input.imageUrl !== 'string' || !input.imageUrl.trim()) {
      errors.push({ field: 'imageUrl', message: 'Image URL must be a non-empty string when provided' });
    } else {
      sanitized.imageUrl = input.imageUrl.trim();
    }
  }

  Object.keys(sanitized).forEach((key) => {
    if (sanitized[key] === undefined) {
      delete sanitized[key];
    }
  });

  return { sanitized, errors };
};

const mapUnitForResponse = (unit) => ({
  _id: unit._id ? unit._id.toString() : undefined,
  unitNumber: unit.unitNumber,
  displayName: unit.displayName || '',
  adminNotes: unit.adminNotes || '',
  isActive: unit.isActive !== false
});

const fetchUnitsForCabinType = async (cabinTypeId) => {
  if (!cabinTypeId) return [];
  const units = await Unit.find({ cabinTypeId }).sort({ unitNumber: 1 });
  return units.map(mapUnitForResponse);
};

const ACTIVE_BOOKING_STATUSES = ['pending', 'confirmed'];

const hasActiveBookings = async (cabinId, cabinTypeId) => {
  const conditions = [];
  if (cabinId) conditions.push({ cabinId });
  if (cabinTypeId) conditions.push({ cabinTypeId });
  if (conditions.length === 0) return false;

  return Boolean(
    await Booking.findOne({
      status: { $in: ACTIVE_BOOKING_STATUSES },
      $or: conditions
    }).select('_id')
  );
};

const canSwitchInventoryMode = async (cabin) => {
  if (!cabin) return true;
  const cabinId = cabin._id;
  const cabinTypeId = cabin.cabinTypeRef || cabin.cabinTypeId;
  const hasBookings = await hasActiveBookings(cabinId, cabinTypeId);
  return !hasBookings;
};

const buildCabinResponse = async (cabinDocument) => {
  if (!cabinDocument) return null;
  const cabin = cabinDocument.toObject ? cabinDocument.toObject() : { ...cabinDocument };
  cabin.inventoryMode = cabin.inventoryMode || cabin.inventoryType || 'single';
  cabin.units = [];
  cabin.meta = cabin.meta || {};

  if (cabin.inventoryMode === 'multi') {
    const cabinTypeId = cabin.cabinTypeRef || cabin.cabinTypeId;
    if (cabinTypeId) {
      const cabinType = await CabinType.findById(cabinTypeId);
      if (cabinType) {
        cabin.cabinTypeRef = cabinType._id;
        cabin.multiUnitConfig = cabin.multiUnitConfig || {};
        cabin.multiUnit = {
          cabinTypeId: cabinType._id,
          slug: cabinType.slug,
          name: cabinType.name,
          isConfigured: featureFlags.isMultiUnitGloballyEnabled()
        };
      }
      cabin.units = await fetchUnitsForCabinType(cabinTypeId);
    }
  } else {
    cabin.cabinTypeRef = null;
  }

  const resolvedStats = await aggregateNonDeletedReviewStatsForContext(cabin._id);
  cabin.reviewsCount = resolvedStats.reviewsCount;
  cabin.averageRating = resolvedStats.averageRating;

  cabin.meta.canSwitchInventoryMode = await canSwitchInventoryMode(cabin);
  return cabin;
};

const syncUnits = async (cabinTypeId, incomingUnits = []) => {
  if (!cabinTypeId) return [];

  const existingUnits = await Unit.find({ cabinTypeId });
  const incomingById = new Map();
  incomingUnits.forEach((unit) => {
    if (unit._id) {
      incomingById.set(unit._id.toString(), unit);
    }
  });

  for (const existing of existingUnits) {
    const match = incomingById.get(existing._id.toString());
    if (match) {
      existing.unitNumber = match.unitNumber;
      existing.displayName = match.displayName || '';
      existing.adminNotes = match.adminNotes || '';
      existing.isActive = match.isActive !== false;
      await existing.save();
      incomingById.delete(existing._id.toString());
    } else {
      existing.isActive = false;
      await existing.save();
    }
  }

  const newUnits = incomingUnits.filter((unit) => !unit._id);
  if (newUnits.length > 0) {
    await Unit.insertMany(
      newUnits.map((unit) => ({
        cabinTypeId,
        unitNumber: unit.unitNumber,
        displayName: unit.displayName || '',
        adminNotes: unit.adminNotes || '',
        isActive: unit.isActive !== false
      }))
    );
  }

  return fetchUnitsForCabinType(cabinTypeId);
};

// Admin login
const login = (req, res) => {
  try {
    const { username, password } = req.body;

    const adminUser = process.env.ADMIN_USER || authDefaults.adminUser;
    const adminPass = process.env.ADMIN_PASS || authDefaults.adminPass;
    const operatorUser = process.env.ADMIN_OPERATOR_USER || authDefaults.operatorUser;
    const operatorPass = process.env.ADMIN_OPERATOR_PASS || authDefaults.operatorPass;
    const jwtSecret = process.env.ADMIN_JWT_SECRET || authDefaults.adminJwtSecret;

    if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS || !process.env.ADMIN_JWT_SECRET) {
      console.warn('Admin login using fallback credentials from config/defaults.js. Set ADMIN_USER, ADMIN_PASS, and ADMIN_JWT_SECRET for production.');
    }
    if (!process.env.ADMIN_OPERATOR_USER || !process.env.ADMIN_OPERATOR_PASS) {
      console.warn('Operator login using fallback credentials from config/defaults.js. Set ADMIN_OPERATOR_USER and ADMIN_OPERATOR_PASS for production.');
    }

    const userBuf = Buffer.from(String(username || ''), 'utf8');
    const passBuf = Buffer.from(String(password || ''), 'utf8');

    const adminUserBuf = Buffer.from(adminUser, 'utf8');
    const adminPassBuf = Buffer.from(adminPass, 'utf8');
    const operatorUserBuf = Buffer.from(operatorUser, 'utf8');
    const operatorPassBuf = Buffer.from(operatorPass, 'utf8');

    const adminMatch =
      userBuf.length === adminUserBuf.length &&
      crypto.timingSafeEqual(userBuf, adminUserBuf) &&
      passBuf.length === adminPassBuf.length &&
      crypto.timingSafeEqual(passBuf, adminPassBuf);

    const operatorMatch =
      userBuf.length === operatorUserBuf.length &&
      crypto.timingSafeEqual(userBuf, operatorUserBuf) &&
      passBuf.length === operatorPassBuf.length &&
      crypto.timingSafeEqual(passBuf, operatorPassBuf);

    if (!adminMatch && !operatorMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const role = adminMatch ? 'admin' : 'operator';
    const subject = adminMatch ? 'admin' : 'operator';

    // Create token payload (24h TTL; bump ADMIN_TOKEN_VERSION env to revoke all existing tokens)
    const now = Math.floor(Date.now() / 1000);
    const ttlSeconds = 24 * 60 * 60;
    const payload = {
      sub: subject,
      role,
      iat: now,
      exp: now + ttlSeconds,
      jti: crypto.randomBytes(16).toString('hex'),
      tv: String(process.env.ADMIN_TOKEN_VERSION || '1')
    };

    // Generate token
    const token = createToken(payload, jwtSecret);

    res.json({
      success: true,
      token,
      role,
      expiresIn: ttlSeconds
    });
    
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
};

// Get bookings with filters and pagination
const getBookings = async (req, res) => {
  try {
    const {
      status,
      cabinId,
      from,
      to,
      q,
      transport,
      stayScope,
      page = 1,
      limit = 20,
      includeFixtures,
      includeArchived
    } = req.query;

    const showFixtures = includeFixtures === '1' || includeFixtures === 'true';
    const showArchived = includeArchived === '1' || includeArchived === 'true';

    const and = [];
    if (status) and.push({ status });
    if (cabinId) and.push({ cabinId });
    if (from || to) {
      const checkIn = {};
      if (from) checkIn.$gte = new Date(from);
      if (to) checkIn.$lte = new Date(to);
      and.push({ checkIn });
    }
    if (transport) and.push({ transportMethod: transport });
    if (stayScope) {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (stayScope === 'past') {
        and.push({ checkOut: { $lt: startOfToday } });
      } else if (stayScope === 'active') {
        and.push({ checkOut: { $gte: startOfToday } });
      } else {
        return res.status(400).json({
          success: false,
          message: 'stayScope must be active or past'
        });
      }
    }
    if (!showFixtures) {
      and.push({ isTest: { $ne: true } });
      and.push({ 'guestInfo.email': { $not: FIXTURE_BOOKING_EMAIL_PATTERN } });
      const fixtureCabinIds = await Cabin.find({ name: { $regex: FIXTURE_CABIN_NAME_PATTERN } })
        .select('_id')
        .lean();
      if (fixtureCabinIds.length > 0) {
        and.push({
          $or: [
            { cabinId: null },
            { cabinId: { $exists: false } },
            { cabinId: { $nin: fixtureCabinIds.map((c) => c._id) } }
          ]
        });
      }
    }
    if (!showArchived) {
      and.push({ $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }] });
    }
    if (q) {
      and.push({
        $or: [
          { 'guestInfo.firstName': { $regex: escapeRegex(q), $options: 'i' } },
          { 'guestInfo.lastName': { $regex: escapeRegex(q), $options: 'i' } },
          { 'guestInfo.email': { $regex: escapeRegex(q), $options: 'i' } }
        ]
      });
    }

    const filter = and.length === 0 ? {} : and.length === 1 ? and[0] : { $and: and };

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    // Get bookings with cabin population
    const bookings = await Booking.find(filter)
      .populate('cabinId', 'name location')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Get total count for pagination
    const total = await Booking.countDocuments(filter);

    // Transform bookings for admin view
    const transformedBookings = bookings.map(booking => ({
      _id: booking._id,
      createdAt: booking.createdAt,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      checkInDateOnly: booking.checkIn ? formatSofiaDateOnly(booking.checkIn) : null,
      checkOutDateOnly: booking.checkOut ? formatSofiaDateOnly(booking.checkOut) : null,
      adults: booking.adults,
      children: booking.children,
      status: booking.status,
      totalPrice: booking.totalPrice,
      tripType: booking.tripType,
      transportMethod: booking.transportMethod,
      romanticSetup: booking.romanticSetup,
      cabinId: booking.cabinId?._id,
      cabinName: booking.cabinId?.name,
      cabinLocation: booking.cabinId?.location,
      guestInfo: {
        firstName: booking.guestInfo.firstName,
        lastName: booking.guestInfo.lastName,
        email: booking.guestInfo.email,
        phone: booking.guestInfo.phone
      }
    }));

    res.json({
      success: true,
      data: {
        items: transformedBookings,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          hasNext: skip + limitNum < total,
          hasPrev: pageNum > 1,
          totalPages: Math.ceil(total / limitNum)
        }
      }
    });

  } catch (error) {
    console.error('Get bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bookings'
    });
  }
};

// Get single booking detail
const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;

    const booking = await Booking.findById(id)
      .populate('cabinId', 'name location capacity pricePerNight amenities transportOptions')
      .lean();

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const bookingPayload = {
      ...booking,
      checkInDateOnly: booking.checkIn ? formatSofiaDateOnly(booking.checkIn) : null,
      checkOutDateOnly: booking.checkOut ? formatSofiaDateOnly(booking.checkOut) : null
    };

    res.json({
      success: true,
      data: { booking: bookingPayload }
    });

  } catch (error) {
    console.error('Get booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch booking'
    });
  }
};

// Update booking status
const updateBookingStatus = async (req, res) => {
  try {
    const legacyWrites = process.env.LEGACY_ADMIN_BOOKING_STATUS_WRITE;
    if (legacyWrites === '0' || legacyWrites === 'false') {
      return res.status(403).json({
        success: false,
        errorType: 'legacy_write_disabled',
        message: 'Legacy admin booking status writes are disabled. Use the OPS reservations workspace.',
        hint: 'Re-enable with LEGACY_ADMIN_BOOKING_STATUS_WRITE=1 if you must use this path temporarily.'
      });
    }

    const { id } = req.params;
    const { status } = req.body;

    // Validate status
    const validStatuses = ['pending', 'confirmed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be one of: pending, confirmed, cancelled'
      });
    }

    // Find and update booking
    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.status === status) {
      return res.json({
        success: true,
        data: { booking },
        message: 'Status unchanged'
      });
    }

    const ALLOWED_TRANSITIONS = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['cancelled'],
      cancelled: []
    };
    const allowed = ALLOWED_TRANSITIONS[booking.status];
    if (!allowed || !allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot transition from ${booking.status} to ${status}`
      });
    }

    const oldStatus = booking.status;
    // Cutover enforcement: when the Reservations module is cut over, legacy /admin writes are blocked.
    await assertAdminModuleWriteAllowed('reservations');
    requirePermission({
      role: req.user?.role,
      action: ACTIONS.BOOKING_STATUS_UPDATE
    });

    await appendAuditEvent(
      {
        actorType: 'user',
        actorId: req.user?.id || 'admin',
        entityType: 'Reservation',
        entityId: booking._id.toString(),
        action: 'reservation_status_update',
        beforeSnapshot: { status: oldStatus },
        afterSnapshot: { status },
        metadata: {
          legacyModel: 'Booking'
        },
        reason: null,
        sourceContext: {
          route: 'PATCH /api/admin/bookings/:id/status'
        }
      },
      { req }
    );

    booking.status = status;
    await booking.save({ validateBeforeSave: false });

    if (status === 'confirmed' && oldStatus !== 'confirmed') {
      void processMetaPurchaseAfterConfirm(String(booking._id), req).catch((err) => {
        console.error('[meta-purchase] Admin confirm CAPI error:', err);
      });
    }

    // Populate cabin info for response
    await booking.populate('cabinId', 'name location');

    // Send email notifications for status changes (shared lifecycle service + durable log)
    try {
      if (status === 'confirmed' && oldStatus !== 'confirmed') {
        await bookingLifecycleEmailService.sendBookingLifecycleEmail({
          booking,
          templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
          overrideRecipient: null,
          lifecycleSource: 'automatic',
          actorContext: null
        });
      } else if (status === 'cancelled' && oldStatus !== 'cancelled') {
        await bookingLifecycleEmailService.sendBookingLifecycleEmail({
          booking,
          templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CANCELLED,
          overrideRecipient: null,
          lifecycleSource: 'automatic',
          actorContext: null
        });
      }
    } catch (emailError) {
      console.error('Email sending error:', emailError);
      // Don't fail the status update if emails fail
    }

    // MessageOrchestrator hook (Batch 7). Default OFF; never blocks the
    // admin status update. Lazy-required + try/catch + fire-and-forget so
    // a require/throw failure cannot break the legacy admin path.
    try {
      const { notifyBookingStatusChange } = require('../services/messaging/messageOrchestrator');
      Promise.resolve()
        .then(() => notifyBookingStatusChange({
          bookingId: booking._id,
          previousStatus: oldStatus,
          nextStatus: status,
          transitionKind: 'admin_status_update'
        }))
        .catch((err) => {
          console.error(
            JSON.stringify({
              source: 'message-orchestrator',
              phase: 'admin_status_update_async_error',
              bookingId: String(booking._id),
              error: err?.message || String(err)
            })
          );
        });
    } catch (orchestratorRequireErr) {
      console.error(
        JSON.stringify({
          source: 'message-orchestrator',
          phase: 'admin_status_update_require_error',
          bookingId: String(booking._id),
          error: orchestratorRequireErr?.message || String(orchestratorRequireErr)
        })
      );
    }

    res.json({
      success: true,
      data: { booking },
      message: 'Status updated successfully'
    });

  } catch (error) {
    console.error('Update booking status error:', error);
    if (error.code === 'PERMISSION_DENIED') {
      return res.status(error.status || 403).json({
        success: false,
        message: error.message,
        hint: 'Use the OPS reservations workspace for day-to-day reservation lifecycle changes.'
      });
    }
    if (error.code === 'CUTOVER_WRITE_BLOCKED') {
      return res.status(error.status || 403).json({
        success: false,
        errorType: 'cutover_blocked',
        message: error.message,
        details: { moduleKey: error.moduleKey || 'unknown' }
      });
    }
    if (error.code === 'AUDIT_WRITE_FAILED') {
      return res.status(500).json({
        success: false,
        message: 'Status update blocked because audit write failed'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to update booking status'
    });
  }
};

// Get cabins list with search and pagination
const getCabins = async (req, res) => {
  try {
    const {
      q,
      page = 1,
      limit = 20,
      includeFixtures,
      includeArchived
    } = req.query;

    const showFixtures = includeFixtures === '1' || includeFixtures === 'true';
    const showArchived = includeArchived === '1' || includeArchived === 'true';

    const and = [];
    if (!showFixtures) {
      and.push({ name: { $not: FIXTURE_CABIN_NAME_PATTERN } });
    }
    if (!showArchived) {
      and.push({ $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }] });
    }
    if (q) {
      and.push({
        $or: [
          { name: { $regex: escapeRegex(q), $options: 'i' } },
          { location: { $regex: escapeRegex(q), $options: 'i' } }
        ]
      });
    }

    const filter = and.length === 0 ? {} : and.length === 1 ? and[0] : { $and: and };

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const cabins = await Cabin.find(filter)
      .sort({ name: 1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const total = await Cabin.countDocuments(filter);

    const multiCabins = cabins.filter((cabin) => cabin.inventoryType === 'multi' && cabin.cabinTypeId);
    const multiTypeIds = multiCabins.map((cabin) => cabin.cabinTypeId).filter(Boolean);

    const cabinTypesMap = new Map();
    const unitsCountMap = new Map();

    const ownerSets = await Promise.all(
      cabins.map((c) => resolveReviewOwnerObjectIds(c._id))
    );
    const uniqueOwnerKeys = new Map();
    for (const ids of ownerSets) {
      const key = ids.map((o) => o.toString()).sort().join('|');
      if (!uniqueOwnerKeys.has(key)) uniqueOwnerKeys.set(key, ids);
    }
    const statsByKey = new Map();
    await Promise.all(
      [...uniqueOwnerKeys.entries()].map(async ([key, ownerIds]) => {
        const stats = await aggregateNonDeletedReviewStatsForOwnerIds(ownerIds);
        statsByKey.set(key, stats);
      })
    );
    const resolvedStatsList = ownerSets.map((ids) => {
      const key = ids.map((o) => o.toString()).sort().join('|');
      return statsByKey.get(key);
    });

    if (multiTypeIds.length > 0) {
      const cabinTypes = await CabinType.find({ _id: { $in: multiTypeIds } })
        .select('name slug isActive capacity pricePerNight minNights')
        .lean();
      cabinTypes.forEach((type) => cabinTypesMap.set(type._id.toString(), type));

      const unitCounts = await Unit.aggregate([
        { $match: { cabinTypeId: { $in: multiTypeIds } } },
        {
          $group: {
            _id: '$cabinTypeId',
            count: { $sum: 1 },
            active: { $sum: { $cond: ['$isActive', 1, 0] } }
          }
        }
      ]);
      unitCounts.forEach((row) => unitsCountMap.set(row._id.toString(), row));
    }

    const transformedCabins = cabins.map((cabin, index) => {
      const resolved = resolvedStatsList[index];
      const base = {
      _id: cabin._id,
      name: cabin.name,
      location: cabin.location,
      capacity: cabin.capacity,
      pricePerNight: cabin.pricePerNight,
      minNights: cabin.minNights,
      transportOptionsCount: cabin.transportOptions?.length || 0,
        blockedDatesCount: cabin.blockedDates?.length || 0,
        inventoryType: cabin.inventoryType || 'single',
        reviewsCount: resolved.reviewsCount,
        averageRating: resolved.averageRating
      };

      if (base.inventoryType === 'multi') {
        const key = cabin.cabinTypeId ? cabin.cabinTypeId.toString() : null;
        const counts = key ? unitsCountMap.get(key) : null;
        base.unitsCount = counts ? counts.count : 0;
        base.activeUnitsCount = counts ? counts.active : 0;
        const cabinType = key ? cabinTypesMap.get(key) : null;
        base.multiUnit = cabinType
          ? {
              cabinTypeId: cabinType._id,
              slug: cabinType.slug,
              isActive: cabinType.isActive !== false
            }
          : null;
      } else {
        base.unitsCount = 1;
        base.activeUnitsCount = 1;
      }

      return base;
    });

    res.json({
      success: true,
      data: {
        items: transformedCabins,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          hasNext: skip + limitNum < total,
          hasPrev: pageNum > 1,
          totalPages: Math.ceil(total / limitNum)
        },
        meta: {
          multiUnitEnabled: featureFlags.isMultiUnitGloballyEnabled()
        }
      }
    });
  } catch (error) {
    console.error('Get cabins error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cabins'
    });
  }
};

// Get single cabin detail
const getCabinById = async (req, res) => {
  try {
    const { id } = req.params;

    const cabin = await Cabin.findById(id).lean();

    if (!cabin) {
      return res.status(404).json({
        success: false,
        message: 'Cabin not found'
      });
    }

    const bookingsExist = await Booking.exists({
      $or: [
        { cabinId: cabin._id },
        ...(cabin.cabinTypeId ? [{ cabinTypeId: cabin.cabinTypeId }] : [])
      ]
    });

    let multiUnit = null;
    if (cabin.inventoryType === 'multi' && cabin.cabinTypeId) {
      const cabinType = await CabinType.findById(cabin.cabinTypeId).lean();
      const units = await Unit.find({ cabinTypeId: cabin.cabinTypeId })
        .sort({ unitNumber: 1 })
        .lean();

      if (cabinType) {
        multiUnit = {
          cabinTypeId: cabinType._id,
          slug: cabinType.slug,
          units,
          isActive: cabinType.isActive !== false,
          summary: {
            capacityPerUnit: cabinType.capacity,
            pricePerNight: cabinType.pricePerNight,
            minNights: cabinType.minNights
          }
        };
      } else {
        multiUnit = { cabinTypeId: cabin.cabinTypeId, units };
      }
    }

    const resolvedStats = await aggregateNonDeletedReviewStatsForContext(id);
    cabin.reviewsCount = resolvedStats.reviewsCount;
    cabin.averageRating = resolvedStats.averageRating;

    res.json({
      success: true,
      data: {
        cabin: { ...cabin, multiUnit },
        meta: {
          multiUnitEnabled: featureFlags.isMultiUnitGloballyEnabled(),
          inventoryTypeLocked: Boolean(bookingsExist)
        }
      }
    });

  } catch (error) {
    console.error('Get cabin error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cabin'
    });
  }
};

// Update cabin
const updateCabin = async (req, res) => {
  try {
    const result = await updateCabinFromAdminPayload(req.params.id, req.body, {
      syncMultiUnitGalleryToCabinType
    });
    if (!result.ok) {
      return res.status(result.status).json(result.payload);
    }
    return res.status(result.status).json(result.payload);
  } catch (error) {
    console.error('Update cabin error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update cabin'
    });
  }
};

const createCabin = async (req, res) => {
  try {
    const result = await createCabinFromAdminPayload(req.body);
    if (!result.ok) {
      if (result.status === 400) {
        console.warn('Admin create cabin validation errors:', result.payload.errors, { body: req.body });
      }
      return res.status(result.status).json(result.payload);
    }
    return res.status(result.status).json(result.payload);
  } catch (error) {
    console.error('Create cabin error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create cabin'
    });
  }
};

const {
  previewBookingLifecycleEmail,
  resendBookingLifecycleEmail
} = require('./shared/bookingLifecycleEmailController');

module.exports = {
  login,
  getBookings,
  getBookingById,
  updateBookingStatus,
  resendBookingLifecycleEmail,
  previewBookingLifecycleEmail,
  getCabins,
  getCabinById,
  createCabin,
  updateCabin
};
