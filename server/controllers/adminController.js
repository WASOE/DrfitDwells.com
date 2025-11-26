const crypto = require('crypto');
const { createToken } = require('../middleware/adminAuth');
const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const featureFlags = require('../utils/featureFlags');
const authDefaults = require('../config/defaults');
const emailService = require('../services/emailService');

const DEFAULT_CABIN_IMAGE_URL = 'https://placehold.co/1200x800?text=Cabin';

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
      sanitized.arrivalGuideUrl = input.arrivalGuideUrl.trim();
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
    const jwtSecret = process.env.ADMIN_JWT_SECRET || authDefaults.adminJwtSecret;

    if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS || !process.env.ADMIN_JWT_SECRET) {
      console.warn('Admin login using fallback credentials from config/defaults.js. Set ADMIN_USER, ADMIN_PASS, and ADMIN_JWT_SECRET for production.');
    }

    // Verify credentials
    if (username !== adminUser || password !== adminPass) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Create token payload
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'admin',
      iat: now,
      exp: now + (7 * 24 * 60 * 60), // 7 days
      jti: crypto.randomBytes(16).toString('hex')
    };
    
    // Generate token
    const token = createToken(payload, jwtSecret);
    
    res.json({
      success: true,
      token,
      expiresIn: 7 * 24 * 60 * 60 // 7 days in seconds
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
      page = 1,
      limit = 20
    } = req.query;

    // Build filter object
    const filter = {};

    // Status filter
    if (status) {
      filter.status = status;
    }

    // Cabin filter
    if (cabinId) {
      filter.cabinId = cabinId;
    }

    // Date range filter (check-in date)
    if (from || to) {
      filter.checkIn = {};
      if (from) {
        filter.checkIn.$gte = new Date(from);
      }
      if (to) {
        filter.checkIn.$lte = new Date(to);
      }
    }

    // Transport filter
    if (transport) {
      filter.transportMethod = transport;
    }

    // Text search (guest name, email, or booking reference)
    if (q) {
      filter.$or = [
        { 'guestInfo.firstName': { $regex: q, $options: 'i' } },
        { 'guestInfo.lastName': { $regex: q, $options: 'i' } },
        { 'guestInfo.email': { $regex: q, $options: 'i' } }
      ];
    }

    // Calculate pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
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

    res.json({
      success: true,
      data: { booking }
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

    // No-op if status is the same
    if (booking.status === status) {
      return res.json({
        success: true,
        data: { booking },
        message: 'Status unchanged'
      });
    }

    // Update status (skip date validations since we're only updating status)
    const oldStatus = booking.status;
    booking.status = status;
    await booking.save({ validateBeforeSave: false });

    // Populate cabin info for response
    await booking.populate('cabinId', 'name location');

    // Send email notifications for status changes
    try {
      if (status === 'confirmed' && oldStatus !== 'confirmed') {
        const confirmedEmail = emailService.generateBookingConfirmedEmail(booking, booking.cabinId);
        await emailService.sendEmail({
          to: booking.guestInfo.email,
          subject: confirmedEmail.subject,
          html: confirmedEmail.html,
          text: confirmedEmail.text,
          trigger: 'booking_confirmed',
          bookingId: booking._id
        });
      } else if (status === 'cancelled' && oldStatus !== 'cancelled') {
        const cancelledEmail = emailService.generateBookingCancelledEmail(booking, booking.cabinId);
        await emailService.sendEmail({
          to: booking.guestInfo.email,
          subject: cancelledEmail.subject,
          html: cancelledEmail.html,
          text: cancelledEmail.text,
          trigger: 'booking_cancelled',
          bookingId: booking._id
        });
      }
    } catch (emailError) {
      console.error('Email sending error:', emailError);
      // Don't fail the status update if emails fail
    }

    res.json({
      success: true,
      data: { booking },
      message: 'Status updated successfully'
    });

  } catch (error) {
    console.error('Update booking status error:', error);
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
      limit = 20
    } = req.query;

    const filter = {};

    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { location: { $regex: q, $options: 'i' } }
      ];
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
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

    const transformedCabins = cabins.map((cabin) => {
      const base = {
      _id: cabin._id,
      name: cabin.name,
      location: cabin.location,
      capacity: cabin.capacity,
      pricePerNight: cabin.pricePerNight,
      minNights: cabin.minNights,
      transportOptionsCount: cabin.transportOptions?.length || 0,
        blockedDatesCount: cabin.blockedDates?.length || 0,
        inventoryType: cabin.inventoryType || 'single'
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
    const { id } = req.params;
    const cabin = await Cabin.findById(id);
    if (!cabin) {
      return res.status(404).json({
        success: false,
        message: 'Cabin not found'
      });
    }

    const allowMulti = featureFlags.isMultiUnitGloballyEnabled();
    const existingInventoryMode = cabin.inventoryMode || cabin.inventoryType || 'single';
    const incomingInventoryMode =
      req.body.inventoryMode !== undefined && req.body.inventoryMode !== null
        ? String(req.body.inventoryMode).toLowerCase()
        : undefined;
    const incomingInventoryType =
      req.body.inventoryType !== undefined && req.body.inventoryType !== null
        ? String(req.body.inventoryType).toLowerCase()
        : undefined;
    const requestedModeFromRequest =
      incomingInventoryMode ?? incomingInventoryType ?? existingInventoryMode;
    const requestedInventoryMode = requestedModeFromRequest === 'multi' ? 'multi' : 'single';

    if (requestedInventoryMode === 'multi' && !allowMulti) {
      return res.status(400).json({
        success: false,
        message: 'Multi-unit cabins are currently disabled'
      });
    }

    const basePayload = { ...req.body };
    if (basePayload.inventoryType !== undefined && basePayload.inventoryMode === undefined) {
      basePayload.inventoryMode = basePayload.inventoryType;
    }
    delete basePayload.inventoryType;

    const { sanitized, errors } = sanitizeCabinPayload(basePayload, {
      isUpdate: true,
      allowMulti
    });
    const collectedErrors = [...errors];

    const sanitizedMultiUnitConfig = sanitized.multiUnitConfig;
    const sanitizedUnitsRaw = sanitized.units;
    const sanitizedInventoryMode = sanitized.inventoryMode;
    delete sanitized.multiUnitConfig;
    delete sanitized.units;
    delete sanitized.inventoryMode;

    const finalInventoryMode =
      sanitizedInventoryMode ?? requestedInventoryMode ?? existingInventoryMode;

    const unitsProvided = req.body.units !== undefined;
    const sanitizedUnits = unitsProvided
      ? Array.isArray(sanitizedUnitsRaw)
        ? sanitizedUnitsRaw
        : []
      : null;

    if (
      finalInventoryMode === 'multi' &&
      unitsProvided &&
      Array.isArray(sanitizedUnits) &&
      sanitizedUnits.length === 0
    ) {
      collectedErrors.push({ field: 'units', message: 'At least one unit is required' });
    }

    if (
      finalInventoryMode === 'multi' &&
      existingInventoryMode !== 'multi' &&
      (!Array.isArray(sanitizedUnits) || sanitizedUnits.length === 0)
    ) {
      collectedErrors.push({ field: 'units', message: 'At least one unit is required' });
    }

    if (collectedErrors.length > 0) {
        console.warn('Admin update cabin validation errors:', collectedErrors, { body: req.body, cabinId: id });
        return res.status(400).json({
          success: false,
        message: 'Validation failed',
        errors: collectedErrors
      });
    }

    const isSwitchingType = existingInventoryMode !== finalInventoryMode;
    if (isSwitchingType) {
      const bookingsExist = await Booking.exists({
        $or: [
          { cabinId: cabin._id },
          ...(cabin.cabinTypeId ? [{ cabinTypeId: cabin.cabinTypeId }] : [])
        ]
      });

      if (bookingsExist) {
          return res.status(400).json({
            success: false,
          message: 'Cabin type cannot be changed because existing bookings reference this property'
        });
      }
    }

    const effectiveBase = {
      name: sanitized.name ?? cabin.name,
      description: sanitized.description ?? cabin.description,
      capacity: sanitized.capacity ?? cabin.capacity,
      pricePerNight: sanitized.pricePerNight ?? cabin.pricePerNight,
      minNights: sanitized.minNights ?? cabin.minNights,
      imageUrl: sanitized.imageUrl ?? cabin.imageUrl,
      amenities: sanitized.amenities ?? cabin.amenities,
      location: sanitized.location ?? cabin.location,
      geoLocation: sanitized.geoLocation ?? cabin.geoLocation,
      hostName: sanitized.hostName ?? cabin.hostName,
      transportOptions: sanitized.transportOptions ?? cabin.transportOptions,
      blockedDates: sanitized.blockedDates ?? cabin.blockedDates,
      meetingPoint: sanitized.meetingPoint ?? cabin.meetingPoint,
      packingList: sanitized.packingList ?? cabin.packingList,
      arrivalGuideUrl: sanitized.arrivalGuideUrl ?? cabin.arrivalGuideUrl,
      safetyNotes: sanitized.safetyNotes ?? cabin.safetyNotes,
      emergencyContact: sanitized.emergencyContact ?? cabin.emergencyContact,
      arrivalWindowDefault: sanitized.arrivalWindowDefault ?? cabin.arrivalWindowDefault,
      transportCutoffs: sanitized.transportCutoffs ?? cabin.transportCutoffs,
      experiences: sanitized.experiences ?? cabin.experiences,
      badges: sanitized.badges ?? cabin.badges,
      multiUnitConfig: sanitizedMultiUnitConfig ?? cabin.multiUnitConfig,
      units: Array.isArray(sanitizedUnits) ? sanitizedUnits : cabin.units
    };

    const prefixValue = finalInventoryMode === 'multi'
      ? (sanitizedMultiUnitConfig?.prefix ?? cabin.multiUnitConfig?.prefix ?? '')
      : '';
    const autoGeneratedCountValue = finalInventoryMode === 'multi'
      ? (sanitizedMultiUnitConfig?.autoGeneratedCount ??
          (Array.isArray(sanitizedUnits) ? sanitizedUnits.length : cabin.multiUnitConfig?.autoGeneratedCount ?? 0))
      : 0;

    if (finalInventoryMode === 'single') {
      if (cabin.cabinTypeId) {
        await Unit.deleteMany({ cabinTypeId: cabin.cabinTypeId });
        await CabinType.deleteOne({ _id: cabin.cabinTypeId });
      }
      cabin.cabinTypeId = null;
      cabin.inventoryType = 'single';
      cabin.inventoryMode = 'single';
      cabin.multiUnitConfig = undefined;
    } else if (finalInventoryMode === 'multi') {
      if (!cabin.cabinTypeId) {
        const slug = await ensureUniqueCabinTypeSlug(effectiveBase.name);
        const cabinTypePayload = {
          ...effectiveBase,
          slug,
          minNights: effectiveBase.minNights ?? 1,
          imageUrl: effectiveBase.imageUrl || DEFAULT_CABIN_IMAGE_URL,
          amenities: effectiveBase.amenities || [],
          transportOptions: effectiveBase.transportOptions || [],
          blockedDates: effectiveBase.blockedDates || [],
          packingList: effectiveBase.packingList || [],
          transportCutoffs: effectiveBase.transportCutoffs || [],
          experiences: effectiveBase.experiences || [],
          badges: effectiveBase.badges || undefined,
          multiUnitConfig: effectiveBase.multiUnitConfig || undefined,
          units: effectiveBase.units || undefined
        };

        const cabinType = await CabinType.create(cabinTypePayload);
        if (Array.isArray(sanitizedUnits) && sanitizedUnits.length) {
          await Unit.insertMany(
            sanitizedUnits.map((unit) => ({
              cabinTypeId: cabinType._id,
              unitNumber: unit.unitNumber,
              displayName: unit.displayName,
              adminNotes: unit.adminNotes,
              isActive: unit.isActive
            }))
          );
        }

        cabin.cabinTypeId = cabinType._id;
        cabin.inventoryType = 'multi';
        cabin.inventoryMode = 'multi';
        cabin.multiUnitConfig = {
          prefix: prefixValue,
          autoGeneratedCount: autoGeneratedCountValue
        };
      } else {
        const cabinType = await CabinType.findById(cabin.cabinTypeId);
        if (cabinType) {
          cabinType.name = effectiveBase.name;
          cabinType.description = effectiveBase.description;
          cabinType.capacity = effectiveBase.capacity;
          cabinType.pricePerNight = effectiveBase.pricePerNight;
          cabinType.minNights = effectiveBase.minNights ?? cabinType.minNights;
          cabinType.imageUrl = effectiveBase.imageUrl || cabinType.imageUrl;
          cabinType.amenities = effectiveBase.amenities || [];
          cabinType.location = effectiveBase.location;
          cabinType.geoLocation = effectiveBase.geoLocation;
          cabinType.hostName = effectiveBase.hostName;
          cabinType.transportOptions = effectiveBase.transportOptions || [];
          cabinType.blockedDates = effectiveBase.blockedDates || [];
          cabinType.meetingPoint = effectiveBase.meetingPoint || undefined;
          cabinType.packingList = effectiveBase.packingList || [];
          cabinType.arrivalGuideUrl = effectiveBase.arrivalGuideUrl || '';
          cabinType.safetyNotes = effectiveBase.safetyNotes || '';
          cabinType.emergencyContact = effectiveBase.emergencyContact || '';
          cabinType.arrivalWindowDefault = effectiveBase.arrivalWindowDefault || '';
          cabinType.transportCutoffs = effectiveBase.transportCutoffs || [];
          cabinType.experiences = effectiveBase.experiences || [];
          cabinType.badges = effectiveBase.badges || undefined;
          cabinType.multiUnitConfig = effectiveBase.multiUnitConfig || undefined;
          cabinType.units = effectiveBase.units || undefined;
          await cabinType.save();
        }

        if (Array.isArray(sanitizedUnits) && unitsProvided && cabin.cabinTypeId) {
          const existingUnits = await Unit.find({ cabinTypeId: cabin.cabinTypeId });
          const existingMap = new Map(existingUnits.map((unit) => [unit._id.toString(), unit]));

          for (const unit of sanitizedUnits) {
            if (unit._id && existingMap.has(unit._id.toString())) {
              const target = existingMap.get(unit._id.toString());
              target.unitNumber = unit.unitNumber;
              target.displayName = unit.displayName;
              target.adminNotes = unit.adminNotes;
              target.isActive = unit.isActive;
              await target.save();
              existingMap.delete(unit._id.toString());
            } else if (!unit._id) {
              await Unit.create({
                cabinTypeId: cabin.cabinTypeId,
                unitNumber: unit.unitNumber,
                displayName: unit.displayName,
                adminNotes: unit.adminNotes,
                isActive: unit.isActive
              });
            }
          }
        }

        cabin.inventoryType = 'multi';
        cabin.inventoryMode = 'multi';
        cabin.multiUnitConfig = {
          prefix: prefixValue,
          autoGeneratedCount: autoGeneratedCountValue
        };
      }
    }

    Object.assign(cabin, sanitized);

    if (!sanitized.imageUrl) {
      sanitized.imageUrl = cabin.imageUrl || DEFAULT_CABIN_IMAGE_URL;
    }

    if (finalInventoryMode === 'single') {
      cabin.inventoryType = 'single';
      cabin.inventoryMode = 'single';
      cabin.multiUnitConfig = undefined;
    }

    await cabin.save();

    const responseCabin = await Cabin.findById(cabin._id).lean();
    let multiUnit = null;
    if (responseCabin.inventoryType === 'multi' && responseCabin.cabinTypeId) {
      const cabinType = await CabinType.findById(responseCabin.cabinTypeId).lean();
      const units = await Unit.find({ cabinTypeId: responseCabin.cabinTypeId }).sort({ unitNumber: 1 }).lean();
      multiUnit = {
        cabinTypeId: cabinType?._id,
        slug: cabinType?.slug,
        isActive: cabinType?.isActive !== false,
        units
      };
    }

    res.json({
      success: true,
      data: { cabin: { ...responseCabin, multiUnit } },
      message: 'Cabin updated successfully'
    });
  } catch (error) {
    console.error('Update cabin error:', error);
    res.status(500).json({
            success: false,
      message: 'Failed to update cabin'
    });
  }
};

const createCabin = async (req, res) => {
  try {
    const allowMulti = featureFlags.isMultiUnitGloballyEnabled();
    const { sanitized, errors } = sanitizeCabinPayload(req.body, { isUpdate: false, allowMulti });

    if (errors.length) {
      console.warn('Admin create cabin validation errors:', errors, { body: req.body });
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    const inventoryMode = sanitized.inventoryMode || 'single';
    delete sanitized.inventoryMode;

    const units = sanitized.units || [];
    delete sanitized.units;

    const multiUnitConfig = sanitized.multiUnitConfig || {};
    delete sanitized.multiUnitConfig;

    if (!sanitized.imageUrl) {
      sanitized.imageUrl = DEFAULT_CABIN_IMAGE_URL;
    }

    if (inventoryMode === 'single') {
      const cabin = await Cabin.create({
        ...sanitized,
        inventoryMode: 'single',
        inventoryType: 'single',
        cabinTypeRef: null,
        multiUnitConfig: undefined
      });

      const responseCabin = await buildCabinResponse(cabin);
      return res.status(201).json({
        success: true,
        message: 'Cabin created successfully',
        data: { cabin: responseCabin }
      });
    }

    const slug = await ensureUniqueCabinTypeSlug(sanitized.name);
    const cabinTypePayload = {
      name: sanitized.name,
      slug,
      description: sanitized.description,
      location: sanitized.location,
      hostName: sanitized.hostName || 'Drift & Dwells',
      capacity: sanitized.capacity,
      pricePerNight: sanitized.pricePerNight,
      minNights: sanitized.minNights ?? 1,
      amenities: sanitized.amenities || [],
      imageUrl: sanitized.imageUrl || DEFAULT_CABIN_IMAGE_URL,
      geoLocation: sanitized.geoLocation,
      transportOptions: sanitized.transportOptions || [],
      meetingPoint: sanitized.meetingPoint || undefined,
      packingList: sanitized.packingList || [],
      arrivalGuideUrl: sanitized.arrivalGuideUrl || '',
      safetyNotes: sanitized.safetyNotes || '',
      emergencyContact: sanitized.emergencyContact || '',
      arrivalWindowDefault: sanitized.arrivalWindowDefault || '',
      transportCutoffs: sanitized.transportCutoffs || [],
      experiences: sanitized.experiences || [],
      badges: sanitized.badges || undefined
    };

    const cabinType = await CabinType.create(cabinTypePayload);

    if (units.length > 0) {
      await Unit.insertMany(
        units.map((unit) => ({
          cabinTypeId: cabinType._id,
          unitNumber: unit.unitNumber,
          displayName: unit.displayName || '',
          adminNotes: unit.adminNotes || '',
          isActive: unit.isActive !== false
        }))
      );
    }

    const cabin = await Cabin.create({
      ...sanitized,
      inventoryMode: 'multi',
      inventoryType: 'multi',
      cabinTypeRef: cabinType._id,
      multiUnitConfig
    });

    const responseCabin = await buildCabinResponse(cabin);

    res.status(201).json({
      success: true,
      message: 'Cabin created successfully',
      data: { cabin: responseCabin }
    });
  } catch (error) {
    console.error('Create cabin error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create cabin'
    });
  }
};

module.exports = {
  login,
  getBookings,
  getBookingById,
  updateBookingStatus,
  getCabins,
  getCabinById,
  createCabin,
  updateCabin
};
