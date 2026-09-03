import { describe, expect, it } from 'vitest';
import {
  applyReferralCodeNormalization,
  normalizeReferralCodeForPreview
} from './referralCodeNormalize';

describe('referralCodeNormalize (creator portal preview)', () => {
  it('matches backend: strip ZWSP, trim, lowercase, strip leading @, trim again', () => {
    expect(applyReferralCodeNormalization('  \u200B@Foo.Bar\u200B  ')).toBe('foo.bar');
    expect(applyReferralCodeNormalization('@@hello')).toBe('hello');
    expect(applyReferralCodeNormalization('  HELLO  ')).toBe('hello');
  });

  it('returns null for invalid preview (no valid-looking preview)', () => {
    expect(normalizeReferralCodeForPreview('BAD CODE!!')).toBeNull();
    expect(normalizeReferralCodeForPreview('has space')).toBeNull();
    expect(normalizeReferralCodeForPreview('')).toBeNull();
    expect(normalizeReferralCodeForPreview(null)).toBeNull();
    expect(normalizeReferralCodeForPreview('a'.repeat(81))).toBeNull();
  });

  it('accepts valid Instagram-style codes', () => {
    expect(normalizeReferralCodeForPreview('@drift.dwells')).toBe('drift.dwells');
    expect(normalizeReferralCodeForPreview('ok_code-1')).toBe('ok_code-1');
  });
});
