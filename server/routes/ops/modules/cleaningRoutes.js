const express = require('express');
const mongoose = require('mongoose');
const Booking = require('../../../models/Booking');
const CleaningRecord = require('../../../models/CleaningRecord');
const CleaningPayment = require('../../../models/CleaningPayment');
const AvailabilityBlock = require('../../../models/AvailabilityBlock');
const {
  getCleaningSchedule,
  getCleaningPaymentSummary,
  getGlobalPayoutSummary
} = require('../../../services/ops/readModels/cleaningReadModel');
const { calculateForMarkPaid } = require('../../../services/ops/cleaning/cleaningPricingService');
const { isExternalHoldEligibleForCleaning } = require('../../../services/ops/cleaning/airbnbStayClassifier');
const {
  getPricingPolicySettings,
  updatePricingPolicyRules
} = require('../../../services/ops/cleaning/cleaningPricingPolicyAdminService');
const {
  getCleaningInventoryTags,
  updateCabinCleaningTags,
  updateCabinTypeCleaningTags
} = require('../../../services/ops/cleaning/cleaningInventoryTagsService');
const { normalizeDateToSofiaDayStart } = require('../../../utils/dateTime');
const { requirePermission, ACTIONS } = require('../../../services/permissionService');

const router = express.Router();

function permissionContext(req) {
  return { role: req.user?.role, modules: req.user?.modules };
}

function handleRouteError(error, res) {
  if (error?.code === 'PERMISSION_DENIED') {
    return res.status(error.status || 403).json({
      success: false,
      errorType: 'permission',
      message: error.message
    });
  }
  return res.status(500).json({ success: false, message: error.message });
}

