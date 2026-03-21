const express = require('express');
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

router.get('/:id', async (req, res) => {
  try {
    const data = await getCabinDetailReadModel(req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Cabin not found' });
    }
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
