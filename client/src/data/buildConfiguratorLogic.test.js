import { describe, expect, it } from 'vitest';
import {
  computeBuildTotal,
  computeCustomSizePrice,
  createInitialBuildState,
  formatBuildBarPrice,
  getConsultationOptionIds,
  getOptionById,
  getOptionsForCategory,
  isOptionAvailableForModel,
  sanitizeBuildState,
} from './buildConfiguratorLogic.js';
import { BUILD_OPTIONS } from './buildConfiguratorSchema.js';

describe('buildConfiguratorLogic', () => {
  it('excludes plumbing-tagged options for A-Frame', () => {
    const rainwater = BUILD_OPTIONS.find((o) => o.id === 'extra-rainwater');
    const outdoorShower = BUILD_OPTIONS.find((o) => o.id === 'extra-outdoor-shower');

    expect(isOptionAvailableForModel(rainwater, 'aframe', 'aframe')).toBe(false);
    expect(isOptionAvailableForModel(outdoorShower, 'aframe', 'aframe')).toBe(false);
    expect(isOptionAvailableForModel(rainwater, '7x3', 'cabin')).toBe(true);
  });

  it('keeps the same interior option sets for cabin and A-Frame', () => {
    const cabinInterior = getOptionsForCategory('wallFinish', '7x3');
    const aframeInterior = getOptionsForCategory('wallFinish', 'aframe');

    expect(cabinInterior.map((o) => o.id)).toEqual(aframeInterior.map((o) => o.id));
    expect(cabinInterior.map((o) => o.id)).toEqual(['finish-plywood', 'finish-pine-planks']);
  });

  it('does not offer SPC or solid oak flooring options', () => {
    const names = BUILD_OPTIONS.map((o) => o.name.toLowerCase()).join(' ');
    expect(names).not.toMatch(/spc|stone-core|solid oak/);
  });

  it('uses PVC laminate and plywood as included defaults', () => {
    const state = createInitialBuildState('7x3');
    expect(state.radio.wallFinish).toBe('finish-plywood');
    expect(state.radio.flooring).toBe('floor-pvc-laminate');
  });

  it('computes cabin base price at €30,000 and A-Frame at €20,000', () => {
    expect(computeBuildTotal(createInitialBuildState('6x3')).total).toBe(30000);
    expect(computeBuildTotal(createInitialBuildState('7x3')).total).toBe(30000);
    expect(computeBuildTotal(createInitialBuildState('aframe')).total).toBe(20000);
    expect(computeBuildTotal(createInitialBuildState('7x3')).hasConsultationItems).toBe(false);
  });

  it('adds custom size surcharge above 21 m² for cabins only', () => {
    const sized = computeCustomSizePrice(30000, 8, 3);
    expect(sized.areaSqm).toBe(24);
    expect(sized.extraPrice).toBe(3600);
    expect(sized.total).toBe(33600);

    const state = sanitizeBuildState({
      modelId: '7x3',
      customDimensions: { length: 8, width: 3 },
      radio: createInitialBuildState('7x3').radio,
      toggles: [],
    });
    expect(computeBuildTotal(state).total).toBe(33600);
  });

  it('clears custom dimensions when switching to A-Frame', () => {
    const state = sanitizeBuildState(
      {
        modelId: '7x3',
        customDimensions: { length: 10, width: 4 },
        radio: createInitialBuildState('7x3').radio,
        toggles: ['extra-rainwater'],
      },
      'aframe'
    );

    expect(state.customDimensions).toBeNull();
    expect(state.toggles).not.toContain('extra-rainwater');
  });

  it('excludes consultation-priced options from numeric total', () => {
    const state = sanitizeBuildState({
      modelId: '7x3',
      customDimensions: null,
      radio: {
        ...createInitialBuildState('7x3').radio,
        wallFinish: 'finish-pine-planks',
        flooring: 'floor-wooden-planks',
      },
      toggles: ['heat-underfloor'],
    });

    const result = computeBuildTotal(state);
    expect(result.total).toBe(30000);
    expect(result.hasConsultationItems).toBe(true);
    expect(getConsultationOptionIds(state).sort()).toEqual(
      ['finish-pine-planks', 'floor-wooden-planks', 'heat-underfloor'].sort()
    );
  });

  it('prefixes bar price with From when consultation items are active', () => {
    const withConsultation = computeBuildTotal(
      sanitizeBuildState({
        modelId: '7x3',
        customDimensions: null,
        radio: {
          ...createInitialBuildState('7x3').radio,
          wallFinish: 'finish-pine-planks',
        },
        toggles: [],
      })
    );
    expect(formatBuildBarPrice(withConsultation)).toBe('From €30,000');

    const fixedOnly = computeBuildTotal(
      sanitizeBuildState({
        modelId: '7x3',
        customDimensions: null,
        radio: createInitialBuildState('7x3').radio,
        toggles: ['extra-solar'],
      })
    );
    expect(formatBuildBarPrice(fixedOnly)).toBe('€37,200');
  });

  it('uses From €20,000 for A-Frame when consultation items are active', () => {
    const result = computeBuildTotal(
      sanitizeBuildState({
        modelId: 'aframe',
        customDimensions: null,
        radio: {
          ...createInitialBuildState('aframe').radio,
          flooring: 'floor-wooden-planks',
        },
        toggles: [],
      })
    );
    expect(formatBuildBarPrice(result)).toBe('From €20,000');
  });

  it('adds fixed-price toggles to total', () => {
    const state = sanitizeBuildState({
      modelId: '7x3',
      customDimensions: null,
      radio: createInitialBuildState('7x3').radio,
      toggles: ['extra-solar', 'extra-rainwater'],
    });

    expect(computeBuildTotal(state).total).toBe(30000 + 7200 + 2800);
  });

  it('resets invalid radio when model changes', () => {
    const state = createInitialBuildState('aframe');
    expect(getOptionById(state.radio.wallFinish).name).toBe('Plywood');
    expect(getOptionById(state.radio.flooring).name).toBe('PVC laminate');
  });
});
