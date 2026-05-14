'use strict';

/**
 * Guest message automation — OPS read models (Batch 10A, read-only).
 *
 * No writes, no env secret leakage, no dispatcher/orchestrator/scheduler imports.
 */

const mongoose = require('mongoose');
const MessageAutomationRule = require('../../../models/MessageAutomationRule');
const MessageTemplate = require('../../../models/MessageTemplate');
const ScheduledMessageJob = require('../../../models/ScheduledMessageJob');
const MessageDispatch = require('../../../models/MessageDispatch');
const MessageDeliveryEvent = require('../../../models/MessageDeliveryEvent');
const ManualReviewItem = require('../../../models/ManualReviewItem');
const Booking = require('../../../models/Booking');

const COMMS_CATEGORY_PREFIX = /^comms_/;

function envFlagIsOne(name) {
  return String(process.env[name] || '').trim() === '1';
}

/**
 * Mask email to `a***@example.com` or phone-like `+359...` to `***0000`.
 */
function maskRecipient(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.includes('@')) {
    const [local, domain] = s.split('@');
    if (!domain) return '***';
    const first = local.length > 0 ? local[0] : '?';
    return `${first}***@${domain}`;
  }
  if (s.startsWith('+') && s.length > 5) {
    return `***${s.slice(-4)}`;
  }
  return '***';
}

function getMessagingSystemStateReadModel() {
  return {
    dispatcherEnabled: envFlagIsOne('MESSAGE_DISPATCHER_ENABLED'),
    schedulerWorkerEnabled: envFlagIsOne('MESSAGE_SCHEDULER_WORKER_ENABLED'),
    emailProviderEnabled: envFlagIsOne('MESSAGE_EMAIL_PROVIDER_ENABLED'),
    explanations: {
      schedulerVsDirectDispatcher:
        'The scheduler worker flag controls whether scheduled jobs are claimed and handed to the dispatcher on the normal queue path. Real sends can still occur if code invokes the dispatcher directly (for example in tests) while the dispatcher and email provider flags are on; the scheduler flag is not the only gate.',
      emailProvider:
        'When the email provider flag is off, the automation email channel uses the internal shadow provider only, even if the dispatcher runs.',
      dispatcher:
        'When the dispatcher flag is off, claimed jobs are not processed by the message dispatcher; they remain claimed until reclaimed by the worker visibility timeout.'
    }
  };
}

async function resolveTemplateReadinessForChannel({ templateKey, channel, propertyScope }) {
  if (!templateKey || typeof templateKey !== 'string') {
    return 'missing';
  }
  const propertyKind = propertyScope === 'any' ? 'any' : propertyScope;
  const approved = await MessageTemplate.findOne({
    key: templateKey,
    channel,
    locale: 'en',
    propertyKind,
    status: 'approved'
  })
    .sort({ version: -1 })
    .select('_id version')
    .lean();
  if (approved) return 'approved';
  const draft = await MessageTemplate.findOne({
    key: templateKey,
    channel,
    locale: 'en',
    propertyKind,
    status: 'draft'
  })
    .sort({ version: -1 })
    .select('_id')
    .lean();
  if (draft) return 'draft';
  return 'missing';
}

async function getMessagingRulesWithTemplateReadiness() {
  const rules = await MessageAutomationRule.find({}).sort({ ruleKey: 1 }).lean();
  const items = [];
  for (const r of rules) {
    const keys = r.templateKeyByChannel && typeof r.templateKeyByChannel === 'object'
      ? r.templateKeyByChannel
      : {};
    const channels = ['whatsapp', 'email'];
    const templateReadinessByChannel = {};
    for (const ch of channels) {
      templateReadinessByChannel[ch] = await resolveTemplateReadinessForChannel({
        templateKey: keys[ch],
        channel: ch,
        propertyScope: r.propertyScope
      });
    }
    items.push({
      ruleKey: r.ruleKey,
      enabled: Boolean(r.enabled),
      mode: r.mode,
      audience: r.audience,
      propertyScope: r.propertyScope,
      channelStrategy: r.channelStrategy,
      triggerType: r.triggerType,
      triggerConfig: r.triggerConfig || {},
      templateKeyByChannel: keys,
      templateReadinessByChannel,
      updatedAt: r.updatedAt || null
    });
  }
  return { rules: items };
}

async function loadDeliverySummariesByDispatchId(bookingObjectId) {
  const rows = await MessageDeliveryEvent.aggregate([
    { $match: { bookingId: bookingObjectId } },
    { $sort: { occurredAt: -1 } },
    {
      $group: {
        _id: '$dispatchId',
        deliveryEventCount: { $sum: 1 },
        latestEventType: { $first: '$eventType' },
        latestOccurredAt: { $first: '$occurredAt' }
      }
    }
  ]);
  const map = new Map();
  for (const row of rows) {
    if (row._id) map.set(String(row._id), row);
  }
  return map;
}

