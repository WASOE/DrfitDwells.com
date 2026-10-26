import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  buildBuildEnquiryPayload,
  makeBuildEnquiryIdempotencyKey,
  validateBuildEnquiryForm
} from './buildEnquiryPayload.js';
import { createInitialBuildState } from './buildConfiguratorLogic.js';

vi.mock('../tracking/attribution.js', () => ({
  getAttributionPayload: () => ({
    utmSource: 'instagram',
    utmMedium: 'social',
    referrer: 'https://example.com'
  }),
  getFunnelSessionKey: () => 'session-test',
  getFunnelVisitorKey: () => 'visitor-test'
}));

describe('buildEnquiryPayload', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', {
      randomUUID: () => '11111111-2222-3333-4444-555555555555'
    });
  });

  it('mints idempotency keys with be_ prefix', () => {
    expect(makeBuildEnquiryIdempotencyKey()).toBe(
      'be_11111111-2222-3333-4444-555555555555'
    );
  });

  it('builds payload for a complete default configuration', () => {
    const state = createInitialBuildState('lux-cabin');
    const payload = buildBuildEnquiryPayload({
      state,
      currentStep: 4,
      contact: { name: 'Ada', email: 'ada@example.com', phone: '+3591' },
      project: {
        location: 'Bansko',
        landStatus: 'owned',
        budget: '30k_50k',
        timeline: 'within_6_months',
        message: 'Hello'
      },
      idempotencyKey: 'be_test_key_01'
    });

    expect(payload.idempotencyKey).toBe('be_test_key_01');
    expect(payload.contact).toEqual({
      name: 'Ada',
      email: 'ada@example.com',
      phone: '+3591'
    });
    expect(payload.project.location).toBe('Bansko');
    expect(payload.config.modelId).toBe('lux-cabin');
    expect(payload.config.radio).toBeTruthy();
    expect(payload.estimate.totalEur).toBeTypeOf('number');
    expect(payload.estimate.displayLabel).toBeTruthy();
    expect(payload.estimate.summaryRows.length).toBeGreaterThan(0);
    expect(payload.configMeta.currentStep).toBe(4);
    expect(payload.configMeta.isPartial).toBe(false);
    expect(payload.attribution.utmSource).toBe('instagram');
    expect(payload.sessionKey).toBe('session-test');
    expect(payload.visitorKey).toBe('visitor-test');
    expect(payload.website).toBe('');
  });

  it('allows partial configs at early steps', () => {
    const state = createInitialBuildState('aframe');
    const payload = buildBuildEnquiryPayload({
      state: { ...state, radio: {}, toggles: [] },
      currentStep: 0,
      contact: { name: 'Bob', email: 'bob@example.com' },
      project: {
        location: 'Sofia',
        landStatus: 'searching',
        budget: 'undecided',
        timeline: 'exploring'
      },
      idempotencyKey: 'be_partial_01'
    });

    expect(payload.config.modelId).toBe('aframe');
    expect(payload.configMeta.isPartial).toBe(true);
    expect(payload.configMeta.stepsVisited).toEqual([0]);
    expect(payload.contact.phone).toBeUndefined();
    expect(payload.project.message).toBeUndefined();
  });

  it('validates required form fields', () => {
    expect(validateBuildEnquiryForm({ contact: {}, project: {} }).ok).toBe(false);
    expect(
      validateBuildEnquiryForm({
        contact: { name: 'Ada', email: 'ada@example.com' },
        project: {
          location: 'Bansko',
          landStatus: 'owned',
          budget: '30k_50k',
          timeline: 'asap'
        }
      }).ok
    ).toBe(true);
  });
});
