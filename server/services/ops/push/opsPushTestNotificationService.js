'use strict';

const { sendOpsPushSafely } = require('./opsPushService');

const TEST_TITLE = 'OPS push test';
const TEST_BODY = 'Notifications are working for your device.';
const TEST_URL = '/ops';
const TEST_SOURCE = 'ops_push_test';
const TEST_TAG = 'ops-push-test';

function buildTestDedupeKey(opsUserId, now = new Date()) {
  const minute = now.toISOString().slice(0, 16);
  return `ops_push_test:${String(opsUserId)}:${minute}`;
}

function toSafeResult(result = {}) {
  if (result?.error) {
    return {
      success: false,
      error: true,
      message: result.message || 'send_failed',
      notificationsCreated: 0,
      notificationsDeduped: 0,
      pushAttempts: 0,
      pushAccepted: 0,
      pushFailed: 0,
      skipped: false,
      reason: null
    };
  }

  return {
    success: true,
    error: false,
    message: null,
    notificationsCreated: result.notificationsCreated || 0,
    notificationsDeduped: result.notificationsDeduped || 0,
    pushAttempts: result.pushAttempts || 0,
    pushAccepted: result.pushAccepted || 0,
    pushFailed: result.pushFailed || 0,
    skipped: Boolean(result.skipped),
    reason: result.reason || null
  };
}

async function sendOpsPushTestNotification({ opsUserId, now = new Date() }) {
  const dedupeKey = buildTestDedupeKey(opsUserId, now);
  const raw = await sendOpsPushSafely({
    opsUserIds: [opsUserId],
    title: TEST_TITLE,
    body: TEST_BODY,
    url: TEST_URL,
    tag: TEST_TAG,
    source: TEST_SOURCE,
    dedupeKey
  });

  const data = toSafeResult(raw);
  return {
    ...data,
    rateLimited: data.notificationsDeduped > 0
  };
}

module.exports = {
  TEST_TITLE,
  TEST_BODY,
  TEST_URL,
  TEST_SOURCE,
  buildTestDedupeKey,
  sendOpsPushTestNotification
};
