'use strict';

const express = require('express');
const { requireSessionOpsUserId } = require('../../../services/ops/push/opsPushSubscriptionService');
const {
  getBookingConfirmationDeliveryHealthReadModel
} = require('../../../services/email/bookingConfirmationDeliveryHealthService');

const router = express.Router();

function requireAdminRole(user) {
  if (user?.role !== 'admin') {
    const err = new Error('Admin access required');
    err.code = 'ADMIN_REQUIRED';
    err.status = 403;
    throw err;
  }
}

function handleRouteError(err, res) {
  if (err?.code === 'OPS_USER_ID_REQUIRED') {
    return res.status(err.status || 403).json({ success: false, message: err.message });
  }
  if (err?.code === 'ADMIN_REQUIRED') {
    return res.status(err.status || 403).json({
      success: false,
      errorType: 'forbidden',
      message: err.message
    });
  }
  console.error('OPS confirmation delivery health route error:', err);
  return res.status(500).json({ success: false, message: err.message || 'Internal server error' });
}

// GET /api/ops/confirmation-delivery-health
router.get('/', async (req, res) => {
  try {
    requireAdminRole(req.user);
    requireSessionOpsUserId(req.user);
    const data = await getBookingConfirmationDeliveryHealthReadModel();
    return res.json({ success: true, data });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

module.exports = router;
