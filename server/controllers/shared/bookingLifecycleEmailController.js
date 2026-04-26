const Booking = require('../../models/Booking');
const EmailEvent = require('../../models/EmailEvent');
const bookingLifecycleEmailService = require('../../services/bookingLifecycleEmailService');
const { requirePermission, ACTIONS } = require('../../services/permissionService');
const { assertAdminModuleWriteAllowed } = require('../../services/ops/cutover/opsCutoverService');
const {
  MAX_MANUAL_RESEND_SUBJECT_LENGTH,
  MAX_MANUAL_RESEND_HTML_LENGTH
} = require('../../utils/manualLifecycleResendContent');

const BOOKING_EMAIL_POPULATE_FIELDS =
  'name description imageUrl location meetingPoint packingList arrivalGuideUrl safetyNotes emergencyContact arrivalWindowDefault transportCutoffs';

function parseManualResendEditedContent(body) {
  const raw = body?.editedContent;
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    const err = new Error('editedContent must be an object with subject and html strings');
    err.code = 'INVALID_MANUAL_EDIT';
    throw err;
  }
  const hasSubject = Object.prototype.hasOwnProperty.call(raw, 'subject');
  const hasHtml = Object.prototype.hasOwnProperty.call(raw, 'html');
  if (!hasSubject && !hasHtml) return null;
  if (!hasSubject || !hasHtml) {
    const err = new Error('editedContent must include both subject and html');
    err.code = 'INVALID_MANUAL_EDIT';
    throw err;
  }
  const subject = String(raw.subject).trim();
  const html = String(raw.html);
  if (!subject) {
    const err = new Error('Edited subject cannot be empty');
    err.code = 'INVALID_MANUAL_EDIT';
    throw err;
  }
  if (!html.trim()) {
    const err = new Error('Edited HTML cannot be empty');
    err.code = 'INVALID_MANUAL_EDIT';
    throw err;
  }
  if (subject.length > MAX_MANUAL_RESEND_SUBJECT_LENGTH) {
    const err = new Error(`Edited subject must be at most ${MAX_MANUAL_RESEND_SUBJECT_LENGTH} characters`);
    err.code = 'INVALID_MANUAL_EDIT';
    throw err;
  }
  if (html.length > MAX_MANUAL_RESEND_HTML_LENGTH) {
    const err = new Error(`Edited HTML must be at most ${MAX_MANUAL_RESEND_HTML_LENGTH} characters`);
    err.code = 'INVALID_MANUAL_EDIT';
    throw err;
  }
  return { subject, html };
}

// POST body: { templateKey, overrideRecipient?, editedContent?: { subject, html } } — manual resend only; does not mutate booking or payments
const resendBookingLifecycleEmail = async (req, res) => {
  try {
    await assertAdminModuleWriteAllowed('reservations');
    requirePermission({
      role: req.user?.role,
      action: ACTIONS.BOOKING_LIFECYCLE_EMAIL_RESEND
    });

    const { id } = req.params;
    const { templateKey, overrideRecipient } = req.body;

    if (!bookingLifecycleEmailService.isValidGuestTemplateKey(templateKey)) {
      return res.status(400).json({
        success: false,
        message: 'templateKey must be booking_received, booking_confirmed, or booking_cancelled'
      });
    }

    let manualContentOverride = null;
    try {
      manualContentOverride = parseManualResendEditedContent(req.body);
    } catch (parseErr) {
      if (parseErr.code === 'INVALID_MANUAL_EDIT') {
        return res.status(400).json({ success: false, message: parseErr.message, errorType: parseErr.code });
      }
      throw parseErr;
    }

    const booking = await Booking.findById(id)
      .populate('cabinId', BOOKING_EMAIL_POPULATE_FIELDS)
      .populate('cabinTypeId', BOOKING_EMAIL_POPULATE_FIELDS);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const result = await bookingLifecycleEmailService.sendBookingLifecycleEmail({
      booking,
      templateKey,
      overrideRecipient: overrideRecipient != null ? String(overrideRecipient) : null,
      lifecycleSource: 'manual_resend',
      actorContext: {
        actorId: req.user?.id || null,
        actorRole: req.user?.role || null
      },
      manualContentOverride
    });

    const ev = result.emailEvent;
    return res.json({
      success: Boolean(result.sendResult?.success),
      data: {
        sendResult: result.sendResult,
        sendStatus: result.sendStatus,
        deliveryMethod: result.deliveryMethod,
        recipient: result.recipient,
        templateKey: result.templateKey,
        emailEvent: ev
          ? {
              _id: String(ev._id),
              createdAt: ev.createdAt,
              type: ev.type,
              templateKey: ev.templateKey,
              lifecycleSource: ev.lifecycleSource,
              sendStatus: ev.sendStatus,
              deliveryMethod: ev.deliveryMethod,
              to: ev.to,
              subject: ev.subject,
              overrideRecipientUsed: ev.overrideRecipientUsed,
              guestEmailAtSend: ev.guestEmailAtSend,
              actorId: ev.actorId,
              actorRole: ev.actorRole,
              errorMessage: ev.errorMessage,
              messageId: ev.messageId || null,
              details: ev.details || null
            }
          : null
      }
    });
  } catch (error) {
    if (error.code === 'INVALID_MANUAL_EDIT') {
      return res.status(400).json({ success: false, message: error.message, errorType: error.code });
    }
    if (error.code === 'CONTENT_OVERRIDE_NOT_ALLOWED') {
      return res.status(403).json({ success: false, message: error.message, errorType: error.code });
    }
    if (error.code === 'INVALID_OVERRIDE_EMAIL' || error.code === 'MISSING_RECIPIENT') {
      return res.status(400).json({ success: false, message: error.message, errorType: error.code });
    }
    if (error.code === 'PERMISSION_DENIED') {
      return res.status(error.status || 403).json({ success: false, message: error.message });
    }
    if (error.code === 'CUTOVER_WRITE_BLOCKED') {
      return res.status(error.status || 403).json({
        success: false,
        errorType: 'cutover_blocked',
        message: error.message,
        details: { moduleKey: error.moduleKey || 'unknown' }
      });
    }
    console.error('Resend booking lifecycle email error:', error);
    res.status(500).json({ success: false, message: 'Failed to send email' });
  }
};

