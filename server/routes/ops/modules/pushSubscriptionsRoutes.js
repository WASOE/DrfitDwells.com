const express = require('express');
const { body, validationResult } = require('express-validator');
const { validateId } = require('../../../middleware/validateId');
const {
  requireSessionOpsUserId,
  registerPushSubscription,
  deletePushSubscriptionForUser
} = require('../../../services/ops/push/opsPushSubscriptionService');

const router = express.Router();

function handleRouteError(err, res) {
  if (err?.code === 'VALIDATION') {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }
  if (err?.code === 'OPS_USER_ID_REQUIRED') {
    return res.status(err.status || 403).json({ success: false, message: err.message });
  }
  if (err?.code === 'NOT_FOUND') {
    return res.status(404).json({ success: false, message: err.message });
  }
  if (err?.code === 'SUBSCRIPTION_OWNERSHIP_CONFLICT') {
    return res.status(409).json({ success: false, message: err.message });
  }
  console.error('OPS push subscription route error:', err);
  return res.status(500).json({ success: false, message: err.message || 'Internal server error' });
}

// POST /api/ops/push-subscriptions — any authenticated OPS user (adminAuth + module exempt).
router.post(
  '/',
  [
    body('endpoint').isString().trim().notEmpty().withMessage('endpoint is required'),
    body('keys').isObject().withMessage('keys object is required'),
    body('keys.p256dh').isString().trim().notEmpty().withMessage('keys.p256dh is required'),
    body('keys.auth').isString().trim().notEmpty().withMessage('keys.auth is required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    try {
      const opsUserId = requireSessionOpsUserId(req.user);
      const subscription = await registerPushSubscription({
        opsUserId,
        body: req.body,
        userAgent: req.headers['user-agent']
      });
      return res.status(201).json({
        success: true,
        data: {
          id: String(subscription._id),
          opsUserId: String(subscription.opsUserId),
          endpoint: subscription.endpoint,
          createdAt: subscription.createdAt,
          lastSuccessAt: subscription.lastSuccessAt,
          invalidatedAt: subscription.invalidatedAt
        }
      });
    } catch (err) {
      return handleRouteError(err, res);
    }
  }
);

// DELETE /api/ops/push-subscriptions/:id — scoped to session opsUserId only.
router.delete('/:id', validateId('id'), async (req, res) => {
  try {
    const opsUserId = requireSessionOpsUserId(req.user);
    await deletePushSubscriptionForUser({
      subscriptionId: req.params.id,
      opsUserId
    });
    return res.json({ success: true });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

module.exports = router;
