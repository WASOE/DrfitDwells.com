const browserPurchaseStorageKey = (transactionId) => `dd_purchase_browser_${transactionId}`;

/**
 * Browser-side purchase (GA4 dataLayer + Meta Pixel) for dedup with server CAPI via event_id.
 * Session-scoped idempotency: refresh on success page does not fire a second browser purchase.
 *
 * @param {object} data — event_id, transaction_id, value, currency, items (GA4 ecommerce shape)
 * @param {{ analytics: boolean; ads: boolean }} consent
 */
export function fireBrowserPurchase(data, consent) {
  if (typeof window === 'undefined' || !data?.transaction_id) return;

  const { transaction_id, value, currency, items, event_id } = data;
  const isoCurrency = String(currency || 'EUR').toUpperCase();

  try {
    if (sessionStorage.getItem(browserPurchaseStorageKey(transaction_id))) return;
  } catch {
    /* private mode / blocked */
  }

  const normalizedItems = Array.isArray(items)
    ? items.map((it, index) => ({
        ...it,
        index: typeof it.index === 'number' ? it.index : index,
        price: Number(it.price != null ? it.price : value),
        quantity: Number(it.quantity != null ? it.quantity : 1),
        currency: String(it.currency || isoCurrency).toUpperCase()
      }))
    : [];

  let didSignal = false;

  if (consent.analytics) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ ecommerce: null });
    window.dataLayer.push({
      event: 'purchase',
      ecommerce: {
        transaction_id,
        value: Number(value),
        currency: isoCurrency,
        items: normalizedItems
      }
    });
    didSignal = true;
  }

  if (consent.ads && typeof window.fbq === 'function' && event_id) {
    window.fbq(
      'track',
      'Purchase',
      {
        value: Number(value),
        currency: isoCurrency
      },
      { eventID: event_id }
    );
    didSignal = true;
  }

  if (didSignal) {
    try {
      sessionStorage.setItem(browserPurchaseStorageKey(transaction_id), '1');
    } catch {
      /* ignore */
    }
  }
}
