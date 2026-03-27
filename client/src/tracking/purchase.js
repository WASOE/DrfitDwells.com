/**
 * Browser-side purchase signals after server POST /bookings/:id/purchase-tracking succeeds.
 * Uses same event_id as Meta CAPI for deduplication.
 * @param {object} data — server payload: event_id, transaction_id, value, currency, items
 * @param {{ analytics: boolean; ads: boolean }} consent
 */
export function fireBrowserPurchase(data, consent) {
  if (typeof window === 'undefined' || !data?.transaction_id) return;

  const { transaction_id, value, currency, items, event_id } = data;

  if (consent.analytics) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ ecommerce: null });
    window.dataLayer.push({
      event: 'purchase',
      ecommerce: {
        transaction_id,
        value: Number(value),
        currency: currency || 'EUR',
        items: Array.isArray(items) ? items : []
      }
    });
  }

  if (consent.ads && typeof window.fbq === 'function' && event_id) {
    window.fbq(
      'track',
      'Purchase',
      {
        value: Number(value),
        currency: currency || 'EUR'
      },
      { eventID: event_id }
    );
  }
}