function isValidDateInput(value) {
  if (value == null || value === '') return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

function normalizePropertyKind(value) {
  if (value === 'cabin' || value === 'valley') return value;
  return null;
}

function resolveActorId(req) {
  const id = req.user?.id;
  if (id != null && String(id).trim() !== '') {
    return String(id).trim();
  }
  const role = req.user?.role;
  if (role != null && String(role).trim() !== '') {
    return String(role).trim();
  }
  return 'unknown';
}

/**
 * Parse schedule taskId. Accepts legacy bare booking ObjectId or `ext:{blockId}`.
 * @returns {{ sourceKind: 'booking'|'external_hold', sourceId: string } | null}
 */
function parseCleaningTaskId(taskId) {
  const raw = String(taskId || '').trim();
  if (!raw) return null;
  if (raw.startsWith('ext:')) {
    const sourceId = raw.slice(4);
    if (!mongoose.Types.ObjectId.isValid(sourceId)) return null;
    return { sourceKind: 'external_hold', sourceId };
  }
  if (!mongoose.Types.ObjectId.isValid(raw)) return null;
  return { sourceKind: 'booking', sourceId: raw };
}

/**
 * Find-or-create CleaningRecord for a source-neutral task on a Sofia day.
 */
async function findOrCreateCleaningRecordForTask(parsed, sofiaStart) {
  const { sourceKind, sourceId } = parsed;

  let record = await CleaningRecord.findOne({
    sourceKind,
    sourceId,
    cleaningDate: sofiaStart
  });
  if (!record && sourceKind === 'booking') {
    record = await CleaningRecord.findOne({ bookingId: sourceId, cleaningDate: sofiaStart });
  }
  if (!record && sourceKind === 'external_hold') {
    record = await CleaningRecord.findOne({
      availabilityBlockId: sourceId,
      cleaningDate: sofiaStart
    });
  }
  if (record) {
    // Backfill source fields for legacy booking rows.
    if (!record.sourceKind) record.sourceKind = sourceKind;
    if (!record.sourceId) record.sourceId = sourceId;
    return record;
  }

  if (sourceKind === 'booking') {
    const booking = await Booking.findById(sourceId).select('cabinId cabinTypeId unitId');
    if (!booking) return null;
    const insert = {
      sourceKind: 'booking',
      sourceId: String(booking._id),
      bookingId: booking._id,
      cabinId: booking.cabinId || null,
      cabinTypeId: booking.cabinTypeId || null,
      unitId: booking.unitId || null,
      cleaningDate: sofiaStart,
      paymentStatus: 'unpaid'
    };
    try {
      return await CleaningRecord.create(insert);
    } catch (error) {
      if (error?.code === 11000) {
        return CleaningRecord.findOne({
          $or: [
            { sourceKind: 'booking', sourceId: String(booking._id), cleaningDate: sofiaStart },
            { bookingId: booking._id, cleaningDate: sofiaStart }
          ]
        });
      }
      throw error;
    }
  }

  const block = await AvailabilityBlock.findById(sourceId)
    .select('cabinId unitId sourceReference blockType source status metadata')
    .lean();
  if (!block || !isExternalHoldEligibleForCleaning(block)) return null;
  if (!block.cabinId) return null;

  const insert = {
    sourceKind: 'external_hold',
    sourceId: String(block._id),
    bookingId: null,
    availabilityBlockId: block._id,
    sourceReference: block.sourceReference || null,
    cabinId: block.cabinId,
    cabinTypeId: null,
    unitId: block.unitId || null,
    cleaningDate: sofiaStart,
    paymentStatus: 'unpaid'
  };
  try {
    return await CleaningRecord.create(insert);
  } catch (error) {
    if (error?.code === 11000) {
      return CleaningRecord.findOne({
        $or: [
          { sourceKind: 'external_hold', sourceId: String(block._id), cleaningDate: sofiaStart },
          { availabilityBlockId: block._id, cleaningDate: sofiaStart }
        ]
      });
    }
    throw error;
  }
}

// GET /api/ops/cleaning/schedule?date=ISO&propertyKind=cabin|valley
router.get('/schedule', async (req, res) => {
  try {
    requirePermission({ ...permissionContext(req), action: ACTIONS.OPS_CLEANING_VIEW });
    const { date, propertyKind } = req.query;
    if (!isValidDateInput(date)) {
      return res.status(400).json({ success: false, message: 'A valid date query param is required.' });
    }
    const data = await getCleaningSchedule({
      date,
      propertyKind: normalizePropertyKind(propertyKind)
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleRouteError(error, res);
  }
});

// GET /api/ops/cleaning/payout-summary?date=ISO — global Cabin + Valley cleaner payout (read-only)
router.get('/payout-summary', async (req, res) => {
  try {
    requirePermission({ ...permissionContext(req), action: ACTIONS.OPS_CLEANING_PAYOUT_READ });
    const { date } = req.query;
    if (!isValidDateInput(date)) {
      return res.status(400).json({ success: false, message: 'A valid date query param is required.' });
    }
    const data = await getGlobalPayoutSummary({ date });
    return res.json({ success: true, data });
  } catch (error) {
    return handleRouteError(error, res);
  }
});

// GET /api/ops/cleaning/payment-summary?date=ISO&propertyKind=cabin|valley
router.get('/payment-summary', async (req, res) => {
  try {
    requirePermission({ ...permissionContext(req), action: ACTIONS.OPS_CLEANING_PAYMENT_READ });
    const { date, propertyKind } = req.query;
    if (!isValidDateInput(date)) {
      return res.status(400).json({ success: false, message: 'A valid date query param is required.' });
    }
    const data = await getCleaningPaymentSummary({
      date,
      propertyKind: normalizePropertyKind(propertyKind)
    });
    return res.json({ success: true, data });
  } catch (error) {
    return handleRouteError(error, res);
  }
});

function cleaningRecordResponse(record) {
  return {
    cleaningRecordId: String(record._id),
    status: record.status,
    paymentStatus: record.paymentStatus || 'unpaid',
    sourceKind: record.sourceKind,
    sourceId: record.sourceId,
    taskId:
      record.sourceKind === 'external_hold' ? `ext:${record.sourceId}` : String(record.sourceId)
  };
}

// POST /api/ops/cleaning/records/:taskId/mark-cleaned  body: { cleaningDate }
// taskId = booking ObjectId (legacy) or ext:{availabilityBlockId}
router.post('/records/:taskId/mark-cleaned', async (req, res) => {
  try {
    requirePermission({ ...permissionContext(req), action: ACTIONS.OPS_CLEANING_MARK_CLEANED });
    const parsed = parseCleaningTaskId(req.params.taskId);
    if (!parsed) {
      return res.status(400).json({ success: false, message: 'Invalid cleaning task id.' });
    }
    const { cleaningDate } = req.body || {};
    if (!isValidDateInput(cleaningDate)) {
      return res.status(400).json({ success: false, message: 'A valid cleaningDate is required.' });
    }
    const sofiaStart = normalizeDateToSofiaDayStart(cleaningDate);
    const record = await findOrCreateCleaningRecordForTask(parsed, sofiaStart);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Cleaning task source not found.' });
    }
    record.status = 'cleaned';
    record.markedCleanedAt = new Date();
    record.markedCleanedBy = resolveActorId(req);
    await record.save();
    return res.json({ success: true, data: cleaningRecordResponse(record) });
  } catch (error) {
    return handleRouteError(error, res);
  }
});

// POST /api/ops/cleaning/records/:taskId/unmark-cleaned  body: { cleaningDate }
router.post('/records/:taskId/unmark-cleaned', async (req, res) => {
  try {
    requirePermission({ ...permissionContext(req), action: ACTIONS.OPS_CLEANING_MARK_CLEANED });
    const parsed = parseCleaningTaskId(req.params.taskId);
    if (!parsed) {
      return res.status(400).json({ success: false, message: 'Invalid cleaning task id.' });
    }
    const { cleaningDate } = req.body || {};
    if (!isValidDateInput(cleaningDate)) {
      return res.status(400).json({ success: false, message: 'A valid cleaningDate is required.' });
    }
    const sofiaStart = normalizeDateToSofiaDayStart(cleaningDate);
    const record = await findOrCreateCleaningRecordForTask(parsed, sofiaStart);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Cleaning task source not found.' });
    }
    record.status = 'pending';
    record.markedCleanedAt = null;
    record.markedCleanedBy = null;
    await record.save();
    return res.json({ success: true, data: cleaningRecordResponse(record) });
  } catch (error) {
    return handleRouteError(error, res);
  }
});

// POST /api/ops/cleaning/records/:taskId/mark-task-paid  body: { cleaningDate }
// Task-level payment — independent of cleaned status. Admin payment_write only.
router.post('/records/:taskId/mark-task-paid', async (req, res) => {
  try {
    requirePermission({ ...permissionContext(req), action: ACTIONS.OPS_CLEANING_PAYMENT_WRITE });
    const parsed = parseCleaningTaskId(req.params.taskId);
    if (!parsed) {
      return res.status(400).json({ success: false, message: 'Invalid cleaning task id.' });
    }
    const { cleaningDate } = req.body || {};
    if (!isValidDateInput(cleaningDate)) {
      return res.status(400).json({ success: false, message: 'A valid cleaningDate is required.' });
    }
    const sofiaStart = normalizeDateToSofiaDayStart(cleaningDate);
    const record = await findOrCreateCleaningRecordForTask(parsed, sofiaStart);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Cleaning task source not found.' });
    }
    record.paymentStatus = 'paid';
    record.markedPaidAt = new Date();
    record.markedPaidBy = resolveActorId(req);
    await record.save();
    return res.json({ success: true, data: cleaningRecordResponse(record) });
  } catch (error) {
    return handleRouteError(error, res);
  }
});

