const express = require('express');
const Cabin = require('../models/Cabin');
const { validateId } = require('../middleware/validateId');
const { guestFacingCabinMatch } = require('../utils/fixtureExclusion');
const { localizeCabinContent } = require('../utils/cabinLocalization');
const { normalizeSlug, resolveCabinSlugFromDoc } = require('../utils/staySlug');

const router = express.Router();

router.get('/by-slug/:slug', async (req, res) => {
  try {
    const slug = normalizeSlug(req.params.slug);
    if (!slug) {
      return res.status(400).json({ success: false, message: 'Cabin slug is required' });
    }

    let cabin = await Cabin.findOne({ slug, isActive: true });
    if (!cabin) {
      const candidates = await Cabin.find({ isActive: true });
      cabin = candidates.find((doc) => resolveCabinSlugFromDoc(doc) === slug) || null;
    }

    if (!cabin) {
      return res.status(404).json({ success: false, message: 'Cabin not found' });
    }

    const localized = localizeCabinContent(cabin, req.query.locale);
    const resolvedSlug = resolveCabinSlugFromDoc(cabin);
    if (resolvedSlug && !localized.slug) {
      localized.slug = resolvedSlug;
    }

    return res.json({
      success: true,
      data: { cabin: localized }
    });
  } catch (error) {
    console.error('Get cabin by slug error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving cabin details',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

router.get('/:id', validateId('id'), async (req, res) => {
  try {
    const cabin = await Cabin.findById(req.params.id);

    if (!cabin || !cabin.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Cabin not found'
      });
    }

    const localized = localizeCabinContent(cabin, req.query.locale);
    const resolvedSlug = resolveCabinSlugFromDoc(cabin);
    if (resolvedSlug && !localized.slug) {
      localized.slug = resolvedSlug;
    }

    res.json({
      success: true,
      data: { cabin: localized }
    });

  } catch (error) {
    console.error('Get cabin error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving cabin details',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

router.get('/', async (req, res) => {
  try {
    const cabins = await Cabin.find(guestFacingCabinMatch()).select('-blockedDates');

    res.json({
      success: true,
      data: {
        cabins: cabins.map((cabin) => {
          const localized = localizeCabinContent(cabin, req.query.locale);
          const resolvedSlug = resolveCabinSlugFromDoc(cabin);
          if (resolvedSlug && !localized.slug) {
            localized.slug = resolvedSlug;
          }
          return localized;
        })
      }
    });

  } catch (error) {
    console.error('Get cabins error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving cabins',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;
