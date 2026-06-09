/**
 * Controlled cleaning tag vocabulary — must match shared/cleaning/cleaningTagVocabulary.json
 * (loaded at runtime from GET /ops/cleaning/pricing-policy when available).
 */
import vocabulary from '../../../shared/cleaning/cleaningTagVocabulary.json';

export const CLEANING_TAG_VOCABULARY = Object.freeze([...vocabulary.tags]);

export const CLEANING_TAG_LABELS = Object.freeze({
  'a-frame': 'A-frame',
  'lux-cabin': 'Lux cabin',
  'stone-house': 'Stone house'
});
