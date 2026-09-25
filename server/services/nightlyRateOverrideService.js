'use strict';

const NightlyRateOverride = require('../models/NightlyRateOverride');
const { formatSofiaDateOnly } = require('../utils/dateTime');

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function expandNightlyDateRange(checkIn, checkOut) {
  const start = typeof checkIn === 'string' ? checkIn.slice(0, 10) : formatSofiaDateOnly(checkIn);
  const end = typeof checkOut === 'string' ? checkOut.slice(0, 10) : formatSofiaDateOnly(checkOut);
  const dates = [];
  for (let date = start; date && date < end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

async function loadNightlyRateOverrides({
  ratePlanCode,
  ratePlanVersion,
  entityType,
  accommodationKey,
  checkIn,
  checkOut,
  model = NightlyRateOverride
}) {
  const dates = expandNightlyDateRange(checkIn, checkOut);
  if (!dates.length) return [];
  return model
    .find({
      ratePlanCode: String(ratePlanCode).trim().toLowerCase(),
      ratePlanVersion: Number(ratePlanVersion),
      entityType,
      accommodationKey: String(accommodationKey).trim().toLowerCase(),
      dateKey: { $gte: dates[0], $lt: addDays(dates[dates.length - 1], 1) }
    })
    .select({
      _id: 0,
      dateKey: 1,
      baseNightlyAmountCents: 1,
      reason: 1,
      recommendation: 1
    })
    .sort({ dateKey: 1 })
    .lean();
}

function mapOverridesByDate(overrides = []) {
  return new Map(
    overrides
      .filter((override) => override && /^\d{4}-\d{2}-\d{2}$/.test(String(override.dateKey)))
      .map((override) => [String(override.dateKey), override])
  );
}

module.exports = {
  addDays,
  expandNightlyDateRange,
  loadNightlyRateOverrides,
  mapOverridesByDate
};
