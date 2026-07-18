import { describe, it, expect } from 'vitest';
import { isInAppBrowser, getUaClass } from './inAppBrowser';

describe('inAppBrowser', () => {
  it('detects Instagram and Facebook UAs', () => {
    expect(isInAppBrowser('Mozilla/5.0 Instagram 300.0.0')).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 FBAN/FBIOS')).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit')).toBe(true);
  });

  it('does not flag desktop Chrome or mobile Safari', () => {
    expect(
      isInAppBrowser(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      )
    ).toBe(false);
    expect(
      isInAppBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      )
    ).toBe(false);
  });

  it('classifies uaClass coarsely', () => {
    expect(getUaClass('Instagram 1.0')).toBe('instagram');
    expect(getUaClass('FBAN/FBIOS')).toBe('facebook');
    expect(
      getUaClass(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'
      )
    ).toBe('safari');
    expect(getUaClass('Chrome/120')).toBe('other');
  });
});
