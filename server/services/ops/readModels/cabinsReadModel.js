const Cabin = require('../../../models/Cabin');

async function getCabinsListReadModel({ page = 1, limit = 20, search = '' }) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (safePage - 1) * safeLimit;
  const filter = {};
  if (search) {
    filter.$or = [
      { name: { $regex: String(search), $options: 'i' } },
      { location: { $regex: String(search), $options: 'i' } }
    ];
  }

  const [items, total] = await Promise.all([
    Cabin.find(filter).sort({ name: 1 }).skip(skip).limit(safeLimit).lean(),
    Cabin.countDocuments(filter)
  ]);

  return {
    items: items.map((cabin) => ({
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
    })),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit)
    }
  };
}

async function getCabinDetailReadModel(cabinId) {
  const cabin = await Cabin.findById(cabinId).lean();
  if (!cabin) return null;

  return {
    cabinId: String(cabin._id),
    operationalSettings: {
      capacity: cabin.capacity,
      minNights: cabin.minNights,
      pricePerNight: cabin.pricePerNight,
      blockedDates: cabin.blockedDates || [],
      transportOptions: cabin.transportOptions || [],
      meetingPoint: cabin.meetingPoint || null
    },
    contentMedia: {
      name: cabin.name,
      description: cabin.description,
      location: cabin.location,
      imageUrl: cabin.imageUrl || null,
      images: cabin.images || [],
      badges: cabin.badges || null,
      highlights: cabin.highlights || []
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

module.exports = {
  getCabinsListReadModel,
  getCabinDetailReadModel
};
