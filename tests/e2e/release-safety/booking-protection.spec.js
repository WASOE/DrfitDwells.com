/**
 * MOCKED browser coverage of the Apache-served production build.
 *
 * Availability, quotes and payment calls are Playwright stubs on the local
 * artifact. This is not staging integration and it is not production
 * end-to-end coverage. Requests to driftdwells.com and Stripe are aborted.
 */
const { test, expect } = require('@playwright/test');

const STAYS = [
  { slug: 'the-cabin', name: 'The Cabin', pricePerNight: 100, totalPrice: 200 },
  { slug: 'a-frame', name: 'A-Frame', pricePerNight: 60, totalPrice: 120 },
  { slug: 'lux-cabin', name: 'Lux Cabin', pricePerNight: 110, totalPrice: 220 },
  { slug: 'stone-house', name: 'Stone House', pricePerNight: 75, totalPrice: 150 }
];

function requireGateBase() {
  const base = process.env.RELEASE_GATE_BASE_URL;
  if (!base) {
    throw new Error('BLOCK: RELEASE_GATE_BASE_URL is required for the Apache browser gate.');
  }
  const host = new URL(base).hostname;
  if (host === 'driftdwells.com' || host === 'www.driftdwells.com') {
    throw new Error('Refusing to run the release gate against production.');
  }
  return base;
}

function cabinFixture(stay) {
  return {
    _id: stay.slug,
    slug: stay.slug,
    name: stay.name,
    location: stay.slug === 'the-cabin'
      ? 'Near Bachevo, in the Razlog area of southwestern Bulgaria'
      : 'Chereshovo / Ortsevo, Rhodope Mountains, Bulgaria',
    description: 'Release-gate fixture. Not a live listing.',
    pricePerNight: stay.pricePerNight,
    totalPrice: stay.totalPrice,
    totalNights: 2,
    pricingMode: 'exact_stay',
    capacity: stay.slug === 'stone-house' ? 6 : 2,
    pricingModel: 'per_night',
    amenities: ['Wood stove']
  };
}

async function installLocalMocks(page) {
  const calls = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.hostname === 'driftdwells.com' ||
      url.hostname === 'www.driftdwells.com' ||
      url.hostname.endsWith('stripe.com')
    ) {
      await route.abort('blockedbyclient');
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    calls.push({ method: route.request().method(), pathname: url.pathname });
    if (route.request().method() !== 'GET' && !url.pathname.includes('/funnel')) {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          code: 'RELEASE_GATE_MOCK',
          message: 'Mocked gate refuses booking and payment writes.'
        })
      });
      return;
    }
    if (url.pathname.startsWith('/api/availability')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { cabins: STAYS.map(cabinFixture) } })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: {} })
    });
  });
  return calls;
}

test.beforeEach(async ({ page }) => {
  requireGateBase();
  await installLocalMocks(page);
});

test('search, stay routes and prices render from the Apache artifact', async ({ page }) => {
  await page.goto('/search?checkIn=2026-11-16&checkOut=2026-11-18&adults=2&children=0');
  await expect(page.getByRole('heading', { name: /browse stays/i })).toBeVisible();
  await expect(page).toHaveURL(/\/search\?/);
  for (const stay of STAYS) {
    await expect(page.getByRole('heading', { name: stay.name, exact: true })).toBeVisible();
    await expect(page.getByText(`€${stay.totalPrice}`).first()).toBeVisible();
    await expect(page.getByText(`€${stay.pricePerNight}/night`).first()).toBeVisible();
  }
  await page.reload();
  await expect(page).toHaveURL(/\/search/);
  await expect(page.getByRole('heading', { name: /dwell in the silence/i })).toHaveCount(0);

  for (const stay of STAYS) {
    await page.goto(`/stays/${stay.slug}/`);
    await expect(page).toHaveURL(new RegExp(`/stays/${stay.slug}/?`));
    await expect(page.getByRole('heading', { level: 1, name: /dwell in the silence/i })).toHaveCount(0);
  }
});

test('checkout, confirmation and voucher routes survive refresh', async ({ page }) => {
  const routes = [
    '/checkout?checkIn=2026-11-16&checkOut=2026-11-18&adults=2',
    '/stays/the-cabin/confirm?checkIn=2026-11-16&checkOut=2026-11-18&adults=2',
    '/booking-success/gate-check',
    '/gift-vouchers/',
    '/gift-vouchers/success',
    '/gift-vouchers/redeem',
    '/booking-continuation/gate-check'
  ];
  for (const route of routes) {
    await page.goto(route);
    await page.reload();
    const pathname = new URL(page.url()).pathname;
    expect(pathname, route).not.toBe('/');
    expect(pathname.startsWith(route.split('?')[0].replace(/\/$/, '')) || pathname === route.split('?')[0], route).toBeTruthy();
    await expect(page.getByRole('heading', { name: /dwell in the silence/i })).toHaveCount(0);
  }
});

test('mocked gate does not issue booking or payment writes', async ({ page }) => {
  const calls = await installLocalMocks(page);
  await page.goto('/search?checkIn=2026-11-16&checkOut=2026-11-18&adults=2&children=0');
  await expect(page.getByRole('heading', { name: /browse stays/i })).toBeVisible();
  const writes = calls.filter((call) => call.method !== 'GET' && !call.pathname.includes('/funnel'));
  expect(writes).toEqual([]);
});
