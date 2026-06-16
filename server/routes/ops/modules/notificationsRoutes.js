const express = require('express');
const { validateId } = require('../../../middleware/validateId');
const { requireSessionOpsUserId } = require('../../../services/ops/push/opsPushSubscriptionService');
const {
  listNotificationsForUser,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead
} = require('../../../services/ops/push/opsNotificationInboxService');
const { sendOpsPushTestNotification } = require('../../../services/ops/push/opsPushTestNotificationService');

const router = express.Router();

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
  if (err?.code === 'NOT_FOUND') {
    return res.status(404).json({ success: false, message: err.message });
  }
  console.error('OPS notifications route error:', err);
  return res.status(500).json({ success: false, message: err.message || 'Internal server error' });
}

function requireAdminRole(user) {
  if (user?.role !== 'admin') {
    const err = new Error('Admin access required');
    err.code = 'ADMIN_REQUIRED';
    err.status = 403;
    throw err;
  }
}

function parseUnreadOnly(value) {
  if (value == null || value === '') {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

// GET /api/ops/notifications/unread-count — own-user only.
router.get('/unread-count', async (req, res) => {
  try {
    const opsUserId = requireSessionOpsUserId(req.user);
    const data = await getUnreadNotificationCount({ opsUserId });
    return res.json({ success: true, data });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// GET /api/ops/notifications — own-user list with pagination.
router.get('/', async (req, res) => {
  try {
    const opsUserId = requireSessionOpsUserId(req.user);
    const data = await listNotificationsForUser({
      opsUserId,
      limit: req.query.limit,
      cursor: req.query.cursor,
      unreadOnly: parseUnreadOnly(req.query.unreadOnly)
    });
    return res.json({ success: true, data });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// POST /api/ops/notifications/test — admin self-test push + inbox row.
router.post('/test', async (req, res) => {
  try {
    requireAdminRole(req.user);
    const opsUserId = requireSessionOpsUserId(req.user);
    const result = await sendOpsPushTestNotification({ opsUserId });

    if (result.error) {
      return res.status(500).json({
        success: false,
        message: 'Could not send test notification'
      });
    }

    if (result.rateLimited) {
      return res.status(429).json({
        success: false,
        errorType: 'rate_limited',
        message: 'Test notification already sent this minute. Try again shortly.',
        data: {
          notificationsCreated: result.notificationsCreated,
          notificationsDeduped: result.notificationsDeduped,
          pushAttempts: result.pushAttempts,
          pushAccepted: result.pushAccepted,
          pushFailed: result.pushFailed,
          skipped: result.skipped,
          reason: result.reason
        }
      });
    }

    return res.json({
      success: true,
      data: {
        notificationsCreated: result.notificationsCreated,
        notificationsDeduped: result.notificationsDeduped,
        pushAttempts: result.pushAttempts,
        pushAccepted: result.pushAccepted,
        pushFailed: result.pushFailed,
        skipped: result.skipped,
        reason: result.reason
      }
    });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// POST /api/ops/notifications/read-all — own-user only.
router.post('/read-all', async (req, res) => {
  try {
    const opsUserId = requireSessionOpsUserId(req.user);
    const data = await markAllNotificationsRead({ opsUserId });
    return res.json({ success: true, data });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// PATCH /api/ops/notifications/:id/read — own-user only.
router.patch('/:id/read', validateId('id'), async (req, res) => {
  try {
    const opsUserId = requireSessionOpsUserId(req.user);
    const notification = await markNotificationRead({
      opsUserId,
      notificationId: req.params.id
    });
    return res.json({
      success: true,
      data: { notification }
    });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

module.exports = router;
