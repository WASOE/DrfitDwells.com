const mongoose = require('mongoose');
const Cabin = require('../models/Cabin');
const { buildIcsCalendar } = require('../services/calendar/buildIcsCalendar');
const { selectBlockingSpansForSingleCabin } = require('../services/calendar/selectBlockingSpans');

function isStrictObjectId(id) {
  if (!id || typeof id !== 'string') return false;
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  return String(new mongoose.Types.ObjectId(id)) === id;
}

function safeIcsFilename(name, fallbackId) {
  const base = String(name || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (base.length > 0) return `${base}.ics`;
  return `cabin-${String(fallbackId).slice(0, 8)}.ics`;
}

async function getPublicCabinCalendarIcs(req, res) {
  const cabinId = req.params.cabinId;
  if (!isStrictObjectId(cabinId)) {
    return res.status(400).json({ success: false, message: 'Invalid cabin id' });
  }

  const cabin = await Cabin.findById(cabinId).select('name inventoryType isActive').lean();
  if (!cabin || cabin.isActive === false) {
    return res.status(404).json({ success: false, message: 'Cabin not found' });
  }
  if (cabin.inventoryType !== 'single') {
    return res.status(404).json({ success: false, message: 'Calendar export is not available for this property' });
  }

  const spans = await selectBlockingSpansForSingleCabin(cabinId);
  const events = spans.map((s) => ({
    uid: `${s.kind}-${s.sourceId}@driftdwells.com`,
    dtstamp: s.dtstamp,
    lastModified: s.lastModified,
    startDateInclusive: s.startDateInclusive,
    endDateExclusive: s.endDateExclusive,
    summary: 'Unavailable'
  }));

  const body = buildIcsCalendar({
    calendarName: cabin.name || 'Availability',
    events
  });

  const filename = safeIcsFilename(cabin.name, cabinId);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  return res.status(200).send(body);
}

module.exports = {
  getPublicCabinCalendarIcs
};
