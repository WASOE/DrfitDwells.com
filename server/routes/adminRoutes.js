const express = require('express');
const { body, validationResult } = require('express-validator');
const { adminAuth } = require('../middleware/adminAuth');
const { upload, validateMagicBytes } = require('../middleware/upload');
const { validateId } = require('../middleware/validateId');
const {
  login,
  getBookings,
  getBookingById,
  updateBookingStatus,
  resendBookingLifecycleEmail,
  previewBookingLifecycleEmail,
  getCabins,
  getCabinById,
  createCabin,
  updateCabin
} = require('../controllers/adminController');
const { listBookingEmailEvents } = require('../controllers/shared/bookingLifecycleEmailController');
const Cabin = require('../models/Cabin');
const EmailEvent = require('../models/EmailEvent');
const path = require('path');
const fs = require('fs');
const { adminModuleWriteGate } = require('../middleware/adminModuleCutoverEnforcement');
const {
  uploadCabinImage,
  reorderCabinImages,
  updateCabinImageMetadata,
  batchUpdateCabinImages,
  deleteCabinImage
} = require('../services/cabins/cabinMediaService');
const adminPromoRoutes = require('./adminPromoRoutes');

const router = express.Router();

// POST /api/admin/login - Admin login
router.post('/login', [
  body('username').notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  
  login(req, res);
});

// All other admin routes require authentication
router.use(adminAuth);

router.use('/promo-codes', adminPromoRoutes);

// GET /api/admin/bookings - Get bookings with filters and pagination
router.get('/bookings', getBookings);

// GET /api/admin/bookings/:id - Get single booking detail
router.get('/bookings/:id', validateId('id'), getBookingById);

// PATCH /api/admin/bookings/:id/status - Update booking status
router.patch('/bookings/:id/status', validateId('id'), [
  body('status').isIn(['pending', 'confirmed', 'cancelled']).withMessage('Status must be pending, confirmed, or cancelled')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  
  updateBookingStatus(req, res);
});

// POST /api/admin/bookings/:id/email-actions/resend — manual lifecycle resend (optional body.editedContent: { subject, html })
router.post(
  '/bookings/:id/email-actions/resend',
  validateId('id'),
  [
    body('templateKey')
      .isIn(['booking_received', 'booking_confirmed', 'booking_cancelled'])
      .withMessage('templateKey must be booking_received, booking_confirmed, or booking_cancelled'),
    body('overrideRecipient').optional({ checkFalsy: true }).isEmail().withMessage('overrideRecipient must be a valid email')
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    resendBookingLifecycleEmail(req, res);
  }
);

// POST /api/admin/bookings/:id/email-actions/preview — compose-only; no send, no EmailEvent
router.post(
  '/bookings/:id/email-actions/preview',
  validateId('id'),
  [
    body('templateKey')
      .isIn(['booking_received', 'booking_confirmed', 'booking_cancelled'])
      .withMessage('templateKey must be booking_received, booking_confirmed, or booking_cancelled')
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    previewBookingLifecycleEmail(req, res);
  }
);

// GET /api/admin/cabins - Get cabins with search and pagination
router.get('/cabins', getCabins);

// POST /api/admin/cabins - Create cabin
router.post('/cabins', adminModuleWriteGate('cabins'), createCabin);

// GET /api/admin/cabins/:id - Get single cabin detail
router.get('/cabins/:id', validateId('id'), getCabinById);

// PATCH /api/admin/cabins/:id - Update cabin
router.patch('/cabins/:id', validateId('id'), adminModuleWriteGate('cabins'), updateCabin);

// POST /api/admin/cabins/:id/images  (single file field "file")
router.post('/cabins/:id/images', validateId('id'), adminModuleWriteGate('cabins'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!validateMagicBytes(req.file.path, ext)) {
      fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ success: false, message: 'File content does not match its extension' });
    }

    const data = await uploadCabinImage({ cabinId: req.params.id, file: req.file });
    return res.json({ success: true, data });
  } catch (e) {
    if (e.status === 404) {
      return res.status(404).json({ success: false, message: e.message });
    }
    return res.status(500).json({ success: false, message: e.message });
  }
});

