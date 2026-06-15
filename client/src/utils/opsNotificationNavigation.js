import { sanitizeOpsPushClickUrl } from '../../../shared/ops/sanitizeOpsPushClickUrl.js';

/**
 * Resolve a stored OPS notification URL to a safe in-app path.
 */
export function resolveOpsNotificationNavigationUrl(rawUrl, origin = typeof window !== 'undefined' ? window.location.origin : 'https://localhost') {
  return sanitizeOpsPushClickUrl(rawUrl, origin);
}
