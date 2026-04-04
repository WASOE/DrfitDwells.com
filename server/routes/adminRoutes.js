const express = require('express');
const { body, validationResult } = require('express-validator');
const { adminAuth } = require('../middleware/adminAuth');
const { upload, validateMagicBytes } = require('../middleware/upload');
const { validateId } = require('../middleware/validateId');
const { login, getBookings, getBookingById, updateBookingStatus, getCabins, getCabinById, createCabin, updateCabin } = require('../controllers/adminController');
const Cabin = require('../models/Cabin');
const EmailEvent = require('../models/EmailEvent');
const path = require('path');
const fs = require('fs');
const { requirePermission, ACTIONS } = require('../services/permissionService');
const { appendAuditEvent } = require('../services/auditWriter');
const { adminModuleWriteGate } = require('../middleware/adminModuleCutoverEnforcement');
const { syncMultiUnitGalleryToCabinType } = require('../services/syncMultiUnitGalleryToCabinType');

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
    const cabin = await Cabin.findById(req.params.id);
    if (!cabin) return res.status(404).json({ success: false, message: 'Cabin not found' });
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!validateMagicBytes(req.file.path, ext)) {
      fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ success: false, message: 'File content does not match its extension' });
    }

    const relPath = path.join('/uploads', 'cabins', req.params.id, 'original', req.file.filename);
    // basic metadata; width/height left 0 without processing
    const imageDoc = {
      url: relPath.replace(/\\/g, '/'),
      alt: '',
      sort: (cabin.images?.length || 0),
      isCover: cabin.images.length === 0, // first image becomes cover
      width: 0,
      height: 0,
      bytes: req.file.size
    };
    cabin.images.push(imageDoc);
    
    // Sync imageUrl to cover image (first image becomes cover)
    if (imageDoc.isCover) {
      cabin.imageUrl = imageDoc.url;
    }
    
    await cabin.save();
    await syncMultiUnitGalleryToCabinType(cabin);
    return res.json({ success: true, data: { image: imageDoc, images: cabin.images } });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// PATCH /api/admin/cabins/:id/images/:imageId  (alt, isCover, sort, tags, spaceOrder)
