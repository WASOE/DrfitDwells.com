'use strict';

function isVapidConfigured() {
  const publicKey = String(process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '').trim();
  const subject = String(process.env.WEB_PUSH_VAPID_SUBJECT || '').trim();
  return Boolean(publicKey && privateKey && subject);
}

function getVapidConfig() {
  if (!isVapidConfigured()) {
    return null;
  }
  return {
    publicKey: String(process.env.WEB_PUSH_VAPID_PUBLIC_KEY).trim(),
    privateKey: String(process.env.WEB_PUSH_VAPID_PRIVATE_KEY).trim(),
    subject: String(process.env.WEB_PUSH_VAPID_SUBJECT).trim()
  };
}

module.exports = {
  isVapidConfigured,
  getVapidConfig
};
