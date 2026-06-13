'use strict';

const mongoose = require('mongoose');
const OpsPushSubscription = require('../../../models/OpsPushSubscription');

function requireSessionOpsUserId(user) {
  const id = user?.id;
  if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
    const err = new Error('Push subscriptions require an OPS user account');
    err.code = 'OPS_USER_ID_REQUIRED';
    err.status = 403;
    throw err;
  }
  return new mongoose.Types.ObjectId(String(id));
}

function normalizeSubscriptionInput(body) {
  const endpoint = String(body?.endpoint || '').trim();
  const p256dh = String(body?.keys?.p256dh || '').trim();
  const auth = String(body?.keys?.auth || '').trim();

  if (!endpoint) {
    const err = new Error('endpoint is required');
    err.code = 'VALIDATION';
    err.status = 400;
    throw err;
  }
  if (!p256dh || !auth) {
    const err = new Error('keys.p256dh and keys.auth are required');
    err.code = 'VALIDATION';
    err.status = 400;
    throw err;
  }

  return {
    endpoint,
    keys: { p256dh, auth }
  };
}

async function registerPushSubscription({ opsUserId, body, userAgent = null }) {
  const normalized = normalizeSubscriptionInput(body);
  const ua = userAgent ? String(userAgent).slice(0, 512) : null;

  const existing = await OpsPushSubscription.findOne({ endpoint: normalized.endpoint });
  if (existing) {
    if (String(existing.opsUserId) !== String(opsUserId)) {
      const err = new Error('Subscription endpoint is registered to another user');
      err.code = 'SUBSCRIPTION_OWNERSHIP_CONFLICT';
      err.status = 409;
      throw err;
    }
    existing.keys = normalized.keys;
    existing.userAgent = ua;
    existing.invalidatedAt = null;
    await existing.save();
    return existing;
  }

  return OpsPushSubscription.create({
    opsUserId,
    endpoint: normalized.endpoint,
    keys: normalized.keys,
    userAgent: ua,
    invalidatedAt: null
  });
}

async function deletePushSubscriptionForUser({ subscriptionId, opsUserId }) {
  if (!mongoose.Types.ObjectId.isValid(String(subscriptionId))) {
    const err = new Error('Invalid subscription id');
    err.code = 'VALIDATION';
    err.status = 400;
    throw err;
  }

  const deleted = await OpsPushSubscription.findOneAndDelete({
    _id: subscriptionId,
    opsUserId
  }).lean();

  if (!deleted) {
    const err = new Error('Push subscription not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }

  return deleted;
}

module.exports = {
  requireSessionOpsUserId,
  registerPushSubscription,
  deletePushSubscriptionForUser
};
