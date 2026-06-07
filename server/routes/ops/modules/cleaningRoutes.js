const express = require('express');
const Booking = require('../../../models/Booking');
const CleaningRecord = require('../../../models/CleaningRecord');
const CleaningPayment = require('../../../models/CleaningPayment');
const CleaningSettings = require('../../../models/CleaningSettings');
const {
  getCleaningSchedule,
  getCleaningPaymentSummary
} = require('../../../services/ops/readModels/cleaningReadModel');
const { normalizeDateToSofiaDayStart } = require('../../../utils/dateTime');

const router = express.Router();

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

// GET /api/ops/cleaning/schedule?date=ISO&propertyKind=cabin|valley
router.get('/schedule', async (req, res) => {
  try {
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
    return res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/ops/cleaning/payment-summary?date=ISO&propertyKind=cabin|valley
router.get('/payment-summary', async (req, res) => {
  try {
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
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Find-or-create the CleaningRecord for a booking on a Sofia day.
 * Uses exact cleaningDate + unique index for idempotent, race-safe upsert.
 */
async function findOrCreateCleaningRecord(bookingId, sofiaStart) {
  let record = await CleaningRecord.findOne({ bookingId, cleaningDate: sofiaStart });
  if (record) return record;

  const booking = await Booking.findById(bookingId).select('cabinId cabinTypeId unitId');
  if (!booking) return null;

  const insert = {
    bookingId,
    cabinId: booking.cabinId || null,
    cabinTypeId: booking.cabinTypeId || null,
    unitId: booking.unitId || null,
    cleaningDate: sofiaStart
  };

  try {
    record = await CleaningRecord.create(insert);
    return record;
  } catch (error) {
    if (error?.code === 11000) {
      return CleaningRecord.findOne({ bookingId, cleaningDate: sofiaStart });
    }
    throw error;
  }
}

// POST /api/ops/cleaning/records/:bookingId/mark-cleaned  body: { cleaningDate }
router.post('/records/:bookingId/mark-cleaned', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { cleaningDate } = req.body || {};
    if (!isValidDateInput(cleaningDate)) {
      return res.status(400).json({ success: false, message: 'A valid cleaningDate is required.' });
    }
    const sofiaStart = normalizeDateToSofiaDayStart(cleaningDate);
    const record = await findOrCreateCleaningRecord(bookingId, sofiaStart);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }
    record.status = 'cleaned';
    record.markedCleanedAt = new Date();
    record.markedCleanedBy = resolveActorId(req);
    await record.save();
    return res.json({ success: true, data: { cleaningRecordId: String(record._id), status: record.status } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/ops/cleaning/records/:bookingId/unmark-cleaned  body: { cleaningDate }
router.post('/records/:bookingId/unmark-cleaned', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { cleaningDate } = req.body || {};
    if (!isValidDateInput(cleaningDate)) {
      return res.status(400).json({ success: false, message: 'A valid cleaningDate is required.' });
    }
    const sofiaStart = normalizeDateToSofiaDayStart(cleaningDate);
    const record = await findOrCreateCleaningRecord(bookingId, sofiaStart);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }
    record.status = 'pending';
    record.markedCleanedAt = null;
    record.markedCleanedBy = null;
    await record.save();
    return res.json({ success: true, data: { cleaningRecordId: String(record._id), status: record.status } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/** Find-or-create the per (date, propertyKind) CleaningPayment row. */
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
    payment.status = 'paid';
    payment.paidAmount = summary.totalAmount;
    payment.markedPaidAt = new Date();
    payment.markedPaidBy = resolveActorId(req);
    await payment.save();
    return res.json({ success: true, data: { cleaningPaymentId: String(payment._id), status: payment.status } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/ops/cleaning/payments/unmark-paid  body: { date, propertyKind }
router.post('/payments/unmark-paid', async (req, res) => {
  try {
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
    payment.markedPaidAt = null;
    payment.markedPaidBy = null;
    await payment.save();
    return res.json({ success: true, data: { cleaningPaymentId: String(payment._id), status: payment.status } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/** Load the base fees for both property kinds, defaulting missing rows to 0. */
async function loadCleaningBaseFees() {
  const docs = await CleaningSettings.find({}).lean();
  const fees = { cabin: 0, valley: 0 };
  docs.forEach((d) => {
    if (d.propertyKind === 'cabin' || d.propertyKind === 'valley') {
      fees[d.propertyKind] = typeof d.baseFee === 'number' ? d.baseFee : 0;
    }
  });
  return fees;
}

// GET /api/ops/cleaning/settings -> { cabin: number, valley: number }
router.get('/settings', async (req, res) => {
  try {
    const fees = await loadCleaningBaseFees();
    return res.json({ success: true, data: fees });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/ops/cleaning/settings  body: { propertyKind: 'cabin'|'valley', baseFee: number>=0 }
router.post('/settings', async (req, res) => {
  try {
    const kind = normalizePropertyKind(req.body?.propertyKind);
    if (!kind) {
      return res.status(400).json({ success: false, message: "propertyKind must be 'cabin' or 'valley'." });
    }
    const baseFee = Number(req.body?.baseFee);
    if (!Number.isFinite(baseFee) || baseFee < 0) {
      return res.status(400).json({ success: false, message: 'baseFee must be a number >= 0.' });
    }
    await CleaningSettings.findOneAndUpdate(
      { propertyKind: kind },
      { $set: { baseFee } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    const fees = await loadCleaningBaseFees();
    return res.json({ success: true, data: fees });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
