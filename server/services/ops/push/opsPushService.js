'use strict';

const mongoose = require('mongoose');
const OpsUser = require('../../../models/OpsUser');
const OpsPushSubscription = require('../../../models/OpsPushSubscription');
const OpsNotification = require('../../../models/OpsNotification');
const { listAssignedCleanersForPropertyKind } = require('../../messaging/cleanerRecipientResolver');
const { isVapidConfigured, getVapidConfig } = require('./opsPushVapidConfig');

const OPS_PUSH_DELIVERY_OPTIONS = Object.freeze({
  TTL: 86400,
  urgency: 'high'
});

const OPS_PUSH_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

let webPushModule = null;
let webPushConfigured = false;
let logSendAttemptImpl = logSendAttemptDefault;

function logSendAttemptDefault(fields) {
  console.log(
    JSON.stringify({
      source: 'ops-push',
      phase: 'send_attempt',
      ...fields
    })
  );
}

function __setLogSendAttemptForTesting(fn) {
  logSendAttemptImpl = typeof fn === 'function' ? fn : logSendAttemptDefault;
}

function __resetLogSendAttemptForTesting() {
  logSendAttemptImpl = logSendAttemptDefault;
}

function getWebPushModule() {
  if (!webPushModule) {
    // eslint-disable-next-line global-require
    webPushModule = require('web-push');
  }
  return webPushModule;
}

function ensureWebPushConfigured() {
  if (webPushConfigured) {
    return true;
  }
  const vapid = getVapidConfig();
  if (!vapid) {
    return false;
  }
  const webpush = getWebPushModule();
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  webPushConfigured = true;
  return true;
}

function __resetWebPushForTesting() {
  webPushModule = null;
  webPushConfigured = false;
}

function __setWebPushModuleForTesting(module) {
  webPushModule = module;
  webPushConfigured = false;
}

function normalizeObjectIds(ids) {
  if (!Array.isArray(ids)) {
    return [];
  }
  return ids
    .map((id) => {
      if (id instanceof mongoose.Types.ObjectId) {
        return id;
      }
      if (mongoose.Types.ObjectId.isValid(String(id))) {
        return new mongoose.Types.ObjectId(String(id));
      }
      return null;
    })
    .filter(Boolean);
}

async function resolveTargetUserIds({ opsUserIds, role, propertyKind }) {
  const explicit = normalizeObjectIds(opsUserIds);
  if (explicit.length > 0) {
    return explicit;
  }

  if (role === 'admin') {
    const admins = await OpsUser.find({ role: 'admin', isActive: { $ne: false } })
      .select('_id')
      .lean();
    return admins.map((row) => row._id);
  }

  if (role === 'cleaner') {
    if (!propertyKind) {
      return [];
    }
    const cleaners = await listAssignedCleanersForPropertyKind(propertyKind);
    return cleaners.map((row) => row._id);
  }

  return [];
}

function isConfirmedDeliveryWithinWindow(notification, now = Date.now()) {
  if (!notification || notification.pushDeliveryStatus !== 'delivered' || !notification.pushDeliveredAt) {
    return false;
  }
  const deliveredAt = new Date(notification.pushDeliveredAt).getTime();
  if (!Number.isFinite(deliveredAt)) return false;
  return now - deliveredAt >= 0 && now - deliveredAt < OPS_PUSH_DEDUPE_WINDOW_MS;
}

async function markPushDelivery(notificationId, outcome) {
  if (!notificationId) return;
  const now = new Date();
  const status =
    outcome === 'delivered' || outcome === 'no_subscription' || outcome === 'provider_failure'
      ? outcome
      : 'provider_failure';
  const update = {
    pushDeliveryStatus: status,
    pushAttemptedAt: now
  };
  if (status === 'delivered') update.pushDeliveredAt = now;
  await OpsNotification.updateOne({ _id: notificationId }, { $set: update });
}

