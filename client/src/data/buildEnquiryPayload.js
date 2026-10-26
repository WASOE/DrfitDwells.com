import {
  buildSummaryRows,
  computeBuildTotal,
  formatBuildBarPrice,
  sanitizeBuildState
} from './buildConfiguratorLogic.js';
import { BUILD_STEPS } from './buildConfiguratorSchema.js';
import {
  getAttributionPayload,
  getFunnelSessionKey,
  getFunnelVisitorKey
} from '../tracking/attribution.js';

export function makeBuildEnquiryIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `be_${crypto.randomUUID()}`;
  }
  return `be_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Builds the POST /api/public/build-enquiries body from live configurator state.
 * Incomplete configs are allowed; estimate is an unverified client snapshot.
 */
export function buildBuildEnquiryPayload({
  state,
  currentStep = 0,
  stepsVisited,
  contact,
  project,
  idempotencyKey,
  website = ''
}) {
  const sanitized = sanitizeBuildState(state);
  const pricing = computeBuildTotal(sanitized);
  const displayLabel = formatBuildBarPrice(pricing);
  const summaryRows = buildSummaryRows(sanitized).map((row) => ({
    key: row.key,
    value: row.value
  }));

  const stepCount = BUILD_STEPS.length;
  const step = Number.isInteger(currentStep)
    ? Math.max(0, Math.min(currentStep, stepCount - 1))
    : 0;
  const visited = Array.isArray(stepsVisited)
    ? stepsVisited
        .map((s) => Number(s))
        .filter((s) => Number.isInteger(s) && s >= 0 && s < stepCount)
    : Array.from({ length: step + 1 }, (_, i) => i);

  const attr = getAttributionPayload() || {};
  const attribution = {
    source: attr.utmSource || null,
    medium: attr.utmMedium || null,
    campaign: attr.utmCampaign || null,
    utmSource: attr.utmSource || null,
    utmMedium: attr.utmMedium || null,
    utmCampaign: attr.utmCampaign || null,
    referrer: attr.referrer || null
  };

  return {
    idempotencyKey,
    contact: {
      name: String(contact?.name || '').trim(),
      email: String(contact?.email || '').trim(),
      phone: contact?.phone != null && String(contact.phone).trim()
        ? String(contact.phone).trim()
        : undefined
    },
    project: {
      location: String(project?.location || '').trim(),
      landStatus: String(project?.landStatus || '').trim(),
      budget: String(project?.budget || '').trim(),
      timeline: String(project?.timeline || '').trim(),
      message:
        project?.message != null && String(project.message).trim()
          ? String(project.message).trim()
          : undefined
    },
    config: {
      modelId: sanitized.modelId,
      customDimensions: sanitized.customDimensions,
      radio: { ...sanitized.radio },
      toggles: [...sanitized.toggles]
    },
    estimate: {
      totalEur: pricing.total,
      hasConsultationItems: pricing.hasConsultationItems,
      displayLabel,
      summaryRows
    },
    configMeta: {
      currentStep: step,
      stepsVisited: visited,
      isPartial: step < stepCount - 1
    },
    attribution,
    sessionKey: getFunnelSessionKey() || undefined,
    visitorKey: getFunnelVisitorKey() || undefined,
    website: website == null ? '' : String(website)
  };
}

export function validateBuildEnquiryForm({ contact, project }) {
  const errors = {};
  const name = String(contact?.name || '').trim();
  const email = String(contact?.email || '').trim();
  const phone = contact?.phone != null ? String(contact.phone).trim() : '';
  const location = String(project?.location || '').trim();
  const landStatus = String(project?.landStatus || '').trim();
  const budget = String(project?.budget || '').trim();
  const timeline = String(project?.timeline || '').trim();
  const message = project?.message != null ? String(project.message).trim() : '';

  if (!name || name.length > 120) {
    errors.name = 'Please enter your name.';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    errors.email = 'Please enter a valid email.';
  }
  if (phone.length > 40) {
    errors.phone = 'Phone number is too long.';
  }
  if (!location || location.length > 200) {
    errors.location = 'Please enter your project location.';
  }
  if (!['owned', 'searching', 'other'].includes(landStatus)) {
    errors.landStatus = 'Please select land status.';
  }
  if (!['under_30k', '30k_50k', '50k_80k', '80k_plus', 'undecided'].includes(budget)) {
    errors.budget = 'Please select a budget range.';
  }
  if (
    !['asap', 'within_3_months', 'within_6_months', 'within_12_months', 'exploring'].includes(
      timeline
    )
  ) {
    errors.timeline = 'Please select a timeline.';
  }
  if (message.length > 4000) {
    errors.message = 'Message is too long.';
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors
  };
}
