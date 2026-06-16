'use strict';

const OpsPushSubscription = require('../../../models/OpsPushSubscription');
const OpsPushScheduledJob = require('../../../models/OpsPushScheduledJob');
const { isVapidConfigured } = require('./opsPushVapidConfig');
const { getOpsPushSchedulerWorkerState } = require('./opsPushSchedulerWorker');

const ENV_SCHEDULED_FLAG = 'OPS_PUSH_SCHEDULED_ENABLED';
const ENV_WORKER_FLAG = 'OPS_PUSH_SCHEDULER_WORKER_ENABLED';

function isEnvFlagEnabled(name) {
  return String(process.env[name] || '').trim() === '1';
}

function toIsoString(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

async function countSubscriptions() {
  const [active, invalidated, total] = await Promise.all([
    OpsPushSubscription.countDocuments({ invalidatedAt: null }),
    OpsPushSubscription.countDocuments({ invalidatedAt: { $ne: null } }),
    OpsPushSubscription.countDocuments({})
  ]);

  return {
    active,
    invalidated,
    total
  };
}

async function countScheduledJobsByStatus() {
  const rows = await OpsPushScheduledJob.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);

  const counts = {
    scheduled: 0,
    claimed: 0,
    sent: 0,
    failed: 0,
    canceled: 0,
    total: 0
  };

  for (const row of rows) {
    const status = row._id;
    const count = row.count || 0;
    counts.total += count;
    if (status === 'cancelled') {
      counts.canceled += count;
    } else if (
      status === 'scheduled' ||
      status === 'claimed' ||
      status === 'sent' ||
      status === 'failed'
    ) {
      counts[status] += count;
    }
  }

  return counts;
}

function buildWorkerHealth() {
  const workerState = getOpsPushSchedulerWorkerState();
  return {
    running: Boolean(workerState.running),
    startedAt: toIsoString(workerState.startedAt),
    lastTickAt: toIsoString(workerState.lastTickAt),
    lastTickError: workerState.lastTickError || null,
    lastSweepAt: toIsoString(workerState.lastSweepAt),
    lastSweepError: workerState.lastSweepError || null
  };
}

async function getOpsPushHealthReadModel() {
  const publicKey = String(process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '').trim();
  const [subscriptions, scheduledJobs] = await Promise.all([
    countSubscriptions(),
    countScheduledJobsByStatus()
  ]);

  return {
    pushEnabled: isVapidConfigured(),
    vapidPublicKeyPresent: Boolean(publicKey),
    scheduledEnabled: isEnvFlagEnabled(ENV_SCHEDULED_FLAG),
    workerEnabled: isEnvFlagEnabled(ENV_WORKER_FLAG),
    worker: buildWorkerHealth(),
    subscriptions,
    scheduledJobs
  };
}

module.exports = {
  getOpsPushHealthReadModel,
  countSubscriptions,
  countScheduledJobsByStatus,
  buildWorkerHealth
};
