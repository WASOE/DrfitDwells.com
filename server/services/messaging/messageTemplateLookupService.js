'use strict';

/**
 * messageTemplateLookupService
 *
 * Locate the `approved` MessageTemplate row for a given (key, channel,
 * locale, propertyKind). Returns the highest version. Falls back from the
 * specific propertyKind (e.g. 'cabin') to `'any'` so OPS templates seeded
 * with `propertyKind:'any'` still resolve.
 *
 * No `draft` or `disabled` template ever satisfies the lookup. If only
 * `draft` rows exist the function returns `{ approved: null, draftCandidates: N }`
 * so callers can produce the `template_not_available` failure path with
 * useful diagnostics. The dispatcher MUST NOT silently fall through to a
 * draft template (per Batch 8 approval).
 *
 * See docs/guest-message-automation/02_V1_SPEC.md §11, §17 (gate 5).
 */

const MessageTemplate = require('../../models/MessageTemplate');

const DEFAULT_LOCALE = 'en';

async function findApprovedTemplate({
  templateKey,
  channel,
  locale = DEFAULT_LOCALE,
  propertyKind
}) {
  if (!templateKey || !channel) {
    return { approved: null, draftCandidates: 0, reason: 'invalid_lookup' };
  }
  const propertyKindCandidates = [];
  if (propertyKind) propertyKindCandidates.push(propertyKind);
  if (!propertyKindCandidates.includes('any')) propertyKindCandidates.push('any');

  for (const pk of propertyKindCandidates) {
    const approved = await MessageTemplate
      .findOne({ key: templateKey, channel, locale, propertyKind: pk, status: 'approved' })
      .sort({ version: -1 })
      .lean();
    if (approved) return { approved, draftCandidates: 0 };
  }

  const draftCandidates = await MessageTemplate.countDocuments({
    key: templateKey,
    channel,
    locale,
    propertyKind: { $in: propertyKindCandidates },
    status: { $in: ['draft', 'disabled'] }
  });

  return { approved: null, draftCandidates };
}

module.exports = {
  findApprovedTemplate,
  DEFAULT_LOCALE
};
