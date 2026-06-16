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
    expect(isOptionAvailableForModel(rainwater, 'lux-cabin', 'cabin')).toBe(true);
  });

  it('keeps the same interior option sets for cabin and A-Frame', () => {
    const cabinInterior = getOptionsForCategory('wallFinish', 'lux-cabin');
    const aframeInterior = getOptionsForCategory('wallFinish', 'aframe');

    expect(cabinInterior.map((o) => o.id)).toEqual(aframeInterior.map((o) => o.id));
    expect(cabinInterior.map((o) => o.id)).toEqual(['finish-plywood', 'finish-pine-planks']);
  });

  it('does not offer SPC or solid oak flooring options', () => {
    const names = BUILD_OPTIONS.map((o) => o.name.toLowerCase()).join(' ');
    expect(names).not.toMatch(/spc|stone-core|solid oak/);
  });

  it('uses PVC laminate and plywood as included defaults', () => {
    const state = createInitialBuildState('lux-cabin');
    expect(state.radio.wallFinish).toBe('finish-plywood');
    expect(state.radio.flooring).toBe('floor-pvc-laminate');
  });

  it('computes Lux Cabin base price at €32,000 and A Frame at €20,000', () => {
    expect(computeBuildTotal(createInitialBuildState('lux-cabin')).total).toBe(32000);
    expect(computeBuildTotal(createInitialBuildState('aframe')).total).toBe(20000);
    expect(computeBuildTotal(createInitialBuildState('lux-cabin')).hasConsultationItems).toBe(false);
  });

  it('maps legacy 6x3 and 7x3 model ids to lux-cabin', () => {
    expect(createInitialBuildState('7x3').modelId).toBe('lux-cabin');
    expect(createInitialBuildState('6x3').modelId).toBe('lux-cabin');
  });

  it('adds custom size surcharge above 21 m² for cabins only', () => {
    const sized = computeCustomSizePrice(32000, 8, 3);
    expect(sized.areaSqm).toBe(24);
    expect(sized.extraPrice).toBe(4500);
    expect(sized.total).toBe(36500);

    const state = sanitizeBuildState({
      modelId: 'lux-cabin',
      customDimensions: { length: 8, width: 3 },
      radio: createInitialBuildState('lux-cabin').radio,
      toggles: [],
    });
    expect(computeBuildTotal(state).total).toBe(36500);

    const large = computeCustomSizePrice(32000, 10, 4);
    expect(large.areaSqm).toBe(40);
    expect(large.extraPrice).toBe(28500);
    expect(large.total).toBe(60500);
  });

  it('clears custom dimensions when switching to A-Frame', () => {
    const state = sanitizeBuildState(
      {
        modelId: 'lux-cabin',
        customDimensions: { length: 10, width: 4 },
        radio: createInitialBuildState('lux-cabin').radio,
        toggles: ['extra-rainwater'],
      },
      'aframe'
    );

    expect(state.customDimensions).toBeNull();
    expect(state.toggles).not.toContain('extra-rainwater');
  });

  it('excludes consultation-priced options from numeric total', () => {
    const state = sanitizeBuildState({
      modelId: 'lux-cabin',
      customDimensions: null,
      radio: {
        ...createInitialBuildState('lux-cabin').radio,
        wallFinish: 'finish-pine-planks',
        flooring: 'floor-wooden-planks',
      },
      toggles: ['heat-underfloor'],
    });

    const result = computeBuildTotal(state);
    expect(result.total).toBe(32000);
    expect(result.hasConsultationItems).toBe(true);
    expect(getConsultationOptionIds(state).sort()).toEqual(
      ['finish-pine-planks', 'floor-wooden-planks', 'heat-underfloor'].sort()
    );
  });

  it('prefixes bar price with From when consultation items are active', () => {
    const withConsultation = computeBuildTotal(
      sanitizeBuildState({
        modelId: 'lux-cabin',
        customDimensions: null,
        radio: {
          ...createInitialBuildState('lux-cabin').radio,
          wallFinish: 'finish-pine-planks',
        },
        toggles: [],
      })
    );
    expect(formatBuildBarPrice(withConsultation)).toBe('From €32,000');

    const fixedOnly = computeBuildTotal(
      sanitizeBuildState({
        modelId: 'lux-cabin',
        customDimensions: null,
        radio: createInitialBuildState('lux-cabin').radio,
        toggles: ['extra-solar'],
      })
    );
    expect(formatBuildBarPrice(fixedOnly)).toBe('€39,200');
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
      modelId: 'lux-cabin',
      customDimensions: null,
      radio: createInitialBuildState('lux-cabin').radio,
      toggles: ['extra-solar', 'extra-rainwater'],
    });

    expect(computeBuildTotal(state).total).toBe(32000 + 7200 + 2800);
  });

  it('resets invalid radio when model changes', () => {
    const state = createInitialBuildState('aframe');
    expect(getOptionById(state.radio.wallFinish).name).toBe('Plywood');
    expect(getOptionById(state.radio.flooring).name).toBe('PVC laminate');
  });
});