router.post('/records/:taskId/unmark-task-paid', async (req, res) => {
  try {
    requirePermission({ ...permissionContext(req), action: ACTIONS.OPS_CLEANING_PAYMENT_WRITE });
    const parsed = parseCleaningTaskId(req.params.taskId);
    if (!parsed) {
      return res.status(400).json({ success: false, message: 'Invalid cleaning task id.' });
    }
    const { cleaningDate } = req.body || {};
    if (!isValidDateInput(cleaningDate)) {
      return res.status(400).json({ success: false, message: 'A valid cleaningDate is required.' });
    }
    const sofiaStart = normalizeDateToSofiaDayStart(cleaningDate);
    const record = await findOrCreateCleaningRecordForTask(parsed, sofiaStart);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Cleaning task source not found.' });
    }
    record.paymentStatus = 'unpaid';
    record.markedPaidAt = null;
    record.markedPaidBy = null;
    await record.save();
    return res.json({ success: true, data: cleaningRecordResponse(record) });
  } catch (error) {
    return handleRouteError(error, res);
  }
});

/** Find-or-create the per (date, propertyKind) CleaningPayment row (daily fee settlement). */
async function findOrCreateCleaningPayment(sofiaStart, propertyKind, totalAmount) {
  let payment = await CleaningPayment.findOne({ date: sofiaStart, propertyKind });
  if (!payment) {
    payment = new CleaningPayment({ date: sofiaStart, propertyKind, totalAmount });
  }
  return payment;
}

// POST /api/ops/cleaning/payments/mark-paid  body: { date, propertyKind }
router.post('/payments/mark-paid', async (req, res) => {
  try {
    requirePermission({ ...permissionContext(req), action: ACTIONS.OPS_CLEANING_PAYMENT_WRITE });
    const { date, propertyKind } = req.body || {};
    if (!isValidDateInput(date)) {
      return res.status(400).json({ success: false, message: 'A valid date is required.' });
    }
    const kind = normalizePropertyKind(propertyKind);
    if (!kind) {
      return res.status(400).json({ success: false, message: "propertyKind must be 'cabin' or 'valley'." });
    }
    const sofiaStart = normalizeDateToSofiaDayStart(date);
    const calc = await calculateForMarkPaid({ date, propertyKind: kind });
    const payment = await findOrCreateCleaningPayment(sofiaStart, kind, calc.totalAmountEUR);
    payment.currency = calc.currency || 'EUR';
    payment.totalAmount = calc.totalAmountEUR;
    payment.paidAmount = calc.totalAmountEUR;
    payment.status = 'paid';
    payment.lineItems = calc.lineItems;
    payment.pricingPolicyId = calc.pricingPolicyId || null;
    payment.pricingVersion = calc.pricingVersion || null;
    payment.calculatedAt = calc.calculatedAt;
    payment.markedPaidAt = new Date();
    payment.markedPaidBy = resolveActorId(req);
    await payment.save();
    return res.json({
      success: true,
      data: {
        cleaningPaymentId: String(payment._id),
        status: payment.status,
        totalAmount: payment.totalAmount,
        currency: payment.currency,
        lineItems: payment.lineItems
      }
    });
  } catch (error) {
    if (error?.code === 'NO_ACTIVE_PRICING_POLICY') {
      return res.status(error.status || 422).json({
        success: false,
        errorType: 'no_policy',
        message: error.message
      });
    }
    return handleRouteError(error, res);
  }
});

