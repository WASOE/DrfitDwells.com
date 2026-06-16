import { describe, expect, it } from 'vitest';
import { buildBuildEnquiryMailto } from './buildConfiguratorExport.js';
import { createInitialBuildState, sanitizeBuildState } from './buildConfiguratorLogic.js';

describe('buildConfiguratorExport', () => {
  it('builds mailto with model in subject and encoded body', () => {
    const state = createInitialBuildState('lux-cabin');
    const mailto = buildBuildEnquiryMailto(state, 'hello@driftdwells.com');

    expect(mailto).toMatch(/^mailto:hello@driftdwells\.com\?subject=/);
    expect(decodeURIComponent(mailto)).toContain('Drift & Dwells build enquiry — The Lux Cabin');
    expect(decodeURIComponent(mailto)).toContain('Model: The Lux Cabin');
    expect(decodeURIComponent(mailto)).toContain('Estimate:');
  });

  it('uses From prefix when consultation items are selected', () => {
    const state = sanitizeBuildState({
      modelId: 'lux-cabin',
      customDimensions: null,
      radio: {
        ...createInitialBuildState('lux-cabin').radio,
        wallFinish: 'finish-pine-planks',
      },
      toggles: [],
    });
    const mailto = buildBuildEnquiryMailto(state, 'hello@driftdwells.com');
    expect(decodeURIComponent(mailto)).toContain('Estimate: From €32,000');
  });

  it('includes A-Frame summaryNote in body', () => {
    const state = createInitialBuildState('aframe');
    const mailto = buildBuildEnquiryMailto(state, 'hello@driftdwells.com');
    expect(decodeURIComponent(mailto)).toContain('structural shell');
  });

  it('keeps body within 8 lines', () => {
    const state = sanitizeBuildState({
      modelId: 'lux-cabin',
      customDimensions: { length: 8, width: 3 },
      radio: createInitialBuildState('lux-cabin').radio,
      toggles: ['heat-ac', 'extra-solar', 'extra-hot-tub'],
    });
    const mailto = buildBuildEnquiryMailto(state, 'hello@driftdwells.com');
    const body = decodeURIComponent(mailto.split('body=')[1] ?? '');
    expect(body.split('\n').length).toBeLessThanOrEqual(8);
  });
});
