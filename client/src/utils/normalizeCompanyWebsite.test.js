import { describe, expect, it } from 'vitest';
import { normalizeCompanyWebsite } from './normalizeCompanyWebsite';

describe('company website normalization', () => {
  it.each([
    ['', ''],
    ['  wasoe.nl  ', 'https://wasoe.nl/'],
    ['www.wasoe.nl', 'https://www.wasoe.nl/'],
    ['https://wasoe.nl', 'https://wasoe.nl/'],
    ['http://wasoe.nl/contact', 'http://wasoe.nl/contact'],
    ['wasoe.nl/team/contact?from=wishlist#hr', 'https://wasoe.nl/team/contact?from=wishlist#hr'],
    ['https://www.wasoe.nl/team/contact?from=wishlist#hr', 'https://www.wasoe.nl/team/contact?from=wishlist#hr'],
    ['https://пример.бг/контакт', 'https://xn--e1afmkfd.xn--90ae/%D0%BA%D0%BE%D0%BD%D1%82%D0%B0%D0%BA%D1%82']
  ])('normalizes %s', (input, expected) => {
    expect(normalizeCompanyWebsite(input)).toBe(expected);
  });
  it.each([
    'not-a-domain', 'https://localhost', 'https://wasoe', 'https://-wasoe.nl',
    'https://wasoe-.nl', 'https://wa_soe.nl', 'https://wasoe..nl', 'https://wasoe.1',
    'https://127.0.0.1', 'https://[::1]', 'wasoe nl', 'https://wasoe.nl/a b',
    'https://user:pass@wasoe.nl', 'user@wasoe.nl', 'https://user@wasoe.nl',
    'javascript:alert(1)', 'data:text/html,hello', 'ftp://wasoe.nl', 'mailto:hr@wasoe.nl',
    'https:wasoe.nl', '/wasoe.nl', '//wasoe.nl', 'https://wasoe.nl\\@evil.com',
    `https://${'a'.repeat(64)}.nl`, `https://wasoe.nl/${'a'.repeat(490)}`
  ])('rejects %s', input => {
    expect(() => normalizeCompanyWebsite(input)).toThrow();
  });
});