async function getReservationMessagingSummary(reservationId) {
  if (!mongoose.isValidObjectId(reservationId)) return null;
  const booking = await Booking.findById(reservationId).select('_id isTest archivedAt').lean();
  if (!booking || booking.isTest || booking.archivedAt) return null;

  const bookingObjectId = booking._id;
  const bookingIdStr = String(bookingObjectId);

  const [jobs, dispatches, deliveryMap] = await Promise.all([
    ScheduledMessageJob.find({ bookingId: bookingObjectId })
      .sort({ scheduledFor: 1 })
      .limit(200)
      .lean(),
    MessageDispatch.find({ bookingId: bookingObjectId })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean(),
    loadDeliverySummariesByDispatchId(bookingObjectId)
  ]);

  const jobIdStrs = jobs.map((j) => String(j._id));

  const mriOr = [{ 'evidence.bookingId': bookingIdStr }];
  if (jobIdStrs.length > 0) {
    mriOr.push({ entityType: 'ScheduledMessageJob', entityId: { $in: jobIdStrs } });
  }
  const manualReviewItems = await ManualReviewItem.find({
    status: 'open',
    category: COMMS_CATEGORY_PREFIX,
    $or: mriOr
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const manualReviewDtos = manualReviewItems.map((item) => ({
    manualReviewItemId: String(item._id),
    category: item.category,
    severity: item.severity,
    status: item.status,
    title: item.title,
    details: item.details || '',
    entityType: item.entityType || null,
    entityId: item.entityId || null,
    evidence: item.evidence || {},
    createdAt: item.createdAt || null
  }));

  const jobDtos = jobs.map((j) => ({
    jobId: String(j._id),
    ruleKey: j.ruleKey,
    scheduledFor: j.scheduledFor,
    status: j.status,
    attemptCount: j.attemptCount,
    maxAttempts: j.maxAttempts,
    lastError: j.lastError || null,
    audience: j.audience,
    propertyKind: j.propertyKind,
    cancelReason: j.cancelReason || null,
    cancelActor: j.cancelActor || null,
    createdAt: j.createdAt || null,
    updatedAt: j.updatedAt || null
  }));

  const dispatchDtos = dispatches.map((d) => {
    const del = d._id ? deliveryMap.get(String(d._id)) : null;
    return {
      dispatchId: String(d._id),
      scheduledMessageJobId: d.scheduledMessageJobId ? String(d.scheduledMessageJobId) : null,
      channel: d.channel,
      status: d.status,
      ruleKey: d.ruleKey || null,
      templateKey: d.templateKey || null,
      templateVersion: d.templateVersion,
      providerName: d.providerName,
      providerMessageId: d.providerMessageId || null,
      recipientMasked: maskRecipient(d.recipient),
      idempotencyKey: d.idempotencyKey || null,
      error: d.error || null,
      details: d.details || {},
      createdAt: d.createdAt || null,
      updatedAt: d.updatedAt || null,
      deliveryEventCount: del ? del.deliveryEventCount : 0,
      latestDeliveryEvent: del
        ? {
            eventType: del.latestEventType,
            occurredAt: del.latestOccurredAt
          }
        : null
    };
  });

  return {
    bookingId: bookingIdStr,
    jobs: jobDtos,
    dispatches: dispatchDtos,
    manualReviewItems: manualReviewDtos
  };
}

async function getDeliveryEventsForDispatch(dispatchId) {
  if (!mongoose.isValidObjectId(dispatchId)) return null;
  const dispatchObjectId = new mongoose.Types.ObjectId(dispatchId);
  const events = await MessageDeliveryEvent.find({ dispatchId: dispatchObjectId })
    .sort({ occurredAt: -1 })
    .limit(100)
    .lean();

  return {
    dispatchId: String(dispatchId),
    events: events.map((e) => ({
      messageDeliveryEventId: String(e._id),
      eventType: e.eventType,
      isTerminal: Boolean(e.isTerminal),
      provider: e.provider,
      channel: e.channel,
      providerEventId: e.providerEventId,
      providerMessageId: e.providerMessageId || null,
      occurredAt: e.occurredAt,
      payload: e.payload || {}
    }))
  };
}

module.exports = {
  getMessagingSystemStateReadModel,
  getMessagingRulesWithTemplateReadiness,
  getReservationMessagingSummary,
  getDeliveryEventsForDispatch,
  maskRecipient,
  __internals: { envFlagIsOne, resolveTemplateReadinessForChannel, COMMS_CATEGORY_PREFIX }
};
