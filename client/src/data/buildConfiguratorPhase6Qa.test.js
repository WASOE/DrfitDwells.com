import { describe, expect, it } from 'vitest';
import {
  buildBuildEnquiryMailto,
  buildBuildSpecPdfContent,
} from './buildConfiguratorExport.js';
import {
  computeBuildTotal,
  createInitialBuildState,
  formatBuildBarPrice,
  getOptionsForCategory,
  sanitizeBuildState,
} from './buildConfiguratorLogic.js';
import { getIncludedItemsForModel } from './buildConfiguratorSchema.js';

const CONTACT = 'hello@driftdwells.com';

function cabinWithPlumbingExtras() {
  return sanitizeBuildState({
    modelId: '7x3',
    customDimensions: { length: 8, width: 3 },
    radio: createInitialBuildState('7x3').radio,
    toggles: ['extra-outdoor-shower', 'extra-rainwater'],
  });
}

describe('Phase 6 QA — model switch mid-flow', () => {
  it('strips plumbing toggles and custom dimensions when switching cabin → A-Frame', () => {
    const cabinState = cabinWithPlumbingExtras();
    expect(cabinState.toggles).toEqual(['extra-outdoor-shower', 'extra-rainwater']);

    const aframeState = sanitizeBuildState({ ...cabinState, modelId: 'aframe' }, 'aframe');
    expect(aframeState.toggles).toEqual([]);
    expect(aframeState.customDimensions).toBeNull();
    expect(formatBuildBarPrice(computeBuildTotal(aframeState))).toBe('€20,000');
  });

  it('keeps stripped toggles cleared and custom dimensions null when switching A-Frame → cabin', () => {
    const cabinState = cabinWithPlumbingExtras();
    const aframeState = sanitizeBuildState({ ...cabinState, modelId: 'aframe' }, 'aframe');
    const backToCabin = sanitizeBuildState({ ...aframeState, modelId: '7x3' }, '7x3');

    expect(backToCabin.toggles).not.toContain('extra-outdoor-shower');
    expect(backToCabin.toggles).not.toContain('extra-rainwater');
    expect(backToCabin.customDimensions).toBeNull();
    expect(formatBuildBarPrice(computeBuildTotal(backToCabin))).toBe('€30,000');
  });

  it('updates bar price after each model switch in a mixed configuration', () => {
    const cabinState = sanitizeBuildState({
      modelId: '7x3',
      customDimensions: null,
      radio: createInitialBuildState('7x3').radio,
      toggles: ['heat-ac', 'extra-outdoor-shower'],
    });
    expect(formatBuildBarPrice(computeBuildTotal(cabinState))).toBe('€34,000');

    const aframeState = sanitizeBuildState({ ...cabinState, modelId: 'aframe' }, 'aframe');
    expect(formatBuildBarPrice(computeBuildTotal(aframeState))).toBe('€22,800');

    const backToCabin = sanitizeBuildState({ ...cabinState, modelId: '7x3' }, '7x3');
    expect(formatBuildBarPrice(computeBuildTotal(backToCabin))).toBe('€34,000');
  });
});

describe('Phase 6 QA — A-Frame exclusion edge cases', () => {
  it('hides outdoor shower on Exterior and rainwater on Options for A-Frame', () => {
    const exterior = getOptionsForCategory('exteriorExtras', 'aframe');
    const energy = getOptionsForCategory('energy', 'aframe');

    expect(exterior.map((o) => o.id)).not.toContain('extra-outdoor-shower');
    expect(energy.map((o) => o.id)).not.toContain('extra-rainwater');
    expect(exterior.some((o) => o.id === 'extra-timber-deck')).toBe(true);
  });

  it('includes summaryNote in PDF content for A-Frame', () => {
    const content = buildBuildSpecPdfContent(createInitialBuildState('aframe'), CONTACT);
    expect(content.summaryNote).toMatch(/structural shell/);
  });

  it('does not list Full bathroom in included items for any model', () => {
    for (const modelId of ['6x3', '7x3', 'aframe']) {
      const items = getIncludedItemsForModel(modelId);
      expect(items.join(' ')).not.toMatch(/full bathroom/i);
      expect(items.join(' ')).not.toMatch(/bathroom & fixtures/i);
    }
  });
});