// POST /api/ops/cleaning/payments/unmark-paid  body: { date, propertyKind }
router.post('/payments/unmark-paid', async (req, res) => {
  try {
    requirePermission({ ...permissionContext(req), action: ACTIONS.OPS_CLEANING_PAYMENT_WRITE });
    const { date, propertyKind } = req.body || {};
    if (!isValidDateInput(date)) {
      return res.status(400).json({ success: false, message: 'A valid date is required.' });
    }
    const kind = normalizePropertyKind(propertyKind);
    if (!kind) {
      return res.status(400).json({ success: false, message: "propertyKind must be 'cabin' or 'valley'." });
    }
    const sofiaStart = normalizeDateToSofiaDayStart(date);
    const summary = await getCleaningPaymentSummary({ date, propertyKind: kind });
    const payment = await findOrCreateCleaningPayment(sofiaStart, kind, summary.totalAmount);
    payment.totalAmount = summary.totalAmount;
    payment.status = 'pending';
    payment.paidAmount = 0;
    payment.lineItems = [];
    payment.pricingPolicyId = null;
    payment.pricingVersion = null;
    payment.calculatedAt = null;
    payment.markedPaidAt = null;
    payment.markedPaidBy = null;
    await payment.save();
    return res.json({ success: true, data: { cleaningPaymentId: String(payment._id), status: payment.status } });
  } catch (error) {
    return handleRouteError(error, res);
  }
});

// GET /api/ops/cleaning/pricing-policy -> cabin + valley pricing DTOs
router.get('/pricing-policy', async (req, res) => {
  try {
    requirePermission({ ...permissionContext(req), action: ACTIONS.OPS_CLEANING_SETTINGS_READ });
    const data = await getPricingPolicySettings();
    return res.json({ success: true, data });
  } catch (error) {
    if (error?.status === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }
    return handleRouteError(error, res);
  }
});

// PUT /api/ops/cleaning/pricing-policy  body: { propertyKind, rules }
router.put('/pricing-policy', async (req, res) => {
  try {
    requirePermission({ ...permissionContext(req), action: ACTIONS.OPS_CLEANING_SETTINGS_WRITE });
    const kind = normalizePropertyKind(req.body?.propertyKind);
    if (!kind) {
      return res.status(400).json({ success: false, message: "propertyKind must be 'cabin' or 'valley'." });
    }
    const data = await updatePricingPolicyRules({
      propertyKind: kind,
      rules: req.body?.rules
    });
    return res.json({ success: true, data });
  } catch (error) {
    if (error?.status === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }
    return handleRouteError(error, res);
  }
});

// GET /api/ops/cleaning/inventory-tags?propertyKind=cabin|valley
router.get('/inventory-tags', async (req, res) => {
  try {
    requirePermission({ ...permissionContext(req), action: ACTIONS.OPS_CLEANING_SETTINGS_READ });
    const data = await getCleaningInventoryTags({
      propertyKind: normalizePropertyKind(req.query?.propertyKind)
    });
    return res.json({ success: true, data });
  } catch (error) {
    if (error?.status === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }
    return handleRouteError(error, res);
  }
});

// PATCH /api/ops/cleaning/inventory-tags/cabin/:id  body: { cleaningTags: string[] }
router.patch('/inventory-tags/cabin/:id', async (req, res) => {
  try {
    requirePermission({ ...permissionContext(req), action: ACTIONS.OPS_CLEANING_SETTINGS_WRITE });
    const data = await updateCabinCleaningTags(req.params.id, req.body?.cleaningTags);
    return res.json({ success: true, data });
  } catch (error) {
    if (error?.status === 400 || error?.status === 404) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return handleRouteError(error, res);
  }
});

// PATCH /api/ops/cleaning/inventory-tags/cabin-type/:id  body: { cleaningTags: string[] }
router.patch('/inventory-tags/cabin-type/:id', async (req, res) => {
  try {
    requirePermission({ ...permissionContext(req), action: ACTIONS.OPS_CLEANING_SETTINGS_WRITE });
    const data = await updateCabinTypeCleaningTags(req.params.id, req.body?.cleaningTags);
    return res.json({ success: true, data });
  } catch (error) {
    if (error?.status === 400 || error?.status === 404) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return handleRouteError(error, res);
  }
});

module.exports = router;