// PATCH /api/admin/cabins/:id/images/reorder — MUST be registered before /images/:imageId or "reorder" is parsed as imageId → 400
// body: { order: [{ imageId, sort, spaceOrder? }] } (preferred) or legacy raw array
router.patch('/cabins/:id/images/reorder', validateId('id'), adminModuleWriteGate('cabins'), async (req, res) => {
  try {
    const data = await reorderCabinImages({ cabinId: req.params.id, rawBody: req.body });
    return res.json({ success: true, data });
  } catch (e) {
    if (e.status === 404) {
      return res.status(404).json({ success: false, message: e.message });
    }
    return res.status(500).json({ success: false, message: e.message });
  }
});

// PATCH /api/admin/cabins/:id/images/:imageId  (alt, isCover, sort, tags, spaceOrder)
router.patch('/cabins/:id/images/:imageId', validateId('id'), validateId('imageId'), adminModuleWriteGate('cabins'), async (req, res) => {
  try {
    const data = await updateCabinImageMetadata({
      cabinId: req.params.id,
      imageId: req.params.imageId,
      payload: req.body
    });
    return res.json({ success: true, data });
  } catch (e) {
    if (e.status === 404) {
      return res.status(404).json({ success: false, message: e.message });
    }
    return res.status(500).json({ success: false, message: e.message });
  }
});

// PATCH /api/admin/cabins/:id/images/batch - Bulk update images (tags, spaceOrder, etc.)
router.patch('/cabins/:id/images/batch', adminModuleWriteGate('cabins'), async (req, res) => {
  try {
    const data = await batchUpdateCabinImages({ cabinId: req.params.id, updates: req.body?.updates });
    return res.json({ success: true, data });
  } catch (e) {
    if (e.status === 404) {
      return res.status(404).json({ success: false, message: e.message });
    }
    if (e.status === 400) {
      return res.status(400).json({ success: false, message: e.message });
    }
    return res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE /api/admin/cabins/:id/images/:imageId
router.delete('/cabins/:id/images/:imageId', validateId('id'), validateId('imageId'), adminModuleWriteGate('cabins'), async (req, res) => {
  try {
    const data = await deleteCabinImage({
      cabinId: req.params.id,
      imageId: req.params.imageId,
      user: req.user,
      req
    });
    return res.json({ success: true, data });
  } catch (e) {
    if (e.status === 404) {
      return res.status(404).json({ success: false, message: e.message });
    }
    if (e.code === 'PERMISSION_DENIED') {
      return res.status(e.status || 403).json({ success: false, message: e.message });
    }
    if (e.code === 'AUDIT_WRITE_FAILED') {
      return res.status(500).json({ success: false, message: 'Delete blocked because audit write failed' });
    }
    return res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/admin/email-events - Get email events for a booking or email
router.get('/email-events', listBookingEmailEvents);

// POST /api/admin/backfill-imageurl - Backfill imageUrl for existing cabins
router.post('/backfill-imageurl', async (req, res) => {
  try {
    const cabins = await Cabin.find({});
    let updatedCount = 0;
    
    for (const cabin of cabins) {
      const arr = Array.isArray(cabin.images) ? cabin.images : [];
      const cover = arr.find(i => i && i.isCover) || arr[0];
      
      if (cover && cabin.imageUrl !== cover.url) {
        cabin.imageUrl = cover.url;
        await cabin.save();
        updatedCount++;
      }
    }
    
    return res.json({
      success: true,
      message: `Backfilled imageUrl for ${updatedCount} cabins`,
      data: { updatedCount, totalCabins: cabins.length }
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/admin/email-events/summary - Get email events summary for an email
router.get('/email-events/summary', async (req, res) => {
  try {
    const { email } = req.query;
    
    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email is required' 
      });
    }

    // Get events from last 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const events = await EmailEvent.find({
      to: email,
      createdAt: { $gte: ninetyDaysAgo }
    }).lean();

    // Check for bounce or complaint events
    const hasIssues = events.some(event => 
      event.type === 'Bounce' || event.type === 'SpamComplaint'
    );

    // Count by type
    const summary = events.reduce((acc, event) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {});

    return res.json({
      success: true,
      data: {
        email,
        hasIssues,
        summary,
        totalEvents: events.length,
        lastEvent: events.length > 0 ? events[0].createdAt : null
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
