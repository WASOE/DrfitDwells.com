'use strict';

const {
  BUILD_MODEL_IDS,
  DEFAULT_MODEL_ID,
  MODEL_ID_ALIASES,
  MODEL_TYPES,
  RADIO_CATEGORIES,
  TOGGLE_OPTION_IDS,
  CUSTOM_SIZING,
  LAND_STATUSES,
  BUDGET_BANDS,
  TIMELINE_BANDS
} = require('./buildEnquiryConstants');

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function normalizeModelId(modelId) {
  if (modelId == null || modelId === '') return DEFAULT_MODEL_ID;
  const raw = String(modelId).trim();
  const aliased = MODEL_ID_ALIASES[raw] || raw;
  if (!BUILD_MODEL_IDS.includes(aliased)) {
    return { error: `Unknown modelId: ${raw}` };
  }
  return aliased;
}

function validateCustomDimensions(customDimensions, modelId) {
  if (customDimensions == null) return { value: null };
  if (!isPlainObject(customDimensions)) {
    return { error: 'config.customDimensions must be an object or null' };
  }
  const modelType = MODEL_TYPES[modelId];
  if (modelType !== 'cabin') {
    return { value: null };
  }
  const length = Number(customDimensions.length);
  const width = Number(customDimensions.width);
  if (!Number.isFinite(length) || !Number.isFinite(width)) {
    return { error: 'config.customDimensions requires numeric length and width' };
  }
  if (length < CUSTOM_SIZING.length.min || length > CUSTOM_SIZING.length.max) {
    return {
      error: `config.customDimensions.length must be between ${CUSTOM_SIZING.length.min} and ${CUSTOM_SIZING.length.max}`
    };
  }
  if (width < CUSTOM_SIZING.width.min || width > CUSTOM_SIZING.width.max) {
    return {
      error: `config.customDimensions.width must be between ${CUSTOM_SIZING.width.min} and ${CUSTOM_SIZING.width.max}`
    };
  }
  return { value: { length, width } };
}

function validateRadio(radio) {
  if (radio == null) return { value: {} };
  if (!isPlainObject(radio)) {
    return { error: 'config.radio must be an object' };
  }
  const out = {};
  for (const [categoryId, optionId] of Object.entries(radio)) {
    if (!(categoryId in RADIO_CATEGORIES)) {
      return { error: `Unknown radio category: ${categoryId}` };
    }
    const allowed = RADIO_CATEGORIES[categoryId];
    const id = String(optionId || '').trim();
    if (!allowed.includes(id)) {
      return { error: `Unknown option for ${categoryId}: ${id}` };
    }
    out[categoryId] = id;
  }
  return { value: out };
}

