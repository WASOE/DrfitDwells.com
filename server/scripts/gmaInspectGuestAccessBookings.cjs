#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Read-only A-Frame / guest-access unit inspection for GMA previews.
 *
 *   node scripts/gmaInspectGuestAccessBookings.cjs --booking 6a2d07a7...,6a0999d8...
 *   node scripts/gmaInspectGuestAccessBookings.cjs --list-a-frame-units
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const Booking = require('../models/Booking');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const { STAY_SLUGS } = require('../utils/staySlug');
const {
  describeAFrameUnitResolution,
  isAFrameCabinType
} = require('../services/messaging/stayAccessCredentialResolver');
const { resolveStayAccessCredentials } = require('../services/messaging/stayAccessCredentialResolver');
const { resolveGuestAccessVariables } = require('../services/messaging/messageVariableResolver');
const { resolvePropertyKindFromCabinTypeDoc } = require('../services/messaging/propertyKindResolver');

function parseArgs(argv) {
  const bookingIdx = argv.indexOf('--booking');
  const bookingIds = bookingIdx >= 0 && argv[bookingIdx + 1]
    ? argv[bookingIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  return {
    bookingIds,
    listAFrameUnits: argv.includes('--list-a-frame-units')
  };
}

async function loadBookingWithUnit(bookingId) {
  const booking = await Booking.findById(bookingId).lean();
  if (!booking) return null;
  if (!booking.unitId) return booking;
  const unit = await Unit.findById(booking.unitId).lean();
  return { ...booking, unitId: unit || booking.unitId };
}

async function inspectBooking(bookingId) {
  const booking = await loadBookingWithUnit(bookingId);
  if (!booking) {
    return { bookingId, status: 'not_found' };
  }

  const cabinType = booking.cabinTypeId
    ? await CabinType.findById(booking.cabinTypeId).lean()
    : null;
  const unit = booking.unitId && typeof booking.unitId === 'object' && booking.unitId.unitNumber
    ? booking.unitId
    : (booking.unitId ? await Unit.findById(booking.unitId).lean() : null);

  const row = {
    bookingId: String(booking._id),
    status: booking.status,
    checkIn: booking.checkIn,
    cabinId: booking.cabinId ? String(booking.cabinId) : null,
    cabinTypeId: booking.cabinTypeId ? String(booking.cabinTypeId) : null,
    unitIdOnBooking: booking.unitId ? String(booking.unitId._id || booking.unitId) : null,
    cabinTypeSlug: cabinType?.slug || null,
    isAFrame: cabinType ? isAFrameCabinType(cabinType) : false
  };

  if (cabinType && isAFrameCabinType(cabinType)) {
    row.aFrameInspection = describeAFrameUnitResolution(unit, booking);
    try {
      const propertyKind = resolvePropertyKindFromCabinTypeDoc(cabinType);
      const access = await resolveStayAccessCredentials({
        booking,
        stayTarget: cabinType,
        propertyKind
      });
      row.accessResolution = access.ok
        ? { ok: true, resolutionSource: access.resolutionSource, lockCode: access.credentials.lockCode }
        : {
            ok: false,
            blockReason: access.blockReason,
            missing: access.missing,
            resolutionSource: access.resolutionSource
          };
      const vars = await resolveGuestAccessVariables({
        booking,
        stayTarget: cabinType,
        propertyKind
      });
      row.guestAccessVariables = vars.ok
        ? {
            ok: true,
            propertyName: vars.variables.propertyName,
            lockCode: vars.variables.lockCode,
            hasWifiBlock: Boolean(vars.variables.wifiAccessBlock)
          }
        : {
            ok: false,
            blockReason: vars.blockReason,
            missing: vars.missing
          };
    } catch (err) {
      row.accessError = err.message;
    }
  }

  return row;
}

async function listAFrameUnits() {
  const cabinType = await CabinType.findOne({ slug: STAY_SLUGS.A_FRAME }).lean();
  if (!cabinType) {
    return { cabinType: null, units: [] };
  }
  const units = await Unit.find({ cabinTypeId: cabinType._id })
    .sort({ unitNumber: 1 })
    .lean();
  return {
    cabinType: {
      _id: String(cabinType._id),
      slug: cabinType.slug,
      name: cabinType.name
    },
    units: units.map((unit) => ({
      ...describeAFrameUnitResolution(unit, null),
      unit: {
        _id: String(unit._id),
        unitNumber: unit.unitNumber,
        displayName: unit.displayName || null,
        isActive: unit.isActive
      }
    }))
  };
}

async function main() {
  const { bookingIds, listAFrameUnits: shouldList } = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  if (!uri) {
    console.error('[gma-access-inspect] MONGODB_URI required.');
    process.exit(1);
  }

  await mongoose.connect(uri);

  if (shouldList) {
    const listing = await listAFrameUnits();
    console.log(JSON.stringify(listing, null, 2));
  }

  if (bookingIds.length > 0) {
    for (const id of bookingIds) {
      console.log('---');
      console.log(JSON.stringify(await inspectBooking(id), null, 2));
    }
  }

  if (!shouldList && bookingIds.length === 0) {
    console.error('Usage: --booking <id>[,<id>...] and/or --list-a-frame-units');
    process.exit(1);
  }

  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[gma-access-inspect] Fatal:', err?.message || err);
    mongoose.disconnect().finally(() => process.exit(1));
  });
}

module.exports = { inspectBooking, listAFrameUnits };
