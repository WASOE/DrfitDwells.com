const express = require('express');
const { getCalendarReadModel } = require('../../../services/ops/readModels/calendarReadModel');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { from, to, cabinId, indexPreview, previewDays } = req.query;
    const isIndex = indexPreview === '1' || indexPreview === 'true';
    if (!isIndex && (!from || !to)) {
      return res.status(400).json({ success: false, message: 'from and to are required (unless indexPreview=1)' });
    }
    const data = await getCalendarReadModel({
      from: from || null,
      to: to || null,
      cabinId: cabinId || null,
      indexPreview: isIndex,
      previewDays: previewDays ? parseInt(previewDays, 10) : 14
    });
    return res.json({ success: true, data });
  } catch (error) {
    if (error && error.code === 'CALENDAR_RANGE_TOO_LARGE') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
