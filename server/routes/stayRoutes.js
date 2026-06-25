const express = require('express');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const featureFlags = require('../utils/featureFlags');
const { normalizeSlug, resolveCabinSlugFromDoc } = require('../utils/staySlug');

const router = express.Router();

/**
 * GET /api/stays/:slug
 * Resolves a public stay slug to either a multi-unit cabin type or a single cabin.
 */
router.get('/:slug', async (req, res) => {
  try {
    const slug = normalizeSlug(req.params.slug);
    if (!slug) {
      return res.status(400).json({ success: false, message: 'Stay slug is required' });
    }

    const cabinType = await CabinType.findOne({ slug, isActive: true });
    if (cabinType && featureFlags.isMultiUnitType(cabinType.slug)) {
      return res.json({
        success: true,
        data: {
          kind: 'cabinType',
          slug: cabinType.slug,
          cabinTypeId: String(cabinType._id)
        }
      });
    }

    let cabin = await Cabin.findOne({ slug, isActive: true });
    if (!cabin) {
      const candidates = await Cabin.find({ isActive: true });
      cabin = candidates.find((doc) => resolveCabinSlugFromDoc(doc) === slug) || null;
    }

    if (!cabin) {
      return res.status(404).json({ success: false, message: 'Stay not found' });
    }

    const resolvedSlug = resolveCabinSlugFromDoc(cabin);
    if (!resolvedSlug) {
      return res.status(404).json({ success: false, message: 'Stay not found' });
    }

    return res.json({
      success: true,
      data: {
        kind: 'cabin',
        slug: resolvedSlug,
        cabinId: String(cabin._id)
      }
    });
  } catch (error) {
    console.error('Resolve stay slug error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error resolving stay',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;
