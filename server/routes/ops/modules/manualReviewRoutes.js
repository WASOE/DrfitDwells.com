const express = require('express');
const ManualReviewItem = require('../../../models/ManualReviewItem');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.category) filters.category = req.query.category;
    if (req.query.severity) filters.severity = req.query.severity;

    const [items, total] = await Promise.all([
      ManualReviewItem.find(filters).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ManualReviewItem.countDocuments(filters)
    ]);

    return res.json({
      success: true,
      data: {
        items: items.map((item) => ({
          manualReviewItemId: String(item._id),
          category: item.category,
          severity: item.severity,
          status: item.status,
          title: item.title,
          details: item.details,
          entityType: item.entityType || null,
          entityId: item.entityId || null,
          provenance: item.provenance || null,
          evidence: item.evidence || {},
          resolution: item.resolution || null,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
