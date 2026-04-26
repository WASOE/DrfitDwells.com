const express = require('express');
const { body, validationResult } = require('express-validator');
const { validateId } = require('../../../middleware/validateId');
const {
  getReservationsWorkspaceReadModel,
  getReservationsExportRows,
  validateStayScope
} = require('../../../services/ops/readModels/reservationsReadModel');
const { getReservationDetailReadModel } = require('../../../services/ops/readModels/reservationDetailReadModel');
const {
  transitionReservation,
  reassignReservation,
  editReservationDates,
  addReservationNote,
  createManualReservation
} = require('../../../services/ops/domain/reservationWriteService');
const { editGuestContact } = require('../../../services/ops/domain/guestWriteService');
const {
  previewBookingLifecycleEmail,
  resendBookingLifecycleEmail,
  listBookingEmailEvents
} = require('../../../controllers/shared/bookingLifecycleEmailController');

const router = express.Router();

function validateLifecycleEmailBody(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
}

function handleDomainError(res, error) {
  if (error.code === 'PERMISSION_DENIED') {
    return res.status(error.status || 403).json({ success: false, errorType: 'permission', message: error.message, details: error.permission || null });
  }
  if (error.code === 'AUDIT_WRITE_FAILED') {
    return res.status(500).json({ success: false, errorType: 'audit_failure', message: 'Action blocked because audit write failed' });
  }
  const map = {
    invalid_transition: 409,
    validation: 400,
    conflict: 409,
    dependency_failure: 502
  };
  if (error.type && map[error.type]) {
    return res.status(error.status || map[error.type]).json({
      success: false,
      errorType: error.type,
      message: error.message,
      details: error.details || null
    });
  }
  return res.status(500).json({ success: false, errorType: 'dependency_failure', message: error.message });
}

router.get('/', async (req, res) => {
  try {
    const stayScopeError = validateStayScope(req.query.stayScope);
    if (stayScopeError) {
      return res.status(400).json({ success: false, errorType: 'validation', message: stayScopeError });
    }
    const data = await getReservationsWorkspaceReadModel(req.query);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/export', async (req, res) => {
  try {
    const stayScopeError = validateStayScope(req.query.stayScope);
    if (stayScopeError) {
      return res.status(400).json({ success: false, errorType: 'validation', message: stayScopeError });
    }
    const { page, limit, ...exportQuery } = req.query;
    const rows = await getReservationsExportRows(exportQuery);
    return res.json({ success: true, data: { rows, total: rows.length } });
  } catch (error) {
    if (error.type === 'export_too_large') {
      return res.status(error.status || 413).json({
        success: false,
        errorType: 'export_too_large',
        message: error.message,
        details: error.details || null
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/manual', async (req, res) => {
  try {
    const data = await createManualReservation({
      cabinId: req.body?.cabinId,
      checkInDate: req.body?.checkIn ?? req.body?.checkInDate,
      checkOutDate: req.body?.checkOut ?? req.body?.checkOutDate,
      adults: req.body?.adults,
      children: req.body?.children,
      guestInfo: req.body?.guestInfo,
      initialStatus: req.body?.initialStatus || 'pending',
      note: req.body?.note,
      acceptExternalHoldWarnings: Boolean(req.body?.acceptExternalHoldWarnings),
      paymentPlaceholderNote: req.body?.paymentPlaceholderNote,
      reason: req.body?.reason || null,
      ctx: { req, user: req.user, route: 'POST /api/ops/reservations/manual' }
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

router.post(
  '/:id/email-actions/preview',
  validateId('id'),
  [
    body('templateKey')
      .isIn(['booking_received', 'booking_confirmed', 'booking_cancelled'])
      .withMessage('templateKey must be booking_received, booking_confirmed, or booking_cancelled')
  ],
  validateLifecycleEmailBody,
  previewBookingLifecycleEmail
);

router.post(
  '/:id/email-actions/resend',
  validateId('id'),
  [
    body('templateKey')
      .isIn(['booking_received', 'booking_confirmed', 'booking_cancelled'])
      .withMessage('templateKey must be booking_received, booking_confirmed, or booking_cancelled'),
    body('overrideRecipient').optional({ checkFalsy: true }).isEmail().withMessage('overrideRecipient must be a valid email')
  ],
  validateLifecycleEmailBody,
  resendBookingLifecycleEmail
);

router.get('/:id/email-events', validateId('id'), listBookingEmailEvents);

router.get('/:id', async (req, res) => {
  try {
    const data = await getReservationDetailReadModel(req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Reservation not found' });
    }
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/:id/actions/confirm', async (req, res) => {
  try {
    const data = await transitionReservation({
      bookingId: req.params.id,
      kind: 'confirm',
      ctx: { req, user: req.user, route: 'POST /api/ops/reservations/:id/actions/confirm' }
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

router.post('/:id/actions/check-in', async (req, res) => {
  try {
    const data = await transitionReservation({
      bookingId: req.params.id,
      kind: 'checkIn',
      ctx: { req, user: req.user, route: 'POST /api/ops/reservations/:id/actions/check-in' }
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

router.post('/:id/actions/complete', async (req, res) => {
  try {
    const data = await transitionReservation({
      bookingId: req.params.id,
      kind: 'complete',
      ctx: { req, user: req.user, route: 'POST /api/ops/reservations/:id/actions/complete' }
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

router.post('/:id/actions/cancel', async (req, res) => {
  try {
    const data = await transitionReservation({
      bookingId: req.params.id,
      kind: 'cancel',
      reason: req.body?.reason || null,
      ctx: { req, user: req.user, route: 'POST /api/ops/reservations/:id/actions/cancel' }
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

router.post('/:id/actions/reassign', async (req, res) => {
  try {
    const data = await reassignReservation({
      bookingId: req.params.id,
      toCabinId: req.body?.toCabinId,
      acceptExternalHoldWarnings: Boolean(req.body?.acceptExternalHoldWarnings),
      reason: req.body?.reason || null,
      ctx: { req, user: req.user, route: 'POST /api/ops/reservations/:id/actions/reassign' }
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

router.post('/:id/actions/edit-dates', async (req, res) => {
  try {
    const data = await editReservationDates({
      bookingId: req.params.id,
      checkInDate: req.body?.checkInDate,
      checkOutDate: req.body?.checkOutDate,
      reason: req.body?.reason || null,
      ctx: { req, user: req.user, route: 'POST /api/ops/reservations/:id/actions/edit-dates' }
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

router.post('/:id/actions/edit-guest-contact', async (req, res) => {
  try {
    const data = await editGuestContact({
      bookingId: req.params.id,
      firstName: req.body?.firstName,
      lastName: req.body?.lastName,
      email: req.body?.email,
      phone: req.body?.phone,
      ctx: { req, user: req.user, route: 'POST /api/ops/reservations/:id/actions/edit-guest-contact' }
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

router.post('/:id/actions/add-note', async (req, res) => {
  try {
    const data = await addReservationNote({
      bookingId: req.params.id,
      content: req.body?.content,
      metadata: req.body?.metadata || {},
      ctx: { req, user: req.user, route: 'POST /api/ops/reservations/:id/actions/add-note' }
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleDomainError(res, error);
  }
});

module.exports = router;