// POST body: { templateKey } — compose-only preview; no send, no booking mutation, no EmailEvent
const previewBookingLifecycleEmail = async (req, res) => {
  try {
    await assertAdminModuleWriteAllowed('reservations');
    requirePermission({
      role: req.user?.role,
      action: ACTIONS.BOOKING_LIFECYCLE_EMAIL_RESEND
    });

    const { id } = req.params;
    const { templateKey } = req.body || {};

    if (!bookingLifecycleEmailService.isValidGuestTemplateKey(templateKey)) {
      return res.status(400).json({
        success: false,
        message: 'templateKey must be booking_received, booking_confirmed, or booking_cancelled'
      });
    }

    const booking = await Booking.findById(id)
      .populate('cabinId', BOOKING_EMAIL_POPULATE_FIELDS)
      .populate('cabinTypeId', BOOKING_EMAIL_POPULATE_FIELDS);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const data = await bookingLifecycleEmailService.previewGuestLifecycleEmail({
      booking,
      templateKey
    });

    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, data });
  } catch (error) {
    if (error.code === 'PERMISSION_DENIED') {
      return res.status(error.status || 403).json({ success: false, message: error.message });
    }
    if (error.code === 'CUTOVER_WRITE_BLOCKED') {
      return res.status(error.status || 403).json({
        success: false,
        errorType: 'cutover_blocked',
        message: error.message,
        details: { moduleKey: error.moduleKey || 'unknown' }
      });
    }
    console.error('Preview booking lifecycle email error:', error);
    res.status(500).json({ success: false, message: 'Failed to build preview' });
  }
};

/**
 * GET query: bookingId and/or email (admin). When req.params.id is set (OPS nested route), only that bookingId is used.
 */
const listBookingEmailEvents = async (req, res) => {
  try {
    const bookingIdFromRoute = req.params?.id;
    let bookingId;
    let email;
    if (bookingIdFromRoute != null && bookingIdFromRoute !== '') {
      bookingId = String(bookingIdFromRoute);
      email = undefined;
    } else {
      bookingId = req.query.bookingId || undefined;
      email = req.query.email || undefined;
    }

    if (!bookingId && !email) {
      return res.status(400).json({
        success: false,
        message: 'Either bookingId or email is required'
      });
    }

    const filter = {};
    if (bookingId) filter.bookingId = bookingId;
    if (email) filter.to = email;

    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const events = await EmailEvent.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean();

    const total = await EmailEvent.countDocuments(filter);

    return res.json({
      success: true,
      data: {
        events,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

module.exports = {
  previewBookingLifecycleEmail,
  resendBookingLifecycleEmail,
  listBookingEmailEvents
};