async function createNotificationForUser({
  opsUserId,
  title,
  body,
  url,
  source,
  dedupeKey
}) {
  const payload = {
    opsUserId,
    title: String(title || '').slice(0, 200),
    body: String(body || '').slice(0, 2000),
    url: String(url || '').slice(0, 2048),
    source: source ? String(source).slice(0, 120) : null,
    pushDeliveryStatus: 'pending'
  };

  if (dedupeKey != null && String(dedupeKey).trim() !== '') {
    payload.dedupeKey = String(dedupeKey).trim();
    try {
      const created = await OpsNotification.create(payload);
      return { notification: created, duplicate: false };
    } catch (err) {
      if (err && err.code === 11000) {
        const existing = await OpsNotification.findOne({
          opsUserId,
          dedupeKey: payload.dedupeKey
        });
        return { notification: existing, duplicate: true };
      }
      throw err;
    }
  }

  const created = await OpsNotification.create(payload);
  return { notification: created, duplicate: false };
}

async function loadActiveSubscriptions(opsUserId) {
  return OpsPushSubscription.find({
    opsUserId,
    invalidatedAt: null
  }).lean();
}

async function pushToSubscription({ subscription, title, body, url, tag }) {
  const webpush = getWebPushModule();
  const pushSubscription = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth
    }
  };
  const payload = JSON.stringify({
    title,
    body,
    url,
    tag: tag || undefined
  });

  await webpush.sendNotification(pushSubscription, payload, OPS_PUSH_DELIVERY_OPTIONS);
  await OpsPushSubscription.updateOne(
    { _id: subscription._id },
    { $set: { lastSuccessAt: new Date() } }
  );
  return { ok: true, subscriptionId: String(subscription._id) };
}

function logPushSendAttempt({
  outcome,
  sourceEvent,
  subscriptionId,
  opsUserId,
  statusCode,
  dedupeKey,
  skipReason,
  priorDeliveryConfirmed,
  priorDeliveredAt
}) {
  logSendAttemptImpl({
    outcome,
    sourceEvent: sourceEvent || null,
    subscriptionId: subscriptionId || null,
    opsUserId: opsUserId ? String(opsUserId) : null,
    statusCode: statusCode ?? null,
    dedupeKey: dedupeKey || null,
    ...(skipReason ? { skipReason } : {}),
    ...(priorDeliveryConfirmed === true ? { priorDeliveryConfirmed: true } : {}),
    ...(priorDeliveredAt ? { priorDeliveredAt } : {})
  });
}

async function pushToSubscriptionSafe({
  subscription,
  title,
  body,
  url,
  tag,
  sourceEvent,
  dedupeKey,
  opsUserId
}) {
  const subscriptionId = String(subscription._id);
  try {
    const result = await pushToSubscription({ subscription, title, body, url, tag });
    logPushSendAttempt({
      outcome: 'accepted',
      sourceEvent,
      subscriptionId,
      opsUserId,
      dedupeKey
    });
    return result;
  } catch (err) {
    const statusCode = err?.statusCode || err?.status;
    if (statusCode === 410) {
      await OpsPushSubscription.updateOne(
        { _id: subscription._id },
        { $set: { invalidatedAt: new Date() } }
      );
      logPushSendAttempt({
        outcome: 'invalidated',
        sourceEvent,
        subscriptionId,
        opsUserId,
        statusCode: 410,
        dedupeKey
      });
      return {
        ok: false,
        subscriptionId,
        statusCode: 410,
        invalidated: true,
        error: err?.message || 'subscription_gone'
      };
    }
    logPushSendAttempt({
      outcome: 'failed',
      sourceEvent,
      subscriptionId,
      opsUserId,
      statusCode: statusCode || null,
      dedupeKey
    });
    return {
      ok: false,
      subscriptionId,
      statusCode: statusCode || null,
      invalidated: false,
      error: err?.message || String(err)
    };
  }
}

