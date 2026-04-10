const metaUserData = require('./metaUserData');
const { normalizeEmail, buildMetaPurchaseUserData, isMetaCapiPurchaseEnriched } = metaUserData;

/**
 * Meta Conversions API — Purchase once per booking (dedup with Pixel via event_id).
 * Requires META_PIXEL_ID + META_CAPI_ACCESS_TOKEN (system user token with ads_management).
 *
 * When META_CAPI_PURCHASE_ENRICHED=1, sends ph/fn/ln/fbp/fbc and event_source_url (from booking metaClientContext).
 *
 * When META_TEST_EVENT_CODE is set, adds top-level test_event_code to the Graph payload (Test Events only; unset in prod).
 */

/**
 * @param {object} opts
 * @param {string} opts.eventId - shared with browser fbq for deduplication
 * @param {string} opts.email - guest email
 * @param {string} [opts.phone]
 * @param {string} [opts.firstName]
 * @param {string} [opts.lastName]
 * @param {number} opts.value - purchase value
 * @param {string} opts.currency - ISO currency e.g. EUR
 * @param {string} [opts.clientIp]
 * @param {string} [opts.userAgent]
 * @param {string} [opts.eventSourceUrl] - checkout page URL captured at booking create
 * @param {string} [opts.fbp]
 * @param {string} [opts.fbc]
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

  const enriched = isMetaCapiPurchaseEnriched();
  const eventTime = Math.floor(Date.now() / 1000);
  const userData = buildMetaPurchaseUserData({
    email: opts.email,
    phone: opts.phone,
    firstName: opts.firstName,
    lastName: opts.lastName,
    clientIp: opts.clientIp,
    userAgent: opts.userAgent,
    fbp: opts.fbp,
    fbc: opts.fbc,
    enriched
  });

  const eventPayload = {
    event_name: 'Purchase',
    event_time: eventTime,
    event_id: opts.eventId,
    action_source: 'website',
    user_data: userData,
    custom_data: {
      currency: String(opts.currency || 'EUR').toUpperCase(),
      value: String(Number(opts.value).toFixed(2))
    }
  };

  if (enriched && opts.eventSourceUrl) {
    eventPayload.event_source_url = String(opts.eventSourceUrl).slice(0, 2000);
  }

  const body = {
    data: [eventPayload]
  };

  const testEventCode =
    typeof process.env.META_TEST_EVENT_CODE === 'string'
      ? process.env.META_TEST_EVENT_CODE.trim().slice(0, 64)
      : '';
  if (testEventCode) {
    body.test_event_code = testEventCode;
  }

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

module.exports = {
  sendPurchaseEvent,
  sha256Hex: metaUserData.sha256Hex,
  normalizeEmail: metaUserData.normalizeEmail
};
