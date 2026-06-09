const vocabulary = require('../../../shared/cleaning/cleaningTagVocabulary.json');

const CLEANING_TAG_VOCABULARY = Object.freeze([...vocabulary.tags]);

function normalizeCleaningTag(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function isKnownCleaningTag(tag) {
  const normalized = normalizeCleaningTag(tag);
  return CLEANING_TAG_VOCABULARY.includes(normalized);
}

/**
 * Filter to controlled vocabulary tags only; reject/ignore arbitrary strings.
 */
function sanitizeCleaningTags(input) {
  if (!Array.isArray(input)) {
    return { tags: [], rejected: [] };
  }

  const tags = [];
  const rejected = [];
  const seen = new Set();

  for (const raw of input) {
    const normalized = normalizeCleaningTag(raw);
    if (!normalized) continue;
    if (!isKnownCleaningTag(normalized)) {
      rejected.push(String(raw));
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    tags.push(normalized);
  }

  return { tags, rejected };
}

function inventoryHasPricingTag(tags) {
  const { tags: sanitized } = sanitizeCleaningTags(tags);
  return sanitized.length > 0;
}

module.exports = {
  CLEANING_TAG_VOCABULARY,
  normalizeCleaningTag,
  isKnownCleaningTag,
  sanitizeCleaningTags,
  inventoryHasPricingTag
};