describe('Phase 6 QA — price bar accuracy', () => {
  it('shows exact total for fixed-price items only', () => {
    const state = sanitizeBuildState({
      modelId: '7x3',
      customDimensions: null,
      radio: createInitialBuildState('7x3').radio,
      toggles: ['heat-ac'],
    });
    const pricing = computeBuildTotal(state);
    expect(formatBuildBarPrice(pricing)).toBe('€32,800');
    expect(pricing.hasConsultationItems).toBe(false);
  });

  it('toggles From prefix when pine planks selected, reverts when removed', () => {
    const withPine = sanitizeBuildState({
      modelId: '7x3',
      customDimensions: null,
      radio: { ...createInitialBuildState('7x3').radio, wallFinish: 'finish-pine-planks' },
      toggles: [],
    });
    expect(formatBuildBarPrice(computeBuildTotal(withPine))).toBe('From €30,000');

    const withoutPine = sanitizeBuildState({
      ...withPine,
      radio: { ...withPine.radio, wallFinish: 'finish-plywood' },
    });
    expect(formatBuildBarPrice(computeBuildTotal(withoutPine))).toBe('€30,000');
  });

  it('toggles From prefix for fireplace and wooden planks independently', () => {
    const withFireplace = sanitizeBuildState({
      modelId: '7x3',
      customDimensions: null,
      radio: createInitialBuildState('7x3').radio,
      toggles: ['heat-fireplace'],
    });
    expect(formatBuildBarPrice(computeBuildTotal(withFireplace))).toBe('From €30,000');

    const withWoodFloor = sanitizeBuildState({
      modelId: '7x3',
      customDimensions: null,
      radio: { ...createInitialBuildState('7x3').radio, flooring: 'floor-wooden-planks' },
      toggles: [],
    });
    expect(formatBuildBarPrice(computeBuildTotal(withWoodFloor))).toBe('From €30,000');

    const fixedOnly = sanitizeBuildState({
      modelId: '7x3',
      customDimensions: null,
      radio: createInitialBuildState('7x3').radio,
      toggles: [],
    });
    expect(formatBuildBarPrice(computeBuildTotal(fixedOnly))).toBe('€30,000');
    expect(computeBuildTotal(fixedOnly).hasConsultationItems).toBe(false);
  });
});

describe('Phase 6 QA — PDF export', () => {
  it('includes all line items, consultation footnote, and matching total for a fully configured cabin', () => {
    const state = sanitizeBuildState({
      modelId: '7x3',
      customDimensions: { length: 8, width: 3 },
      radio: {
        ...createInitialBuildState('7x3').radio,
        cladding: 'cladding-shou-sugi',
        wallFinish: 'finish-pine-planks',
      },
      toggles: ['heat-ac', 'extra-solar', 'heat-fireplace'],
    });
    const content = buildBuildSpecPdfContent(state, CONTACT);

    expect(content.rows.map((r) => r.key)).toEqual(
      expect.arrayContaining(['Model', 'Size', 'Cladding', 'Wall finish', 'Add-on'])
    );
    expect(content.consultationNames).toEqual(
      expect.arrayContaining(['Rough pine planks', 'Wood-burning fireplace'])
    );
    expect(content.totalLabel).toBe(formatBuildBarPrice(computeBuildTotal(state)));
    expect(content.hasCustomSizeRow).toBe(true);
  });

  it('includes summaryNote, omits custom size, and has no bathroom rows for A-Frame', () => {
    const state = createInitialBuildState('aframe');
    const content = buildBuildSpecPdfContent(state, CONTACT);

    expect(content.summaryNote).toMatch(/structural shell/);
    expect(content.hasCustomSizeRow).toBe(false);
    expect(content.rows.some((r) => /bathroom/i.test(r.value))).toBe(false);
    expect(content.dimensions).toBe('6 m × 3 m footprint');
  });
});

describe('Phase 6 QA — mailto export', () => {
  it('encodes subject and body with mixed fixed + consultation items', () => {
    const state = sanitizeBuildState({
      modelId: '7x3',
      customDimensions: null,
      radio: {
        ...createInitialBuildState('7x3').radio,
        wallFinish: 'finish-pine-planks',
      },
      toggles: ['heat-ac'],
    });
    const mailto = buildBuildEnquiryMailto(state, CONTACT);
    const decoded = decodeURIComponent(mailto);

    expect(mailto).toMatch(/^mailto:hello@driftdwells\.com\?subject=/);
    expect(decoded).toContain('Drift & Dwells build enquiry — The 7×3');
    expect(decoded).toContain('Estimate: From €32,800');
    expect(decoded.split('\n').length).toBeLessThanOrEqual(8);
    expect(mailto).not.toMatch(/subject=[^&]*&[^b]/); // subject fully encoded before body=
    expect(mailto).not.toContain(' '); // no raw spaces in URL
  });

  it('includes A-Frame shell note in mailto body', () => {
    const mailto = buildBuildEnquiryMailto(createInitialBuildState('aframe'), CONTACT);
    expect(decodeURIComponent(mailto)).toContain('structural shell');
  });
});
