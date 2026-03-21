const cache = new Map();
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function buildIdempotencyKey({ action, actorId, entityId, requestId }) {
  return [action || 'unknown', actorId || 'system', entityId || 'na', requestId || 'na'].join(':');
}

function rememberResult(key, result, ttlMs = DEFAULT_TTL_MS) {
  cache.set(key, {
    expiresAt: Date.now() + ttlMs,
    result
  });
}

function getRememberedResult(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  return item.result;
}

function clearExpired() {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (value.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

module.exports = {
  buildIdempotencyKey,
  rememberResult,
  getRememberedResult,
  clearExpired
};
