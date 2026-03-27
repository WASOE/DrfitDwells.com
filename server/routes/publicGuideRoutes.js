const express = require('express');
const CabinType = require('../models/CabinType');

const router = express.Router();

const mapValleyStayGuidePayload = (doc) => {
  if (!doc) return null;
  return {
    model: 'valleyStayType',
    staySlug: doc.slug,
    propertyName: doc.name,
    imageUrl: doc.imageUrl || '',
    location: doc.location || '',
    meetingPoint: {
      label: doc.meetingPoint?.label || '',
      googleMapsUrl: doc.meetingPoint?.googleMapsUrl || '',
      lat: doc.meetingPoint?.lat ?? null,
      lng: doc.meetingPoint?.lng ?? null
    },
    packingList: Array.isArray(doc.packingList) ? doc.packingList.filter(Boolean).slice(0, 12) : [],
    safetyNotes: doc.safetyNotes || '',
    emergencyContact: doc.emergencyContact || '',
    arrivalWindowDefault: doc.arrivalWindowDefault || '',
    arrivalGuideUrl: doc.arrivalGuideUrl || ''
  };
};

const fetchValleyStayGuideBySlug = async (staySlug) => {
  const cabinType = await CabinType.findOne({ slug: staySlug, isActive: true })
    .select('slug name imageUrl location meetingPoint packingList safetyNotes emergencyContact arrivalWindowDefault arrivalGuideUrl');
  if (!cabinType) return null;
  return mapValleyStayGuidePayload(cabinType);
};

// Public-safe payload for Valley stay-specific arrival guide content.
router.get('/guides/the-valley/stays/:staySlug', async (req, res) => {
  try {
    const guide = await fetchValleyStayGuideBySlug(req.params.staySlug);
    if (!guide) {
      return res.status(404).json({ success: false, message: 'Guide not found' });
    }

    return res.json({
      success: true,
      data: {
        guide
      }
    });
  } catch (error) {
    console.error('Public guide payload error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving public guide'
    });
  }
});

// Backward compatibility for previous endpoint semantics.
router.get('/guides/cabin-types/:slug', async (req, res) => {
  try {
    const guide = await fetchValleyStayGuideBySlug(req.params.slug);
    if (!guide) {
      return res.status(404).json({ success: false, message: 'Guide not found' });
    }
    return res.json({ success: true, data: { guide } });
  } catch (error) {
    console.error('Public guide payload error:', error);
    return res.status(500).json({ success: false, message: 'Error retrieving public guide' });
  }
});

module.exports = router;
