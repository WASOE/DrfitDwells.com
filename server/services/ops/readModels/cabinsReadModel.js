const mongoose = require('mongoose');
const Cabin = require('../../../models/Cabin');
const CabinType = require('../../../models/CabinType');
const Unit = require('../../../models/Unit');
const { escapeRegex } = require('../../../utils/escapeRegex');
const { FIXTURE_CABIN_NAME_PATTERN, isFixtureCabinName } = require('../../../utils/fixtureExclusion');
const { buildAbsoluteUnitIcsUrl, buildPublicUnitIcsPath } = require('../../../config/publicCalendarSiteUrl');

function mapSingleCabinListItem(cabin) {
  return {
    kind: 'single_cabin',
    cabinId: String(cabin._id),
    name: cabin.name,
    location: cabin.location,
    isActive: cabin.isActive !== false,
    operational: {
      capacity: cabin.capacity,
      minNights: cabin.minNights,
      transportOptionsCount: Array.isArray(cabin.transportOptions) ? cabin.transportOptions.length : 0,
      blockedDatesCount: Array.isArray(cabin.blockedDates) ? cabin.blockedDates.length : 0
    },
    content: {
      imageUrl: cabin.imageUrl || null,
      imagesCount: Array.isArray(cabin.images) ? cabin.images.length : 0,
      descriptionPresent: Boolean(cabin.description)
    }
  };
}

async function buildMultiUnitListItems(cabinTypes) {
  if (cabinTypes.length === 0) return [];

  const typeIds = cabinTypes.map((ct) => ct._id);
  const units = await Unit.find({ cabinTypeId: { $in: typeIds } }).lean();
  const byType = new Map();
  for (const u of units) {
    const key = String(u.cabinTypeId);
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key).push(u);
  }

  return cabinTypes.map((ct) => {
    const list = byType.get(String(ct._id)) || [];
    const totalUnits = list.length;
    const activeUnits = list.filter((u) => u.isActive !== false).length;
    const blockedUnitsCount = list.filter((u) => Array.isArray(u.blockedDates) && u.blockedDates.length > 0).length;

    return {
      kind: 'multi_unit_type',
      cabinTypeId: String(ct._id),
      name: ct.name,
      slug: ct.slug,
      location: ct.location,
      isActive: ct.isActive !== false,
      operational: {
        capacity: ct.capacity,
        minNights: ct.minNights,
        pricePerNight: ct.pricePerNight,
        totalUnits,
        activeUnits,
        blockedUnitsCount,
        transportOptionsCount: Array.isArray(ct.transportOptions) ? ct.transportOptions.length : 0
      },
      content: {
        imageUrl: ct.imageUrl || null,
        imagesCount: Array.isArray(ct.images) ? ct.images.length : 0,
        descriptionPresent: Boolean(ct.description)
      },
      degraded: {
        emptyInventory: totalUnits === 0
      }
    };
  });
}

/**
 * Unified cabins workspace: single Cabin docs + CabinTypes that have at least one Unit (source truth).
 */
async function getCabinsListReadModel({ page = 1, limit = 20, search = '' }) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (safePage - 1) * safeLimit;

  const archivedClause = { $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }] };
  const fixtureExclusion = { name: { $not: FIXTURE_CABIN_NAME_PATTERN } };
  const cabinFilter = { $and: [fixtureExclusion, archivedClause] };
  const typeFilter = { isActive: true };

  if (search) {
    const q = escapeRegex(String(search));
    cabinFilter.$and = [
      fixtureExclusion,
      archivedClause,
      {
        $or: [
          { name: { $regex: q, $options: 'i' } },
          { location: { $regex: q, $options: 'i' } }
        ]
      }
    ];
    typeFilter.$and = [
      { isActive: true },
      {
        $or: [
          { name: { $regex: q, $options: 'i' } },
          { slug: { $regex: q, $options: 'i' } },
          { location: { $regex: q, $options: 'i' } }
        ]
      }
    ];
    delete typeFilter.isActive;
  }

  const [cabins, allMatchingTypes, distinctTypeIds] = await Promise.all([
    Cabin.find(cabinFilter).sort({ name: 1 }).lean(),
    CabinType.find(typeFilter).sort({ name: 1 }).lean(),
    Unit.distinct('cabinTypeId')
  ]);

  const hasUnits = new Set(distinctTypeIds.map((id) => String(id)));
  const cabinTypesWithInventory = allMatchingTypes.filter((ct) => hasUnits.has(String(ct._id)));

  const singleItems = cabins.map(mapSingleCabinListItem);
  const multiItems = await buildMultiUnitListItems(cabinTypesWithInventory);

  const merged = [...singleItems, ...multiItems].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
  );

  const total = merged.length;
  const items = merged.slice(skip, skip + safeLimit);

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit))
    }
  };
}

