import { describe, expect, it } from 'vitest';
import {
  UTM_FIELD_MAX_LENGTH,
  UTM_CUSTOM_SOURCE_MAX_LENGTH,
  CREATOR_SHARE_PLATFORMS,
  CREATOR_SHARE_PRESET_SOURCES,
  normalizeUtmCampaignInput,
  normalizeCustomUtmSource,
  resolveCreatorShareUtmSource,
  decideCreatorShareFormIdentityTransition,
  buildCreatorCampaignShareUrl
} from './creatorShareLink';

describe('creatorShareLink', () => {
  it('exposes presets plus Other and length caps of 200', () => {
    expect(CREATOR_SHARE_PRESET_SOURCES).toEqual(['instagram', 'tiktok', 'facebook']);
    expect(CREATOR_SHARE_PLATFORMS.map((p) => p.id)).toEqual([
      'instagram',
      'tiktok',
      'facebook',
      'other'
    ]);
    expect(UTM_FIELD_MAX_LENGTH).toBe(200);
    expect(UTM_CUSTOM_SOURCE_MAX_LENGTH).toBe(200);
  });

  it('normalizes campaign: trim + clip exactly 200; omits empty', () => {
    expect(normalizeUtmCampaignInput('  summer-story  ')).toBe('summer-story');
    expect(normalizeUtmCampaignInput('')).toBeNull();
    expect(normalizeUtmCampaignInput('   ')).toBeNull();
    expect(normalizeUtmCampaignInput(null)).toBeNull();
    expect(normalizeUtmCampaignInput(['x'])).toBeNull();
    const exact = 'a'.repeat(200);
    expect(normalizeUtmCampaignInput(exact)).toBe(exact);
    expect(normalizeUtmCampaignInput(`${exact}X`)).toBe(exact);
    expect(normalizeUtmCampaignInput(`${exact}X`).includes('X')).toBe(false);
  });

  it('normalizes Other custom source: trim, lowercase, max 200', () => {
    expect(normalizeCustomUtmSource('  My.Blog  ')).toBe('my.blog');
    expect(normalizeCustomUtmSource('')).toBeNull();
    expect(normalizeCustomUtmSource('   ')).toBeNull();
    expect(normalizeCustomUtmSource(null)).toBeNull();
    expect(normalizeCustomUtmSource('A'.repeat(250))).toBe('a'.repeat(200));
  });

  it('resolveCreatorShareUtmSource uses presets or custom Other', () => {
    expect(resolveCreatorShareUtmSource('instagram')).toBe('instagram');
    expect(resolveCreatorShareUtmSource('tiktok')).toBe('tiktok');
    expect(resolveCreatorShareUtmSource('facebook')).toBe('facebook');
    expect(resolveCreatorShareUtmSource('other', '')).toBeNull();
    expect(resolveCreatorShareUtmSource('other', '  NewsLetter  ')).toBe('newsletter');
    expect(resolveCreatorShareUtmSource('snapchat')).toBeNull();
  });

  it('builds URL via URL API with ref, utm_source, utm_medium=creator', () => {
    const url = buildCreatorCampaignShareUrl({
      origin: 'https://driftdwells.com',
      referralCode: 'victoria',
      platform: 'instagram'
    });
    expect(url).toBe(
      'https://driftdwells.com/?ref=victoria&utm_source=instagram&utm_medium=creator'
    );
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/');
    expect(parsed.searchParams.getAll('ref')).toEqual(['victoria']);
    expect(parsed.searchParams.getAll('utm_source')).toEqual(['instagram']);
    expect(parsed.searchParams.getAll('utm_medium')).toEqual(['creator']);
    expect(parsed.searchParams.getAll('utm_campaign')).toEqual([]);
  });

  it('appends utm_campaign only when present; encodes special characters; clips to 200', () => {
    const withCamp = buildCreatorCampaignShareUrl({
      origin: 'https://example.com',
      referralCode: 'code.one',
      platform: 'tiktok',
      campaign: '  a&b=c?d#e  '
    });
    const parsed = new URL(withCamp);
    expect(parsed.searchParams.get('utm_campaign')).toBe('a&b=c?d#e');
    expect(withCamp).toContain('utm_campaign=a%26b%3Dc%3Fd%23e');

    const blankCamp = buildCreatorCampaignShareUrl({
      origin: 'https://example.com',
      referralCode: 'code.one',
      platform: 'facebook',
      campaign: '   '
    });
    expect(blankCamp).toBe(
      'https://example.com/?ref=code.one&utm_source=facebook&utm_medium=creator'
    );

    const long = buildCreatorCampaignShareUrl({
      origin: 'https://example.com',
      referralCode: 'code.one',
      platform: 'instagram',
      campaign: 'x'.repeat(201)
    });
    expect(new URL(long).searchParams.get('utm_campaign')).toBe('x'.repeat(200));
  });

  it('Other requires custom source; encodes without injecting extra params', () => {
    expect(
      buildCreatorCampaignShareUrl({
        origin: 'https://driftdwells.com',
        referralCode: 'victoria',
        platform: 'other',
        customSource: ''
      })
    ).toBe('');

    const url = buildCreatorCampaignShareUrl({
      origin: 'https://driftdwells.com',
      referralCode: 'victoria',
      platform: 'other',
      customSource: 'foo&utm_medium=evil'
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.getAll('utm_source')).toEqual(['foo&utm_medium=evil']);
    expect(parsed.searchParams.getAll('utm_medium')).toEqual(['creator']);
    expect(parsed.searchParams.get('ref')).toBe('victoria');
  });

  it('returns empty for missing code, origin, or unknown platform', () => {
    expect(
      buildCreatorCampaignShareUrl({
        origin: 'https://driftdwells.com',
        referralCode: '',
        platform: 'instagram'
      })
    ).toBe('');
    expect(
      buildCreatorCampaignShareUrl({
        origin: '',
        referralCode: 'x',
        platform: 'instagram'
      })
    ).toBe('');
    expect(
      buildCreatorCampaignShareUrl({
        origin: 'https://driftdwells.com',
        referralCode: 'x',
        platform: 'snapchat'
      })
    ).toBe('');
  });

  it('B1 rename keeps builder inputs conceptually: only ref in URL changes', () => {
    const platform = 'instagram';
    const campaign = 'summer-story';
    const before = buildCreatorCampaignShareUrl({
      origin: 'https://driftdwells.com',
      referralCode: 'old.code',
      platform,
      campaign
    });
    const after = buildCreatorCampaignShareUrl({
      origin: 'https://driftdwells.com',
      referralCode: 'new.code',
      platform,
      campaign
    });
    expect(new URL(before).searchParams.get('utm_campaign')).toBe('summer-story');
    expect(new URL(after).searchParams.get('utm_campaign')).toBe('summer-story');
    expect(new URL(before).searchParams.get('ref')).toBe('old.code');
    expect(new URL(after).searchParams.get('ref')).toBe('new.code');
  });
});

describe('decideCreatorShareFormIdentityTransition', () => {
  it('same-creator reload preserves builder state', () => {
    expect(decideCreatorShareFormIdentityTransition('creator-a', 'creator-a')).toEqual({
      shouldResetShareForm: false,
      nextRememberedCreatorId: 'creator-a'
    });
  });

  it('different-creator load resets builder state', () => {
    expect(decideCreatorShareFormIdentityTransition('creator-a', 'creator-b')).toEqual({
      shouldResetShareForm: true,
      nextRememberedCreatorId: 'creator-b'
    });
  });

  it('logout / session loss resets builder state', () => {
    expect(decideCreatorShareFormIdentityTransition('creator-a', null)).toEqual({
      shouldResetShareForm: true,
      nextRememberedCreatorId: null
    });
    expect(decideCreatorShareFormIdentityTransition('creator-a', '')).toEqual({
      shouldResetShareForm: true,
      nextRememberedCreatorId: null
    });
  });

  it('first authenticated load resets to defaults and remembers id', () => {
    expect(decideCreatorShareFormIdentityTransition(null, 'creator-a')).toEqual({
      shouldResetShareForm: true,
      nextRememberedCreatorId: 'creator-a'
    });
  });

  it('failed auth after a remembered creator clears remembered identity', () => {
    const lost = decideCreatorShareFormIdentityTransition('creator-a', null);
    expect(lost.shouldResetShareForm).toBe(true);
    expect(lost.nextRememberedCreatorId).toBeNull();
    // After clear, a later success for another creator still resets (no stale URL inputs).
    expect(decideCreatorShareFormIdentityTransition(lost.nextRememberedCreatorId, 'creator-b')).toEqual(
      {
        shouldResetShareForm: true,
        nextRememberedCreatorId: 'creator-b'
      }
    );
  });
});
