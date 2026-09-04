/**
 * Creator Portal Batch C — frontend-only share URL builder.
 * Campaign and custom source are capped at 200 for portal-built links.
 * Does not create referral codes or call any API.
 */

/** Portal-built utm_campaign / shared UTM field max (trim then clip). */
export const UTM_FIELD_MAX_LENGTH = 200;

/** Custom utm_source when platform is Other. */
export const UTM_CUSTOM_SOURCE_MAX_LENGTH = 200;

export const CREATOR_SHARE_PRESET_SOURCES = Object.freeze(['instagram', 'tiktok', 'facebook']);

export const CREATOR_SHARE_PLATFORMS = Object.freeze([
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'other', label: 'Other' }
]);

/**
 * @param {unknown} raw
 * @returns {string|null} trimmed campaign or null when empty / invalid
 */
export function normalizeUtmCampaignInput(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') return null;
  const value = raw.trim().slice(0, UTM_FIELD_MAX_LENGTH);
  return value || null;
}

/**
 * Custom utm_source for platform Other: trim, lowercase, max 200.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeCustomUtmSource(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase().slice(0, UTM_CUSTOM_SOURCE_MAX_LENGTH);
  return value || null;
}

/**
 * Resolve the utm_source token for the selected platform.
 * @returns {string|null} null when Other is selected but custom source is invalid
 */
export function resolveCreatorShareUtmSource(platform, customSource) {
  const id = platform == null ? '' : String(platform).trim().toLowerCase();
  if (CREATOR_SHARE_PRESET_SOURCES.includes(id)) return id;
  if (id === 'other') return normalizeCustomUtmSource(customSource);
  return null;
}

/**
 * Decide whether the campaign-link builder should reset when auth identity resolves.
 * Identity must be a stable creator id (session `/session` creator.id), never referral code.
 *
 * @param {string|null|undefined} previousCreatorId
 * @param {string|null|undefined} nextCreatorId null/empty = logged out / session loss
 * @returns {{ shouldResetShareForm: boolean, nextRememberedCreatorId: string|null }}
 */
export function decideCreatorShareFormIdentityTransition(previousCreatorId, nextCreatorId) {
  const prev =
    previousCreatorId != null && String(previousCreatorId).trim() !== ''
      ? String(previousCreatorId)
      : null;
  const next =
    nextCreatorId != null && String(nextCreatorId).trim() !== '' ? String(nextCreatorId) : null;

  if (!next) {
    return { shouldResetShareForm: true, nextRememberedCreatorId: null };
  }
  if (!prev || prev !== next) {
    return { shouldResetShareForm: true, nextRememberedCreatorId: next };
  }
  return { shouldResetShareForm: false, nextRememberedCreatorId: next };
}

/**
 * Build a platform share URL for the creator's current referral code.
 * Uses `new URL('/', origin)` + searchParams (no manual query concatenation).
 *
 * @param {object} args
 * @param {string} args.origin absolute origin, e.g. window.location.origin (required)
 * @param {string} args.referralCode current public code
 * @param {string} args.platform instagram|tiktok|facebook|other
 * @param {string} [args.customSource] required when platform is other
 * @param {string} [args.campaign] optional utm_campaign
 * @returns {string} absolute URL, or '' when invalid
 */
export function buildCreatorCampaignShareUrl({
  origin,
  referralCode,
  platform,
  customSource,
  campaign
} = {}) {
  const code = referralCode == null ? '' : String(referralCode).trim();
  const source = resolveCreatorShareUtmSource(platform, customSource);
  const originRaw = origin == null ? '' : String(origin).trim().replace(/\/$/, '');
  if (!code || !source || !originRaw) return '';

  let url;
  try {
    url = new URL('/', originRaw);
  } catch {
    return '';
  }

  url.searchParams.set('ref', code);
  url.searchParams.set('utm_source', source);
  url.searchParams.set('utm_medium', 'creator');
  const camp = normalizeUtmCampaignInput(campaign);
  if (camp) url.searchParams.set('utm_campaign', camp);

  return url.toString();
}
