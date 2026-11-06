/**
 * Production Apache routing contract for the compiled frontend.
 * A 200 is not enough: prerendered routes must return their own title,
 * and client routes must stay on their path instead of bouncing to /.
 */

export const PRODUCTION_HOST = 'driftdwells.com';

export const ROUTING_CASES = [
  { id: 'home', scheme: 'https', path: '/', titleIncludes: "Off-Grid Cabins in Bulgaria's Mountains" },
  { id: 'search', scheme: 'https', path: '/search?checkIn=2026-11-16&checkOut=2026-11-18&adults=2', stayOnPath: '/search' },
  { id: 'search-bg', scheme: 'https', path: '/bg/search?checkIn=2026-11-16&checkOut=2026-11-18', stayOnPath: '/bg/search' },
  { id: 'checkout', scheme: 'https', path: '/checkout?checkIn=2026-11-16&checkOut=2026-11-18', stayOnPath: '/checkout' },
  { id: 'cabin', scheme: 'https', path: '/cabin?checkIn=2026-11-16', directory: '/cabin/', titleIncludes: '15 km from Bansko', redirectQuery: 'checkIn=2026-11-16' },
  { id: 'cabin-bg', scheme: 'https', path: '/bg/cabin', directory: '/bg/cabin/', titleIncludes: '15 км от Банско' },
  { id: 'valley', scheme: 'https', path: '/valley', directory: '/valley/', titleIncludes: 'The Valley' },
  { id: 'valley-bg', scheme: 'https', path: '/bg/valley', directory: '/bg/valley/', titleIncludes: 'The Valley' },
  { id: 'stay-cabin', scheme: 'https', path: '/stays/the-cabin', directory: '/stays/the-cabin/', titleIncludes: '15 km from Bansko' },
  { id: 'stay-a-frame', scheme: 'https', path: '/stays/a-frame', directory: '/stays/a-frame/', titleIncludes: 'Valley A-Frame' },
  { id: 'stay-lux', scheme: 'https', path: '/stays/lux-cabin', directory: '/stays/lux-cabin/', titleIncludes: 'Luxury Cabin' },
  { id: 'stay-stone', scheme: 'https', path: '/stays/stone-house', directory: '/stays/stone-house/', titleIncludes: 'Stone House' },
  { id: 'stay-cabin-bg', scheme: 'https', path: '/bg/stays/the-cabin', directory: '/bg/stays/the-cabin/', titleIncludes: '15 км от Банско' },
  { id: 'gift-vouchers', scheme: 'https', path: '/gift-vouchers', directory: '/gift-vouchers/', titleIncludes: 'Gift Vouchers' },
  { id: 'gift-vouchers-bg', scheme: 'https', path: '/bg/gift-vouchers', directory: '/bg/gift-vouchers/', titleIncludes: 'Подаръчни ваучери' },
  { id: 'confirm', scheme: 'https', path: '/stays/the-cabin/confirm?checkIn=2026-11-16&checkOut=2026-11-18&adults=2', stayOnPath: '/stays/the-cabin/confirm' },
  { id: 'confirm-bg', scheme: 'https', path: '/bg/stays/a-frame/confirm?checkIn=2026-11-16&checkOut=2026-11-18', stayOnPath: '/bg/stays/a-frame/confirm' },
  { id: 'booking-success', scheme: 'https', path: '/booking-success/route-check?session_id=cs_test_route', stayOnPath: '/booking-success/route-check' },
  { id: 'gift-success', scheme: 'https', path: '/gift-vouchers/success?session_id=cs_test_route', stayOnPath: '/gift-vouchers/success' },
  { id: 'gift-redeem', scheme: 'https', path: '/gift-vouchers/redeem', stayOnPath: '/gift-vouchers/redeem' },
  { id: 'continuation', scheme: 'https', path: '/booking-continuation/route-check', stayOnPath: '/booking-continuation/route-check' },
  { id: 'index-html', scheme: 'https', path: '/index.html?utm=gate', redirectPath: '/', redirectQuery: 'utm=gate' },
  { id: 'http-search', scheme: 'http', path: '/search?stay=1', location: 'https://driftdwells.com/search?stay=1' },
  { id: 'www-valley', scheme: 'https', host: 'www.driftdwells.com', path: '/valley?x=1', location: 'https://driftdwells.com/valley?x=1' }
];

