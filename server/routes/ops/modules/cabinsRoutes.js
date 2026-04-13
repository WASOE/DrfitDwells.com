const express = require('express');
const mongoose = require('mongoose');
const Unit = require('../../../models/Unit');
const { getCabinsListReadModel, getCabinDetailReadModel } = require('../../../services/ops/readModels/cabinsReadModel');

const router = express.Router();

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