/**
 * @param {object} params
 * @param {import('mongoose').Types.ObjectId[]|string[]} [params.opsUserIds]
 * @param {'admin'|'cleaner'} [params.role]
 * @param {'cabin'|'valley'} [params.propertyKind]
 * @param {string} params.title
 * @param {string} params.body
 * @param {string} params.url
 * @param {string} [params.tag]
 * @param {string} [params.dedupeKey]
 * @param {string} [params.source]
 */
async function sendOpsPush(params = {}) {
  if (!isVapidConfigured()) {
    return {
      skipped: true,
      reason: 'vapid_not_configured',
      usersTargeted: 0,
      notificationsCreated: 0,
      pushAttempts: 0,
      pushAccepted: 0,
      pushFailed: 0,
      subscriptionsInvalidated: 0
    };
  }

  if (!ensureWebPushConfigured()) {
    return {
      skipped: true,
      reason: 'vapid_not_configured',
      usersTargeted: 0,
      notificationsCreated: 0,
      pushAttempts: 0,
      pushAccepted: 0,
      pushFailed: 0,
      subscriptionsInvalidated: 0
    };
  }

  const {
    opsUserIds,
    role,
    propertyKind,
    title,
    body,
    url,
    tag,
    dedupeKey,
    source
  } = params;

  if (!title || !body || !url) {
    const err = new Error('title, body, and url are required');
    err.code = 'VALIDATION';
    throw err;
  }

  const explicitUserIds = normalizeObjectIds(opsUserIds);
  if (role === 'cleaner' && !propertyKind && explicitUserIds.length === 0) {
    return {
      skipped: true,
      reason: 'cleaner_property_kind_required',
      usersTargeted: 0,
      notificationsCreated: 0,
      pushAttempts: 0,
      pushAccepted: 0,
      pushFailed: 0,
      subscriptionsInvalidated: 0
    };
  }

  const targetUserIds =
    explicitUserIds.length > 0
      ? explicitUserIds
      : await resolveTargetUserIds({ opsUserIds, role, propertyKind });
  const summary = {
    skipped: false,
    usersTargeted: targetUserIds.length,
    notificationsCreated: 0,
    notificationsDeduped: 0,
    deliveryRetried: 0,
    pushAttempts: 0,
    pushAccepted: 0,
    pushFailed: 0,
    subscriptionsInvalidated: 0,
    deliveryOutcome: null,
    results: []
  };

  if (targetUserIds.length === 0) {
    summary.deliveryOutcome = 'no_subscription';
    logPushSendAttempt({
      outcome: 'no_subscription',
      sourceEvent: source,
      dedupeKey,
      skipReason: 'no_subscription'
    });
    return summary;
  }

  for (const opsUserId of targetUserIds) {
    const created = await createNotificationForUser({
      opsUserId,
      title,
      body,
      url,
      source,
      dedupeKey
    });
    const notification = created.notification;

    if (created.duplicate && isConfirmedDeliveryWithinWindow(notification)) {
      summary.notificationsDeduped += 1;
      logPushSendAttempt({
        outcome: 'skipped',
        sourceEvent: source,
        opsUserId,
        dedupeKey,
        skipReason: 'deduped',
        priorDeliveryConfirmed: true,
        priorDeliveredAt: new Date(notification.pushDeliveredAt).toISOString()
      });
      summary.results.push({
        opsUserId: String(opsUserId),
        notificationCreated: false,
        deduped: true,
        priorDeliveryConfirmed: true,
        deliveryOutcome: 'deduped',
        pushAttempts: 0
      });
      continue;
    }

    if (created.duplicate && !notification) {
      logPushSendAttempt({
        outcome: 'dedupe_unconfirmed',
        sourceEvent: source,
        opsUserId,
        dedupeKey,
        priorDeliveryConfirmed: false
      });
      summary.results.push({
        opsUserId: String(opsUserId),
        notificationCreated: false,
        deduped: false,
        priorDeliveryConfirmed: false,
        deliveryOutcome: 'dedupe_unconfirmed',
        pushAttempts: 0
      });
      continue;
    }

    if (created.duplicate) {
      summary.deliveryRetried += 1;
    } else {
      summary.notificationsCreated += 1;
    }

    const subscriptions = await loadActiveSubscriptions(opsUserId);
    const userResult = {
      opsUserId: String(opsUserId),
      notificationId: notification?._id ? String(notification._id) : null,
      notificationCreated: !created.duplicate,
      deduped: false,
      priorDeliveryConfirmed: false,
      pushAttempts: subscriptions.length,
      pushAccepted: 0,
      pushFailed: 0,
      subscriptionsInvalidated: 0
    };

    for (const subscription of subscriptions) {
      summary.pushAttempts += 1;
      const attempt = await pushToSubscriptionSafe({
        subscription,
        title,
        body,
        url,
        tag,
        sourceEvent: source,
        dedupeKey,
        opsUserId
      });
      if (attempt.ok) {
        summary.pushAccepted += 1;
        userResult.pushAccepted += 1;
      } else {
        summary.pushFailed += 1;
        userResult.pushFailed += 1;
        if (attempt.invalidated) {
          summary.subscriptionsInvalidated += 1;
          userResult.subscriptionsInvalidated += 1;
        }
      }
    }

    let deliveryOutcome = 'provider_failure';
    if (subscriptions.length === 0) {
      deliveryOutcome = 'no_subscription';
    } else if (userResult.pushAccepted > 0) {
      deliveryOutcome = 'delivered';
    }
    userResult.deliveryOutcome = deliveryOutcome;
    await markPushDelivery(notification?._id, deliveryOutcome);
    if (deliveryOutcome === 'no_subscription') {
      logPushSendAttempt({
        outcome: 'no_subscription',
        sourceEvent: source,
        opsUserId,
        dedupeKey,
        priorDeliveryConfirmed: false
      });
    }
    summary.results.push(userResult);
  }

  summary.deliveryOutcome = rollupDeliveryOutcome(summary.results);
  return summary;
}

