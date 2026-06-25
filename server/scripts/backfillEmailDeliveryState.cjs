#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const EmailEvent = require('../models/EmailEvent');
const EmailDeliveryState = require('../models/EmailDeliveryState');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const {
  bookingLifecycleCorrelationKey,
  giftVoucherCorrelationKey
} = require('../services/email/emailDeliveryCorrelation');
const { applyEmailDeliveryAttempt } = require('../services/email/emailDeliveryStateService');

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    apply: args.has('--apply')
  };
}

function mapLifecycleSendStatus(sendStatus) {
  if (sendStatus === 'success' || sendStatus === 'failed' || sendStatus === 'skipped') {
    return sendStatus;
  }
  return null;
}

function mapGiftVoucherEventToAttempt(event) {
  const metadata = event.metadata || {};
  const templateKind = metadata.templateKind;
  const recipientEmail = metadata.recipientEmail;
  if (!templateKind || !recipientEmail) {
    return null;
  }

  let sendStatus = null;
  let lifecycleSource = 'automatic';
  if (event.type === 'sent' || event.type === 'resent') {
    sendStatus = 'success';
    if (event.type === 'resent') {
      lifecycleSource = 'manual_resend';
    }
  } else if (event.type === 'send_failed') {
    sendStatus = 'failed';
    if (metadata.resend) {
      lifecycleSource = 'manual_resend';
    }
  } else {
    return null;
  }

  const kind = event.type === 'resent' ? 'recipient_voucher' : templateKind;
  let correlationKey;
  try {
    correlationKey = giftVoucherCorrelationKey({
      giftVoucherId: event.giftVoucherId,
      templateKind: kind,
      recipientEmail
    });
  } catch {
    return null;
  }

  return {
    correlationKey,
    domain: 'gift_voucher',
    giftVoucherId: event.giftVoucherId,
    templateKind: kind,
    recipient: String(recipientEmail).trim().toLowerCase(),
    sendStatus,
    lifecycleSource,
    errorMessage: metadata.error || null
  };
}

async function rebuildFromLifecycleEmailEvents({ apply }) {
  const events = await EmailEvent.find({
    type: 'LifecycleEmail',
    sendStatus: { $in: ['success', 'failed', 'skipped'] }
  })
    .sort({ createdAt: 1 })
    .lean();

  const summary = {
    scanned: events.length,
    applied: 0,
    skipped: 0,
    errors: 0
  };

  for (const event of events) {
    const sendStatus = mapLifecycleSendStatus(event.sendStatus);
    if (!sendStatus || !event.bookingId || !event.templateKey || !event.to) {
      summary.skipped += 1;
      continue;
    }

    let correlationKey = event.deliveryCorrelationKey;
    if (!correlationKey) {
      try {
        correlationKey = bookingLifecycleCorrelationKey({
          bookingId: event.bookingId,
          templateKey: event.templateKey,
          recipientEmail: event.to
        });
      } catch {
        summary.skipped += 1;
        continue;
      }
    }

    const payload = {
      correlationKey,
      domain: 'booking_lifecycle',
      bookingId: event.bookingId,
      templateKey: event.templateKey,
      recipient: String(event.to).trim().toLowerCase(),
      sendStatus,
      lifecycleSource: event.lifecycleSource || 'automatic',
      emailEventId: event._id,
      errorMessage: event.errorMessage || null,
      actorId: event.actorId || null,
      actorRole: event.actorRole || null,
      skipManualReview: true
    };

    if (!apply) {
      summary.applied += 1;
      continue;
    }

    try {
      await applyEmailDeliveryAttempt(payload);
      summary.applied += 1;
    } catch (err) {
      summary.errors += 1;
      console.error('lifecycle backfill error:', {
        emailEventId: String(event._id),
        error: err.message
      });
    }
  }

  return summary;
}

async function rebuildFromGiftVoucherEvents({ apply }) {
  const events = await GiftVoucherEvent.find({
    type: { $in: ['sent', 'send_failed', 'resent'] }
  })
    .sort({ createdAt: 1 })
    .lean();

  const summary = {
    scanned: events.length,
    applied: 0,
    skipped: 0,
    errors: 0
  };

  for (const event of events) {
    const attempt = mapGiftVoucherEventToAttempt(event);
    if (!attempt) {
      summary.skipped += 1;
      continue;
    }

    if (!apply) {
      summary.applied += 1;
      continue;
    }

    try {
      await applyEmailDeliveryAttempt({
        ...attempt,
        skipManualReview: true
      });
      summary.applied += 1;
    } catch (err) {
      summary.errors += 1;
      console.error('gift voucher backfill error:', {
        giftVoucherEventId: String(event._id),
        error: err.message
      });
    }
  }

  return summary;
}

async function run() {
  const { apply } = parseArgs(process.argv);
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);

  const beforeStates = await EmailDeliveryState.countDocuments({});
  const lifecycleSummary = await rebuildFromLifecycleEmailEvents({ apply });
  const giftVoucherSummary = await rebuildFromGiftVoucherEvents({ apply });
  const afterStates = apply ? await EmailDeliveryState.countDocuments({}) : beforeStates;
  const activeFailed = apply
    ? await EmailDeliveryState.countDocuments({ latestStatus: 'failed' })
    : null;

  const report = {
    mode: apply ? 'apply' : 'dry-run',
    beforeStates,
    afterStates,
    activeFailedAfter: activeFailed,
    lifecycle: lifecycleSummary,
    giftVoucher: giftVoucherSummary
  };

  console.log(JSON.stringify(report, null, 2));

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to write EmailDeliveryState rows.');
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
