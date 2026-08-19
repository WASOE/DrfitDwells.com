const { formatSofiaDateOnly } = require('../../../utils/dateTime');

const EXTERNAL_HOLD_SOURCE = 'airbnb_ical';
const EXTERNAL_HOLD_DISPLAY_NAME = 'Airbnb hold';

function baseExternalHoldFilter() {
  return {
    blockType: 'external_hold',
    source: EXTERNAL_HOLD_SOURCE,
    status: 'active'
  };
}

function buildExternalHoldLaneFilters({ startOfToday, endOfToday }) {
  const base = baseExternalHoldFilter();
  return {
    arriving: {
      ...base,
      startDate: { $gte: startOfToday, $lte: endOfToday }
    },
    staying: {
      ...base,
      startDate: { $lt: startOfToday },
      endDate: { $gt: endOfToday }
    },
    leaving: {
      ...base,
      endDate: { $gte: startOfToday, $lte: endOfToday }
    },
    upcoming: {
      ...base,
      startDate: { $gt: endOfToday }
    }
  };
}

function resolveUnitLabelFromBlock(block) {
  if (!block?.unitId) return null;
  const unit = block.unitId;
  const displayName = typeof unit.displayName === 'string' ? unit.displayName.trim() : '';
  if (displayName) return displayName;
  const unitNumber = typeof unit.unitNumber === 'string' ? unit.unitNumber.trim() : '';
  if (!unitNumber) return null;
  if (/^unit\b/i.test(unitNumber)) return unitNumber;
  return `Unit ${unitNumber}`;
}

function resolveAccommodationDisplayNameFromBlock(block) {
  const base = block?.cabinId?.name || 'Unknown';
  const unit = resolveUnitLabelFromBlock(block);
  return unit ? `${base} · ${unit}` : base;
}

function mapExternalHoldRow(block) {
  const checkInDateOnly = block.startDate ? formatSofiaDateOnly(block.startDate) : null;
  const checkOutDateOnly = block.endDate ? formatSofiaDateOnly(block.endDate) : null;
  return {
    kind: 'external_hold',
    channel: 'airbnb',
    reservationId: block._id ? String(block._id) : null,
    guestName: EXTERNAL_HOLD_DISPLAY_NAME,
    accommodationDisplayName: resolveAccommodationDisplayNameFromBlock(block),
    datesLabel: `${checkInDateOnly || '—'} - ${checkOutDateOnly || '—'}`,
    checkInDate: block.startDate || null,
    checkOutDate: block.endDate || null,
    checkInDateOnly,
    checkOutDateOnly
  };
}

function compareByCheckInAsc(a, b) {
  const ta = a.checkInDate ? new Date(a.checkInDate).getTime() : 0;
  const tb = b.checkInDate ? new Date(b.checkInDate).getTime() : 0;
  return ta - tb;
}

function compareByCheckOutAsc(a, b) {
  const ta = a.checkOutDate ? new Date(a.checkOutDate).getTime() : 0;
  const tb = b.checkOutDate ? new Date(b.checkOutDate).getTime() : 0;
  if (ta !== tb) return ta - tb;
  return compareByCheckInAsc(a, b);
}

function mergeDashboardRows(bookingRows, holdRows, { sort = 'checkIn' } = {}) {
  const merged = [...bookingRows, ...holdRows];
  if (sort === 'checkOut') {
    merged.sort(compareByCheckOutAsc);
  } else {
    merged.sort(compareByCheckInAsc);
  }
  return merged;
}

function appendUpcomingStatusLabel(rows, startOfToday) {
  return rows.map((row) => {
    const checkIn = row.checkInDate ? new Date(row.checkInDate) : null;
    const days = checkIn
      ? Math.floor((checkIn.getTime() - startOfToday.getTime()) / (1000 * 60 * 60 * 24))
      : null;
    if (row.kind === 'external_hold') {
      return {
        ...row,
        statusLabel: Number.isFinite(days) ? `Starts in ${days} day${days === 1 ? '' : 's'}` : 'Upcoming hold'
      };
    }
    return {
      ...row,
      statusLabel: Number.isFinite(days) ? `Arrives in ${days} day${days === 1 ? '' : 's'}` : 'Upcoming arrival'
    };
  });
}

module.exports = {
  EXTERNAL_HOLD_SOURCE,
  EXTERNAL_HOLD_DISPLAY_NAME,
  baseExternalHoldFilter,
  buildExternalHoldLaneFilters,
  mapExternalHoldRow,
  mergeDashboardRows,
  appendUpcomingStatusLabel
};