function rollupDeliveryOutcome(results) {
  if (!results.length) return 'no_subscription';
  if (results.every((row) => row.deliveryOutcome === 'deduped')) return 'deduped';
  if (results.some((row) => row.deliveryOutcome === 'delivered')) return 'delivered';
  if (results.some((row) => row.deliveryOutcome === 'provider_failure')) return 'provider_failure';
  if (results.some((row) => row.deliveryOutcome === 'no_subscription')) return 'no_subscription';
  if (results.some((row) => row.deliveryOutcome === 'dedupe_unconfirmed')) return 'dedupe_unconfirmed';
  return results[0].deliveryOutcome || 'provider_failure';
}

function sendOpsPushSafely(params) {
  return Promise.resolve()
    .then(() => sendOpsPush(params))
    .catch((err) => {
      console.error(
        JSON.stringify({
          source: 'ops-push',
          phase: 'send_failed',
          sourceEvent: params?.source || null,
          dedupeKey: params?.dedupeKey || null,
          error: err?.message || String(err)
        })
      );
      return {
        skipped: false,
        error: true,
        deliveryOutcome: 'provider_failure',
        message: err?.message || String(err)
      };
    });
}

module.exports = {
  sendOpsPush,
  sendOpsPushSafely,
  resolveTargetUserIds,
  OPS_PUSH_DELIVERY_OPTIONS,
  OPS_PUSH_DEDUPE_WINDOW_MS,
  isConfirmedDeliveryWithinWindow,
  __resetWebPushForTesting,
  __setWebPushModuleForTesting,
  __setLogSendAttemptForTesting,
  __resetLogSendAttemptForTesting,
  __ensureWebPushConfiguredForTesting: ensureWebPushConfigured
};
