const express = require('express');
const { body, validationResult } = require('express-validator');
const ManualReviewItem = require('../../../models/ManualReviewItem');
const { validateId } = require('../../../middleware/validateId');
const { requirePermission, ACTIONS } = require('../../../services/permissionService');
const {
  resolveManualReviewItem,
  mapManualReviewItemResponse,
  MIN_MANUAL_REVIEW_RESOLUTION_NOTE_LENGTH,
  MAX_MANUAL_REVIEW_RESOLUTION_NOTE_LENGTH
} = require('../../../services/ops/ingestion/manualReviewService');

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
        items: items.map((item) => mapManualReviewItemResponse(item)),
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

router.post(
  '/:id/resolve',
  validateId('id'),
  [
    body('note')
      .isString()
      .trim()
      .isLength({
        min: MIN_MANUAL_REVIEW_RESOLUTION_NOTE_LENGTH,
        max: MAX_MANUAL_REVIEW_RESOLUTION_NOTE_LENGTH
      })
      .withMessage(
        `note must be ${MIN_MANUAL_REVIEW_RESOLUTION_NOTE_LENGTH}-${MAX_MANUAL_REVIEW_RESOLUTION_NOTE_LENGTH} characters`
      )
  ],
  async (req, res) => {
    try {
      requirePermission({
        role: req.user?.role,
        modules: req.user?.modules,
        action: ACTIONS.OPS_MANUAL_REVIEW_RESOLVE
      });

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: errors.array()[0]?.msg || 'Invalid resolution note',
          errors: errors.array()
        });
      }

      const result = await resolveManualReviewItem({
        manualReviewItemId: req.params.id,
        resolvedBy: req.user?.id || req.user?.role || 'ops_user',
        note: req.body.note
      });

      if (result.status === 'already_resolved') {
        return res.status(409).json({
          success: false,
          errorType: 'already_resolved',
          message: 'Manual review item is already resolved',
          data: { item: result.item }
        });
      }

      return res.json({
        success: true,
        data: {
          status: result.status,
          item: result.item
        }
      });
    } catch (error) {
      if (error.code === 'PERMISSION_DENIED') {
        return res.status(error.status || 403).json({ success: false, message: error.message });
      }
      if (error.code === 'INVALID_MANUAL_REVIEW_ID' || error.code === 'INVALID_RESOLUTION_NOTE') {
        return res.status(error.status || 400).json({
          success: false,
          errorType: error.code,
          message: error.message
        });
      }
      if (error.code === 'MANUAL_REVIEW_NOT_FOUND') {
        return res.status(404).json({ success: false, message: error.message });
      }
      if (error.code === 'MANUAL_REVIEW_NOT_OPEN') {
        return res.status(409).json({
          success: false,
          errorType: error.code,
          message: error.message
        });
      }
      return res.status(500).json({ success: false, message: error.message });
    }
  }
);

module.exports = router;
