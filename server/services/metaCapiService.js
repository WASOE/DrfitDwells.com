const crypto = require('crypto');

/**
 * Meta Conversions API — Purchase once per booking (dedup with Pixel via event_id).
 * Requires META_PIXEL_ID + META_CAPI_ACCESS_TOKEN (system user token with ads_management).
 */
function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

/**
 * @param {object} opts
 * @param {string} opts.eventId - shared with browser fbq for deduplication
 * @param {string} opts.email - guest email (hashed per Meta)
 * @param {number} opts.value - purchase value
 * @param {string} opts.currency - ISO currency e.g. EUR
 * @param {string} [opts.clientIp]
 * @param {string} [opts.userAgent]
 */
async function sendPurchaseEvent(opts) {
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_ACCESS_TOKEN;
  if (!pixelId || !token) {
    return { ok: false, skipped: true, reason: 'META_PIXEL_ID or META_CAPI_ACCESS_TOKEN not set' };
  }

  const email = normalizeEmail(opts.email);
  if (!email) {
    return { ok: false, skipped: true, reason: 'missing email' };
  }

  const eventTime = Math.floor(Date.now() / 1000);
  const userData = {
    em: [sha256Hex(email)]
  };
  if (opts.clientIp) userData.client_ip_address = String(opts.clientIp).slice(0, 45);
  if (opts.userAgent) userData.client_user_agent = String(opts.userAgent).slice(0, 512);

  const body = {
    data: [
      {
        event_name: 'Purchase',
        event_time: eventTime,
        event_id: opts.eventId,
        action_source: 'website',
        user_data: userData,
        custom_data: {
          currency: String(opts.currency || 'EUR').toUpperCase(),
          value: String(Number(opts.value).toFixed(2))
        }
      }
    ]
  };

  const version = process.env.META_CAPI_GRAPH_VERSION || 'v21.0';
  const url = `https://graph.facebook.com/${version}/${pixelId}/events?access_token=${encodeURIComponent(token)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[meta-capi] Purchase error', res.status, json);
    return { ok: false, skipped: false, status: res.status, body: json };
  }

  return { ok: true, skipped: false, body: json };
}

module.exports = { sendPurchaseEvent, sha256Hex, normalizeEmail };
