const express = require('express');
const { getCommunicationOversightReadModel } = require('../../../services/ops/readModels/reviewsCommsReadModel');
const { sendArrivalInstructions } = require('../../../services/ops/domain/communicationWriteService');

const router = express.Router();

function handleDomainError(res, error) {
  if (error.code === 'PERMISSION_DENIED') {
    return res.status(error.status || 403).json({ success: false, errorType: 'permission', message: error.message });
  }
  if (error.code === 'AUDIT_WRITE_FAILED') {
    return res.status(500).json({ success: false, errorType: 'audit_failure', message: 'Action blocked because audit write failed' });
  }
  if (error.type) {
    const status = error.status || (error.type === 'dependency_failure' ? 502 : error.type === 'invalid_transition' ? 409 : 400);
    return res.status(status).json({ success: false, errorType: error.type, message: error.message, details: error.details || null });
  }
  return res.status(500).json({ success: false, errorType: 'dependency_failure', message: error.message });
}

router.get('/oversight', async (req, res) => {
  try {
    const data = await getCommunicationOversightReadModel();
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/reservations/:id/actions/send-arrival-instructions', async (req, res) => {
  try {
    const data = await sendArrivalInstructions({
      bookingId: req.params.id,
      kind: 'send',
      ctx: { req, user: req.user, route: 'POST /api/ops/communications/reservations/:id/actions/send-arrival-instructions' }
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

router.post('/reservations/:id/actions/resend-arrival-instructions', async (req, res) => {
  try {
    const data = await sendArrivalInstructions({
      bookingId: req.params.id,
      kind: 'resend',
      ctx: { req, user: req.user, route: 'POST /api/ops/communications/reservations/:id/actions/resend-arrival-instructions' }
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

router.post('/reservations/:id/actions/mark-arrival-completed', async (req, res) => {
  try {
    const data = await sendArrivalInstructions({
      bookingId: req.params.id,
      kind: 'complete',
      ctx: { req, user: req.user, route: 'POST /api/ops/communications/reservations/:id/actions/mark-arrival-completed' }
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

module.exports = router;