router.patch('/cabins/:id/images/:imageId', validateId('id'), validateId('imageId'), adminModuleWriteGate('cabins'), async (req, res) => {
  try {
    const { id, imageId } = req.params;
    const { alt, isCover, sort, tags, spaceOrder } = req.body;
    const cabin = await Cabin.findById(id);
    if (!cabin) return res.status(404).json({ success: false, message: 'Cabin not found' });

    const img = cabin.images.find(i => i._id === imageId);
    if (!img) return res.status(404).json({ success: false, message: 'Image not found' });

    if (typeof alt === 'string') img.alt = alt;
    if (typeof sort === 'number') img.sort = sort;
    if (typeof spaceOrder === 'number') img.spaceOrder = spaceOrder;

    // Handle tags array
    if (Array.isArray(tags)) {
      const validTags = ['bedroom', 'living_room', 'kitchen', 'dining', 'bathroom', 'outdoor', 'view', 'hot_tub_sauna', 'amenities', 'floorplan', 'map', 'other'];
      img.tags = tags.filter(tag => validTags.includes(tag));
    }

    if (typeof isCover === 'boolean') {
      cabin.images.forEach(i => { i.isCover = false; });
      img.isCover = isCover;
      
      // Sync imageUrl to new cover image
      if (isCover) {
        cabin.imageUrl = img.url;
      }
    }

    await cabin.save();
    await syncMultiUnitGalleryToCabinType(cabin);
    return res.json({ success: true, data: { images: cabin.images } });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// PATCH /api/admin/cabins/:id/images/reorder  body: [{imageId, sort, spaceOrder}]
router.patch('/cabins/:id/images/reorder', adminModuleWriteGate('cabins'), async (req, res) => {
  try {
    const { id } = req.params;
    const order = Array.isArray(req.body) ? req.body : [];
    const cabin = await Cabin.findById(id);
    if (!cabin) return res.status(404).json({ success: false, message: 'Cabin not found' });

    const sortMap = new Map(order.map(o => [o.imageId, o.sort]));
    const spaceOrderMap = new Map(order.map(o => [o.imageId, o.spaceOrder]));
    cabin.images.forEach(i => {
      if (sortMap.has(i._id)) i.sort = sortMap.get(i._id);
      if (spaceOrderMap.has(i._id) && spaceOrderMap.get(i._id) !== undefined) {
        i.spaceOrder = spaceOrderMap.get(i._id);
      }
    });
    await cabin.save();
    await syncMultiUnitGalleryToCabinType(cabin);
    return res.json({ success: true, data: { images: cabin.images } });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// PATCH /api/admin/cabins/:id/images/batch - Bulk update images (tags, spaceOrder, etc.)
router.patch('/cabins/:id/images/batch', adminModuleWriteGate('cabins'), async (req, res) => {
  try {
    const { id } = req.params;
    const { updates } = req.body; // Array of {imageId, tags?, spaceOrder?, alt?, isCover?}
    const cabin = await Cabin.findById(id);
    if (!cabin) return res.status(404).json({ success: false, message: 'Cabin not found' });

    if (!Array.isArray(updates)) {
      return res.status(400).json({ success: false, message: 'Updates must be an array' });
    }

    const validTags = ['bedroom', 'living_room', 'kitchen', 'dining', 'bathroom', 'outdoor', 'view', 'hot_tub_sauna', 'amenities', 'floorplan', 'map', 'other'];
    
    for (const update of updates) {
      const img = cabin.images.find(i => i._id === update.imageId);
      if (!img) continue;

      if (Array.isArray(update.tags)) {
        img.tags = update.tags.filter(tag => validTags.includes(tag));
      }
      if (typeof update.spaceOrder === 'number') {
        img.spaceOrder = update.spaceOrder;
      }
      if (typeof update.alt === 'string') {
        img.alt = update.alt;
      }
      if (typeof update.isCover === 'boolean') {
        if (update.isCover) {
          cabin.images.forEach(i => { i.isCover = false; });
          img.isCover = true;
          cabin.imageUrl = img.url;
        } else {
          img.isCover = false;
        }
      }
    }

    await cabin.save();
    await syncMultiUnitGalleryToCabinType(cabin);
    return res.json({ success: true, data: { images: cabin.images } });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE /api/admin/cabins/:id/images/:imageId
router.delete('/cabins/:id/images/:imageId', validateId('id'), validateId('imageId'), adminModuleWriteGate('cabins'), async (req, res) => {
  try {
    const { id, imageId } = req.params;
    const cabin = await Cabin.findById(id);
    if (!cabin) return res.status(404).json({ success: false, message: 'Cabin not found' });

    const idx = cabin.images.findIndex(i => i._id === imageId);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Image not found' });

    requirePermission({
      role: req.user?.role,
      action: ACTIONS.CABIN_IMAGE_DELETE
    });

    const beforeCount = cabin.images.length;
    const removedImage = cabin.images[idx];
    await appendAuditEvent(
      {
        actorType: 'user',
        actorId: req.user?.id || 'admin',
        entityType: 'Cabin',
        entityId: cabin._id.toString(),
        action: 'cabin_image_delete',
        beforeSnapshot: {
          imagesCount: beforeCount,
          imageId: String(imageId)
        },
        afterSnapshot: {
          imagesCount: beforeCount - 1,
          imageId: String(imageId)
        },
        metadata: {
          imageUrl: removedImage?.url || null
        },
        reason: 'image_delete',
        sourceContext: {
          route: 'DELETE /api/admin/cabins/:id/images/:imageId'
        }
      },
      { req }
    );

    const [img] = cabin.images.splice(idx, 1);
    // try remove file
    if (img?.url) {
      const abs = path.join(__dirname, '..', '..', img.url.replace('/uploads', 'uploads'));
      fs.promises.unlink(abs).catch(() => {});
    }
    // if we removed the cover, set first as cover
    if (!cabin.images.some(i => i.isCover) && cabin.images[0]) {
      cabin.images[0].isCover = true;
      // Sync imageUrl to new cover
      cabin.imageUrl = cabin.images[0].url;
    }

    await cabin.save();
    await syncMultiUnitGalleryToCabinType(cabin);
    return res.json({ success: true, data: { images: cabin.images } });
  } catch (e) {
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
router.get('/email-events', async (req, res) => {
  try {
    const { bookingId, email, page = 1, limit = 50 } = req.query;
    
    if (!bookingId && !email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Either bookingId or email is required' 
      });
    }

    const filter = {};
    if (bookingId) filter.bookingId = bookingId;
    if (email) filter.to = email;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const events = await EmailEvent.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

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
});

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
