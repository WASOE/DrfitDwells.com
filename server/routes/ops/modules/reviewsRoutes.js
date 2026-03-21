const express = require('express');
const { getReviewsReadModel } = require('../../../services/ops/readModels/reviewsCommsReadModel');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const data = await getReviewsReadModel(req.query);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