async function getCabinDetailReadModel(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;

  const cabin = await Cabin.findById(id).lean();
  if (cabin && isFixtureCabinName(cabin.name)) {
    return null;
  }
  if (cabin && cabin.archivedAt) {
    return null;
  }
  if (cabin) {
    const blockedDates = cabin.blockedDates || [];
    return {
      kind: 'single_cabin',
      cabinId: String(cabin._id),
      operationalSettings: {
        capacity: cabin.capacity,
        minNights: cabin.minNights,
        pricePerNight: cabin.pricePerNight,
        blockedDates,
        transportOptions: cabin.transportOptions || [],
        meetingPoint: cabin.meetingPoint || null,
        transportCutoffs: cabin.transportCutoffs || [],
        pricingModel: cabin.pricingModel || 'per_night',
        minGuests: cabin.minGuests != null ? cabin.minGuests : 1,
        blockedDatesCount: Array.isArray(blockedDates) ? blockedDates.length : 0
      },
      contentMedia: {
        name: cabin.name,
        description: cabin.description,
        location: cabin.location,
        imageUrl: cabin.imageUrl || null,
        images: cabin.images || [],
        badges: cabin.badges || null,
        highlights: cabin.highlights || [],
        geoLocation: cabin.geoLocation || null,
        experiences: cabin.experiences || [],
        hostName: cabin.hostName || null
      },
      preArrival: {
        packingList: cabin.packingList || [],
        arrivalGuideUrl: cabin.arrivalGuideUrl || null,
        safetyNotes: cabin.safetyNotes || null,
        emergencyContact: cabin.emergencyContact || null,
        arrivalWindowDefault: cabin.arrivalWindowDefault || null
      },
      degraded: {
        missingGeo: !cabin.geoLocation?.latitude || !cabin.geoLocation?.longitude
      }
    };
  }

  const cabinType = await CabinType.findById(id).lean();
  if (!cabinType) return null;

  const units = await Unit.find({ cabinTypeId: cabinType._id }).sort({ unitNumber: 1 }).lean();

  let totalUnitBlockedDateEntries = 0;
  let unitsWithBlockedDates = 0;
  for (const u of units) {
    const n = Array.isArray(u.blockedDates) ? u.blockedDates.length : 0;
    if (n > 0) unitsWithBlockedDates += 1;
    totalUnitBlockedDateEntries += n;
  }

  return {
    kind: 'multi_unit_type',
    cabinTypeId: String(cabinType._id),
    slug: cabinType.slug,
    operationalSettings: {
      capacity: cabinType.capacity,
      minNights: cabinType.minNights,
      pricePerNight: cabinType.pricePerNight,
      pricingModel: cabinType.pricingModel || 'per_night',
      transportOptions: cabinType.transportOptions || [],
      meetingPoint: cabinType.meetingPoint || null,
      transportCutoffs: cabinType.transportCutoffs || [],
      minGuests: cabinType.minGuests != null ? cabinType.minGuests : 1,
      unitBlockedDatesSummary: {
        totalBlockedDateEntries: totalUnitBlockedDateEntries,
        unitsWithBlockedDates
      }
    },
    contentMedia: {
      name: cabinType.name,
      description: cabinType.description,
      location: cabinType.location,
      imageUrl: cabinType.imageUrl || null,
      images: cabinType.images || [],
      badges: cabinType.badges || null,
      highlights: cabinType.highlights || [],
      experiences: cabinType.experiences || [],
      geoLocation: cabinType.geoLocation || null,
      hostName: cabinType.hostName || null
    },
    preArrival: {
      packingList: cabinType.packingList || [],
      arrivalGuideUrl: cabinType.arrivalGuideUrl || null,
      safetyNotes: cabinType.safetyNotes || null,
      emergencyContact: cabinType.emergencyContact || null,
      arrivalWindowDefault: cabinType.arrivalWindowDefault || null
    },
    units: units.map((u) => {
      const unitId = String(u._id);
      const icsExportPath = buildPublicUnitIcsPath(unitId);
      return {
        unitId,
        unitNumber: u.unitNumber,
        displayName: u.displayName || null,
        isActive: u.isActive !== false,
        blockedDatesCount: Array.isArray(u.blockedDates) ? u.blockedDates.length : 0,
        airbnbListingLabel: u.airbnbListingLabel ? String(u.airbnbListingLabel).trim() || null : null,
        icsExportPath,
        icsExportUrl: u.isActive !== false ? buildAbsoluteUnitIcsUrl(unitId) : null
      };
    }),
    degraded: {
      missingGeo: !cabinType.geoLocation?.latitude || !cabinType.geoLocation?.longitude,
      emptyInventory: units.length === 0
    }
  };
}

module.exports = {
  getCabinsListReadModel,
  getCabinDetailReadModel
};
