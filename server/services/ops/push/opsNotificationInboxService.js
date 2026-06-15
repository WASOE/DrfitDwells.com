'use strict';

const mongoose = require('mongoose');
const OpsNotification = require('../../../models/OpsNotification');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const PUBLIC_FIELDS = 'title body url source readAt createdAt';

function clampLimit(limit) {
  const n = Number.parseInt(String(limit), 10);
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(n, MAX_LIMIT);
}

function serializeNotification(doc) {
  return {
    id: String(doc._id),
    title: doc.title,
    body: doc.body,
    url: doc.url,
    source: doc.source ?? null,
    readAt: doc.readAt ?? null,
    createdAt: doc.createdAt
  };
}

function parseCursor(cursor) {
  if (!cursor || typeof cursor !== 'string') {
    return null;
  }
  const trimmed = cursor.trim();
  const sep = trimmed.lastIndexOf('_');
  if (sep <= 0) {
    return null;
  }
  const ts = Number(trimmed.slice(0, sep));
  const id = trimmed.slice(sep + 1);
  if (!Number.isFinite(ts) || !mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }
  return {
    createdAt: new Date(ts),
    id: new mongoose.Types.ObjectId(id)
  };
}

function encodeCursor(doc) {
  return `${new Date(doc.createdAt).getTime()}_${doc._id}`;
}

function buildListFilter({ opsUserId, cursor, unreadOnly }) {
  const filter = { opsUserId };
  if (unreadOnly) {
    filter.readAt = null;
  }
  const parsed = parseCursor(cursor);
  if (parsed) {
    filter.$or = [
      { createdAt: { $lt: parsed.createdAt } },
      { createdAt: parsed.createdAt, _id: { $lt: parsed.id } }
    ];
  }
  return filter;
}

async function listNotificationsForUser({
  opsUserId,
  limit = DEFAULT_LIMIT,
  cursor = null,
  unreadOnly = false
}) {
  const cap = clampLimit(limit);
  const filter = buildListFilter({ opsUserId, cursor, unreadOnly });
  const docs = await OpsNotification.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(cap + 1)
    .select(PUBLIC_FIELDS)
    .lean();

  let nextCursor = null;
  let page = docs;
  if (docs.length > cap) {
    page = docs.slice(0, cap);
    nextCursor = encodeCursor(page[page.length - 1]);
  }

  return {
    notifications: page.map(serializeNotification),
    nextCursor
  };
}

async function getUnreadNotificationCount({ opsUserId }) {
  const unreadCount = await OpsNotification.countDocuments({
    opsUserId,
    readAt: null
  });
  return { unreadCount };
}

async function markNotificationRead({ opsUserId, notificationId }) {
  if (!mongoose.Types.ObjectId.isValid(String(notificationId))) {
    const err = new Error('Notification not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }

  const now = new Date();
  const updated = await OpsNotification.findOneAndUpdate(
    { _id: notificationId, opsUserId },
    { $set: { readAt: now } },
    { new: true }
  )
    .select(PUBLIC_FIELDS)
    .lean();

  if (!updated) {
    const err = new Error('Notification not found');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }

  return serializeNotification(updated);
}

async function markAllNotificationsRead({ opsUserId }) {
  const now = new Date();
  const res = await OpsNotification.updateMany(
    { opsUserId, readAt: null },
    { $set: { readAt: now } }
  );
  return { modifiedCount: res.modifiedCount || 0 };
}

module.exports = {
  listNotificationsForUser,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  DEFAULT_LIMIT,
  MAX_LIMIT
};
