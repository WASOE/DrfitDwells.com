import {
  BUILD_OPTIONS,
  CUSTOM_SIZING,
  DEFAULT_RADIO_SELECTIONS,
  DEFAULT_MODEL_ID,
  getBuildModel,
} from './buildConfiguratorSchema.js';

/** @typedef {{ modelId: string, customDimensions: { length: number, width: number } | null, radio: Record<string, string>, toggles: string[] }} BuildConfiguratorState */

export function isOptionAvailableForModel(option, modelId, modelType) {
  if (option.availableFor?.length && !option.availableFor.includes(modelId)) {
    return false;
  }
  if (
    option.availableForModelTypes?.length &&
    !option.availableForModelTypes.includes(modelType)
  ) {
    return false;
  }
  if (modelType === 'aframe' && option.tags?.includes('bathroom')) {
    return false;
  }
  if (modelType === 'aframe' && option.tags?.includes('plumbing')) {
    return false;
  }
  return true;
}

export function getOptionsForCategory(categoryId, modelId) {
  const model = getBuildModel(modelId);
  return BUILD_OPTIONS.filter(
    (opt) =>
      opt.categoryId === categoryId &&
      isOptionAvailableForModel(opt, modelId, model.type)
  );
}

export function getOptionById(optionId) {
  return BUILD_OPTIONS.find((opt) => opt.id === optionId);
}

export function createInitialBuildState(modelId = DEFAULT_MODEL_ID) {
  return sanitizeBuildState(
    {
      modelId,
      customDimensions: null,
      radio: { ...DEFAULT_RADIO_SELECTIONS },
      toggles: [],
    },
    modelId
  );
}

export function sanitizeBuildState(state, modelId = state.modelId) {
  const model = getBuildModel(modelId);
  const radio = { ...state.radio };

  for (const [categoryId, defaultOptionId] of Object.entries(DEFAULT_RADIO_SELECTIONS)) {
    const currentId = radio[categoryId];
    const current = currentId ? getOptionById(currentId) : null;
    if (!current || !isOptionAvailableForModel(current, modelId, model.type)) {
      const fallback =
        getOptionsForCategory(categoryId, modelId).find((opt) => opt.included)?.id ??
        getOptionsForCategory(categoryId, modelId)[0]?.id ??
        defaultOptionId;
      radio[categoryId] = fallback;
    }
  }

  const toggles = state.toggles.filter((toggleId) => {
    const opt = getOptionById(toggleId);
    return opt && isOptionAvailableForModel(opt, modelId, model.type);
  });

  const customDimensions =
    model.type === 'cabin' ? state.customDimensions : null;

  return {
    modelId,
    customDimensions,
    radio,
    toggles,
  };
}

export function computeCustomSizePrice(basePrice, length, width) {
  const m2 = length * width;
  const { standardAreaSqm, ratePerSqmAboveStandard } = CUSTOM_SIZING;
  const extra =
    m2 > standardAreaSqm
      ? Math.round(((m2 - standardAreaSqm) * ratePerSqmAboveStandard) / 100) * 100
      : 0;
  return {
    areaSqm: m2,
    extraPrice: extra,
    total: basePrice + extra,
    label:
      m2 > standardAreaSqm
        ? `${m2} m² — custom size`
        : `${m2} m² — standard model`,
  };
}

/**
 * @returns {{ total: number, hasConsultationItems: boolean }}
 */
export function computeBuildTotal(state) {
  const model = getBuildModel(state.modelId);
  let total = model.basePrice;

  if (model.type === 'cabin' && state.customDimensions) {
    const sized = computeCustomSizePrice(
      model.basePrice,
      state.customDimensions.length,
      state.customDimensions.width
    );
    total = sized.total;
  }

  for (const optionId of Object.values(state.radio)) {
    const opt = getOptionById(optionId);
    if (!opt || !isOptionAvailableForModel(opt, state.modelId, model.type)) continue;
    if (opt.priceOnConsultation) continue;
    total += opt.priceDelta ?? 0;
  }

  for (const toggleId of state.toggles) {
    const opt = getOptionById(toggleId);
    if (!opt || !isOptionAvailableForModel(opt, state.modelId, model.type)) continue;
    if (opt.priceOnConsultation) continue;
    total += opt.priceDelta ?? 0;
  }

  return {
    total,
    hasConsultationItems: getConsultationOptionIds(state).length > 0,
  };
}

export function formatBuildBarPrice({ total, hasConsultationItems }) {
  const formatted = formatBuildPrice(total);
  return hasConsultationItems ? `From ${formatted}` : formatted;
}

export function getConsultationOptionIds(state) {
  const model = getBuildModel(state.modelId);
  const ids = [];

  for (const optionId of [...Object.values(state.radio), ...state.toggles]) {
    const opt = getOptionById(optionId);
    if (
      opt?.priceOnConsultation &&
      isOptionAvailableForModel(opt, state.modelId, model.type)
    ) {
      if (opt.selectionType === 'radio') {
        const selected = state.radio[opt.categoryId];
        if (selected === opt.id) ids.push(opt.id);
      } else if (state.toggles.includes(opt.id)) {
        ids.push(opt.id);
      }
    }
  }

  return ids;
}

export function formatBuildPrice(value, locale = 'en-GB') {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

export function getDisplayDimensions(state) {
  const model = getBuildModel(state.modelId);
  if (model.type === 'cabin' && state.customDimensions) {
    const { length, width } = state.customDimensions;
    return `${length} m × ${width} m × 3 m`;
  }
  return model.dims;
}

export function getDisplayArea(state) {
  const model = getBuildModel(state.modelId);
  if (model.type === 'cabin' && state.customDimensions) {
    const m2 = state.customDimensions.length * state.customDimensions.width;
    return `${m2} m²`;
  }
  return model.areaLabel;
}

export function buildSummaryRows(state) {
  const model = getBuildModel(state.modelId);
  const rows = [{ key: 'Model', value: model.name }];

  if (model.type === 'cabin' && state.customDimensions) {
    const sized = computeCustomSizePrice(
      model.basePrice,
      state.customDimensions.length,
      state.customDimensions.width
    );
    rows.push({ key: 'Size', value: sized.label });
  }

  for (const [categoryId, optionId] of Object.entries(state.radio)) {
    const opt = getOptionById(optionId);
    if (!opt || !isOptionAvailableForModel(opt, state.modelId, model.type)) continue;
    rows.push({
      key: categoryLabel(categoryId),
      value: formatOptionSummaryValue(opt),
    });
  }

  for (const toggleId of state.toggles) {
    const opt = getOptionById(toggleId);
    if (!opt || !isOptionAvailableForModel(opt, state.modelId, model.type)) continue;
    rows.push({
      key: 'Add-on',
      value: formatOptionSummaryValue(opt),
    });
  }

  return rows;
}

function categoryLabel(categoryId) {
  const labels = {
    cladding: 'Cladding',
    roof: 'Roof',
    wallFinish: 'Wall finish',
    flooring: 'Flooring',
  };
  return labels[categoryId] ?? categoryId;
}

function formatOptionSummaryValue(opt) {
  if (opt.included && !opt.priceOnConsultation) {
    return `${opt.name} — Included`;
  }
  if (opt.priceOnConsultation) {
    return `${opt.name} — Price at consultation`;
  }
  if (opt.priceDelta) {
    return `${opt.name} (+${formatBuildPrice(opt.priceDelta)})`;
  }
  return opt.name;
}
