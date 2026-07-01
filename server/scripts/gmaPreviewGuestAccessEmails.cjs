#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * GMA-GUEST-ACCESS-1 — preview day-before access emails for upcoming bookings.
 *
 * Read-only: renders templates, does not send email or mutate rules.
 *
 *   node scripts/gmaPreviewGuestAccessEmails.cjs
 *   node scripts/gmaPreviewGuestAccessEmails.cjs --limit 20
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const MessageTemplate = require('../models/MessageTemplate');
const {
  checkInAccessDayBeforeCabinRule,
  checkInAccessDayBeforeValleyRule
} = require('../data/messageAutomationRules');
const { cabinAccessEmailTemplate } = require('../data/messageTemplates/access_day_before_the_cabin');
const { valleyAccessEmailTemplate } = require('../data/messageTemplates/access_day_before_the_valley');
const { resolveGuestAccessVariables } = require('../services/messaging/messageVariableResolver');
const { renderGmaEmailHtml } = require('../services/messaging/gmaEmailHtmlRenderer');
const { derivePlainTextFromHtml } = require('../utils/manualLifecycleResendContent');
const { renderTemplateString } = require('../services/messaging/messageTemplatePreviewService');
const {
  resolvePropertyKindFromCabinDoc,
  resolvePropertyKindFromCabinTypeDoc
} = require('../services/messaging/propertyKindResolver');

const RULE_BY_KIND = Object.freeze({
  cabin: checkInAccessDayBeforeCabinRule,
  valley: checkInAccessDayBeforeValleyRule
});

const FALLBACK_TEMPLATES = Object.freeze({
  cabin: cabinAccessEmailTemplate,
  valley: valleyAccessEmailTemplate
});

function parseArgs(argv) {
  const limitIdx = argv.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number.parseInt(argv[limitIdx + 1], 10) : 50;
  return { limit: Number.isFinite(limit) && limit > 0 ? limit : 50 };
}

function redactEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const at = email.indexOf('@');
  if (at <= 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

async function resolveStayTarget(booking) {
  if (booking.cabinId) {
    return Cabin.findById(booking.cabinId).lean();
  }
  if (booking.cabinTypeId) {
    return CabinType.findById(booking.cabinTypeId).lean();
  }
  return null;
}

function detectStayKind(booking) {
  if (booking.cabinId) return 'cabin';
  if (booking.cabinTypeId) return 'cabinType';
  return null;
}

async function loadBookingWithUnit(bookingId) {
  const booking = await Booking.findById(bookingId).lean();
  if (!booking?.unitId) return booking;
  const unit = await Unit.findById(booking.unitId).lean();
  return { ...booking, unitId: unit || booking.unitId };
}

async function loadTemplate(propertyKind) {
  const key = FALLBACK_TEMPLATES[propertyKind].key;
  const doc = await MessageTemplate.findOne({
    key,
    channel: 'email',
    locale: 'en',
    propertyKind,
    status: { $in: ['draft', 'approved'] }
  })
    .sort({ version: -1 })
    .lean();
  return doc || FALLBACK_TEMPLATES[propertyKind];
}

async function previewOneBooking(booking) {
  const stayKind = detectStayKind(booking);
  const stayTarget = await resolveStayTarget(booking);
  if (!stayTarget) {
    return { bookingId: String(booking._id), status: 'blocked', reason: 'no_stay_target' };
  }

  let propertyKind;
  try {
    propertyKind = stayKind === 'cabin'
      ? resolvePropertyKindFromCabinDoc(stayTarget)
      : resolvePropertyKindFromCabinTypeDoc(stayTarget);
  } catch (err) {
    return {
      bookingId: String(booking._id),
      status: 'blocked',
      reason: 'property_kind_unresolved',
      detail: err.message
    };
  }

  const rule = RULE_BY_KIND[propertyKind];
  const varResult = await resolveGuestAccessVariables({ booking, stayTarget, propertyKind });
  if (!varResult.ok) {
    return {
      bookingId: String(booking._id),
      status: 'manual_review',
      ruleKey: rule.ruleKey,
      propertyKind,
      guestEmailRedacted: redactEmail(booking.guestInfo?.email),
      checkIn: booking.checkIn,
      propertyName: stayTarget.name,
      blockReason: varResult.blockReason || null,
      missing: varResult.missing || [],
      resolutionSource: varResult.resolutionSource || null
    };
  }

  const template = await loadTemplate(propertyKind);
  const subject = renderTemplateString(template.emailSubject, varResult.variables);
  const fragmentHtml = renderTemplateString(template.emailBodyMarkup, varResult.variables);
  const html = renderGmaEmailHtml({
    audience: 'guest',
    subject,
    fragmentHtml,
    propertyName: varResult.variables.propertyName
  });
  const text = derivePlainTextFromHtml(html);

  return {
    bookingId: String(booking._id),
    status: 'ok',
    ruleKey: rule.ruleKey,
    propertyKind,
    guestEmailRedacted: redactEmail(booking.guestInfo?.email),
    checkIn: booking.checkIn,
    propertyName: varResult.variables.propertyName,
    resolutionSource: varResult.resolutionSource,
    lockCode: varResult.variables.lockCode,
    subject,
    text,
    bodyRedactedInLogs: true
  };
}

async function main() {
  const { limit } = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  if (!uri) {
    console.error('[gma-access-preview] MONGODB_URI required.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const now = new Date();

  const bookings = await Booking.find({
    status: { $in: ['confirmed', 'in_house'] },
    checkIn: { $gte: now },
    isTest: { $ne: true },
    archivedAt: null
  })
    .sort({ checkIn: 1 })
    .limit(limit)
    .select('_id checkIn guestInfo cabinId cabinTypeId unitId')
    .lean();

  console.log(`[gma-access-preview] Upcoming bookings: ${bookings.length} (limit ${limit})`);
  console.log('[gma-access-preview] No emails sent. Guest emails redacted.\n');

  let ok = 0;
  let blocked = 0;

  for (const row of bookings) {
    const booking = await loadBookingWithUnit(row._id);
    const preview = await previewOneBooking(booking);
    console.log('---');
    console.log(JSON.stringify(preview, null, 2));
    if (preview.status === 'ok') ok += 1;
    else blocked += 1;
  }

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify({ total: bookings.length, rendered: ok, blockedOrReview: blocked }, null, 2));

  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[gma-access-preview] Fatal:', err?.message || err);
    mongoose.disconnect().finally(() => process.exit(1));
  });
}

module.exports = { previewOneBooking, redactEmail };
