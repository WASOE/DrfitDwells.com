/**
 * Bounded JSON GET. Aborts on timeout. Does not log the response body.
 */

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 10000;

export function resolveTimeoutMs(value, fallback = DEFAULT_TIMEOUT_MS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), MAX_TIMEOUT_MS);
}

export async function strictJsonGet(url, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  const limit = resolveTimeoutMs(timeoutMs);
  if (typeof fetchImpl !== 'function') {
    const err = new Error('fetch is unavailable');
    err.code = 'FETCH_UNAVAILABLE';
    throw err;
  }
  const signal = AbortSignal.timeout(limit);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal,
      headers: { accept: 'application/json' }
    });
  } catch (err) {
    const name = err?.name || '';
    const timedOut = name === 'TimeoutError' || name === 'AbortError' || err?.code === 'ABORT_ERR';
    const wrapped = new Error(timedOut ? `request timed out after ${limit}ms` : 'request failed');
    wrapped.code = timedOut ? 'TIMEOUT' : 'REQUEST_FAILED';
    throw wrapped;
  }
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: response.status, ok: response.ok, body };
}
