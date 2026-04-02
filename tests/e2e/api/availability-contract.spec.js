const { test, expect } = require('@playwright/test');

/**
 * Contract for GET /api/availability (guest search).
 *
 * Expects the merged API shape: `totalListings`, `availableCount`, legacy `totalFound`,
 * and `cabins[].available`. Fails against older backends that omit `totalListings` until deployed.
 *
 * Runs against E2E_BASE_URL (see playwright.config.js); requires a reachable API + DB.
 */
test.describe('GET /api/availability contract', () => {
  test('response includes counts, listing length, and boolean available on every row', async ({
    request,
    baseURL
  }) => {
    const qs = new URLSearchParams({
      checkIn: '2026-06-15',
      checkOut: '2026-06-17',
      adults: '2',
      children: '0'
    });
    const res = await request.get(`${baseURL}/api/availability?${qs.toString()}`);
    const raw = await res.text();
    expect(res.status(), `Expected 200, got ${res.status()}: ${raw.slice(0, 400)}`).toBe(200);

    const body = JSON.parse(raw);
    expect(body.success).toBeTruthy();
    expect(body.data).toBeTruthy();

    const { cabins, totalFound, totalListings, availableCount } = body.data;
    expect(Array.isArray(cabins)).toBeTruthy();
    expect(typeof totalFound).toBe('number');
    expect(typeof totalListings).toBe('number');
    expect(typeof availableCount).toBe('number');

    expect(totalListings).toBe(cabins.length);
    expect(totalFound).toBe(availableCount);

    for (const c of cabins) {
      expect(typeof c.available).toBe('boolean');
      if (!c.available) {
        expect(typeof c.unavailabilityReason).toBe('string');
        expect(['min_guests', 'max_guests', 'min_nights', 'dates', 'criteria']).toContain(
          c.unavailabilityReason
        );
      }
    }

    const hasAvailable = cabins.some((c) => c.available);
    const hasUnavailable = cabins.some((c) => !c.available);
    if (!hasAvailable || !hasUnavailable) {
      test.skip(
        true,
        'Need at least one bookable and one unavailable listing for mixed-availability assertion (depends on DB / dates).'
      );
    }
    expect(hasAvailable && hasUnavailable).toBeTruthy();
  });
});