function validateToggles(toggles) {
  if (toggles == null) return { value: [] };
  if (!Array.isArray(toggles)) {
    return { error: 'config.toggles must be an array' };
  }
  const out = [];
  const seen = new Set();
  for (const raw of toggles) {
    const id = String(raw || '').trim();
    if (!TOGGLE_OPTION_IDS.includes(id)) {
      return { error: `Unknown toggle option: ${id}` };
    }
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return { value: out };
}

/**
 * Validates and normalizes a public create payload.
 * Incomplete configs are allowed (missing radio categories / empty toggles).
 * Unknown option ids are rejected.
 *
 * @returns {{ ok: true, value: object } | { ok: false, errors: string[] }}
 */
function validateBuildEnquiryCreateInput(body) {
  const errors = [];
  const raw = isPlainObject(body) ? body : {};

  const website = raw.website != null ? String(raw.website) : '';
  if (website.trim() !== '') {
    return { ok: true, honeypot: true };
  }

  const idempotencyKey = String(raw.idempotencyKey || '').trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    errors.push('idempotencyKey must be 8–128 characters');
  }

  const contactIn = isPlainObject(raw.contact) ? raw.contact : {};
  const name = String(contactIn.name || '').trim();
  const email = normalizeEmail(contactIn.email);
  const phoneRaw = contactIn.phone != null ? String(contactIn.phone).trim() : '';
  if (name.length < 1 || name.length > 120) {
    errors.push('contact.name is required (max 120 characters)');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    errors.push('contact.email must be a valid email');
  }
  if (phoneRaw.length > 40) {
    errors.push('contact.phone must be at most 40 characters');
  }

  const projectIn = isPlainObject(raw.project) ? raw.project : {};
  const location = String(projectIn.location || '').trim();
  const landStatus = String(projectIn.landStatus || '').trim();
  const budget = String(projectIn.budget || '').trim();
  const timeline = String(projectIn.timeline || '').trim();
  const message =
    projectIn.message != null ? String(projectIn.message).trim().slice(0, 4000) : '';
  if (location.length < 1 || location.length > 200) {
    errors.push('project.location is required (max 200 characters)');
  }
  if (!LAND_STATUSES.includes(landStatus)) {
    errors.push(`project.landStatus must be one of: ${LAND_STATUSES.join(', ')}`);
  }
  if (!BUDGET_BANDS.includes(budget)) {
    errors.push(`project.budget must be one of: ${BUDGET_BANDS.join(', ')}`);
  }
  if (!TIMELINE_BANDS.includes(timeline)) {
    errors.push(`project.timeline must be one of: ${TIMELINE_BANDS.join(', ')}`);
  }

  const configIn = isPlainObject(raw.config) ? raw.config : {};
  const modelResult = normalizeModelId(configIn.modelId);
  if (typeof modelResult === 'object' && modelResult.error) {
    errors.push(modelResult.error);
  }
  const modelId = typeof modelResult === 'string' ? modelResult : DEFAULT_MODEL_ID;

  const dimsResult = validateCustomDimensions(configIn.customDimensions, modelId);
  if (dimsResult.error) errors.push(dimsResult.error);

  const radioResult = validateRadio(configIn.radio);
  if (radioResult.error) errors.push(radioResult.error);

  const togglesResult = validateToggles(configIn.toggles);
  if (togglesResult.error) errors.push(togglesResult.error);

  const estimateIn = isPlainObject(raw.estimate) ? raw.estimate : {};
  let totalEur = null;
  if (estimateIn.totalEur != null && estimateIn.totalEur !== '') {
    const n = Number(estimateIn.totalEur);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) {
      errors.push('estimate.totalEur must be a finite number between 0 and 10000000');
    } else {
      totalEur = n;
    }
  }
  const displayLabel =
    estimateIn.displayLabel != null
      ? String(estimateIn.displayLabel).trim().slice(0, 80)
      : null;
  const hasConsultationItems = Boolean(estimateIn.hasConsultationItems);
  const summaryRows = Array.isArray(estimateIn.summaryRows)
    ? estimateIn.summaryRows.slice(0, 40).map((row) => ({
        key: String(row?.key || '').slice(0, 80),
        value: String(row?.value || '').slice(0, 200)
      }))
    : [];

  const metaIn = isPlainObject(raw.configMeta) ? raw.configMeta : {};
  let currentStep = null;
  if (metaIn.currentStep != null && metaIn.currentStep !== '') {
    const step = Number(metaIn.currentStep);
    if (!Number.isInteger(step) || step < 0 || step > 10) {
      errors.push('configMeta.currentStep must be an integer 0–10');
    } else {
      currentStep = step;
    }
  }
  const stepsVisited = Array.isArray(metaIn.stepsVisited)
    ? metaIn.stepsVisited
        .map((s) => Number(s))
        .filter((s) => Number.isInteger(s) && s >= 0 && s <= 10)
        .slice(0, 12)
    : [];
  const isPartial = metaIn.isPartial !== false;

  const attributionIn = isPlainObject(raw.attribution) ? raw.attribution : {};
  const attribution = {
    source: attributionIn.source != null ? String(attributionIn.source).slice(0, 120) : null,
    medium: attributionIn.medium != null ? String(attributionIn.medium).slice(0, 120) : null,
    campaign: attributionIn.campaign != null ? String(attributionIn.campaign).slice(0, 120) : null,
    utmSource:
      attributionIn.utmSource != null ? String(attributionIn.utmSource).slice(0, 120) : null,
    utmMedium:
      attributionIn.utmMedium != null ? String(attributionIn.utmMedium).slice(0, 120) : null,
    utmCampaign:
      attributionIn.utmCampaign != null ? String(attributionIn.utmCampaign).slice(0, 120) : null,
    referrer: attributionIn.referrer != null ? String(attributionIn.referrer).slice(0, 500) : null
  };
  const sessionKey =
    raw.sessionKey != null ? String(raw.sessionKey).trim().slice(0, 120) || null : null;
  const visitorKey =
    raw.visitorKey != null ? String(raw.visitorKey).trim().slice(0, 120) || null : null;

  if (errors.length) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    honeypot: false,
    value: {
      idempotencyKey,
      contact: {
        name,
        email,
        emailNormalized: email,
        phone: phoneRaw || null
      },
      project: {
        location,
        landStatus,
        budget,
        timeline,
        message: message || null
      },
      config: {
        modelId,
        customDimensions: dimsResult.value ?? null,
        radio: radioResult.value || {},
        toggles: togglesResult.value || []
      },
      estimate: {
        totalEur,
        hasConsultationItems,
        currency: 'EUR',
        displayLabel,
        summaryRows,
        unverified: true
      },
      configMeta: {
        currentStep,
        stepsVisited,
        isPartial
      },
      attribution,
      sessionKey,
      visitorKey
    }
  };
}

module.exports = {
  validateBuildEnquiryCreateInput,
  normalizeEmail,
  normalizeModelId
};