export function isHomepageRedirect(location, requestPath) {
  if (!location) return false;
  let url;
  try {
    url = new URL(location, 'https://driftdwells.com');
  } catch {
    return false;
  }
  const path = url.pathname || '/';
  const requested = requestPath.split('?')[0];
  if (requested === '/' || requested === '/index.html') return false;
  return path === '/' || path === '/index.html';
}

export function titleFromHtml(html) {
  const match = String(html || '').match(/<title>(.*?)<\/title>/i);
  if (!match) return '';
  return match[1]
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

/**
 * Remove the original-request guard so an internal rewrite to /index.html
 * is externally redirected to /. This is the PR #47 / #49 regression.
 */
export function faultyIndexRedirect(htaccess) {
  const withoutGuard = String(htaccess)
    .split('\n')
    .filter((line) => !line.includes('%{THE_REQUEST}'))
    .filter((line) => !line.includes('internal SPA rewrite'))
    .filter((line) => !line.includes('Match the original request only'))
    .join('\n');
  if (!/RewriteRule \^index\\.html\$/.test(withoutGuard)) {
    throw new Error('Cannot build the faulty fixture: index.html redirect rule is missing.');
  }
  if (withoutGuard.includes('%{THE_REQUEST}')) {
    throw new Error('Faulty fixture still contains the THE_REQUEST guard.');
  }
  return withoutGuard;
}

export function evaluateRoutingCase(testCase, response) {
  const errors = [];
  const requestPath = testCase.path.split('?')[0];
  if (isHomepageRedirect(response.location, testCase.path) && testCase.id !== 'index-html') {
    errors.push(`${testCase.id} redirected to the homepage (${response.location}).`);
  }
  if (testCase.location) {
    if (response.status !== 301 && response.status !== 302) {
      errors.push(`${testCase.id} expected a redirect, got ${response.status}.`);
    } else if (response.location !== testCase.location) {
      errors.push(`${testCase.id} location ${response.location || 'none'} !== ${testCase.location}.`);
    }
    return { ok: errors.length === 0, errors };
  }
  if (testCase.redirectPath) {
    const location = response.location ? new URL(response.location, 'https://driftdwells.com') : null;
    if (!location || (response.status !== 301 && response.status !== 302)) {
      errors.push(`${testCase.id} expected a redirect to ${testCase.redirectPath}.`);
    } else if (location.pathname !== testCase.redirectPath) {
      errors.push(`${testCase.id} redirected to ${location.pathname}, expected ${testCase.redirectPath}.`);
    } else if (testCase.redirectQuery && location.search !== `?${testCase.redirectQuery}`) {
      errors.push(`${testCase.id} dropped or changed the query string (${location.search}).`);
    }
    return { ok: errors.length === 0, errors };
  }
  const finalPath = response.finalPath || requestPath;
  if (testCase.stayOnPath && finalPath !== testCase.stayOnPath) {
    errors.push(`${testCase.id} ended on ${finalPath}, expected ${testCase.stayOnPath}.`);
  }
  if (testCase.directory && finalPath !== testCase.directory) {
    errors.push(`${testCase.id} ended on ${finalPath}, expected ${testCase.directory}.`);
  }
  if (testCase.redirectQuery && response.location) {
    const location = new URL(response.location, 'https://driftdwells.com');
    if (location.search !== `?${testCase.redirectQuery}`) {
      errors.push(`${testCase.id} did not preserve the query string (${location.search}).`);
    }
  }
  if (response.finalStatus !== 200) {
    errors.push(`${testCase.id} final status ${response.finalStatus}, expected 200.`);
  }
  if (testCase.titleIncludes) {
    const title = titleFromHtml(response.body);
    if (!title.includes(testCase.titleIncludes)) {
      errors.push(`${testCase.id} title "${title}" does not include "${testCase.titleIncludes}".`);
    }
    if (
      testCase.id !== 'home' &&
      (title.includes('Off-Grid Mountain Retreats in Bulgaria') ||
        title.includes('Off-grid cabin and mountain village stays') ||
        title.includes("Off-Grid Cabins in Bulgaria's Mountains"))
    ) {
      errors.push(`${testCase.id} rendered the homepage title.`);
    }
  }
  return { ok: errors.length === 0, errors };
}
