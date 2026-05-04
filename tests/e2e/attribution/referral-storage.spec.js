const { test, expect } = require('@playwright/test');

/**
 * Proves public guest shell stores ?ref= into dd_attrib_v2.referralCode.
 * Uses E2E_BASE_URL (default https://driftdwells.com); for local: E2E_BASE_URL=http://127.0.0.1:4173 npm run client:preview (separate terminal) then run this spec.
 */
test.describe('public referral attribution storage', () => {
  test('dd_attrib_v2.referralCode from ?ref=diana.bosa', async ({ page, context }) => {
    await context.addInitScript(() => {
      try {
        localStorage.removeItem('dd_attrib_v2');
        sessionStorage.removeItem('dd_attrib_v1');
      } catch {
        /* ignore */
      }
    });

    await page.goto('/?ref=diana.bosa', { waitUntil: 'domcontentloaded' });
    await expect
      .poll(
        async () => {
          return page.evaluate(() => {
            try {
              const raw = localStorage.getItem('dd_attrib_v2');
              if (!raw) return null;
              return JSON.parse(raw);
            } catch {
              return null;
            }
          });
        },
        { message: 'dd_attrib_v2 with referralCode', timeout: 20_000 }
      )
      .toMatchObject({ referralCode: 'diana.bosa' });
  });

  test('creator=@diana.bosa normalizes to diana.bosa', async ({ page, context }) => {
    await context.addInitScript(() => {
      try {
        localStorage.removeItem('dd_attrib_v2');
        sessionStorage.removeItem('dd_attrib_v1');
      } catch {
        /* ignore */
      }
    });

    await page.goto('/?creator=%40diana.bosa', { waitUntil: 'domcontentloaded' });
    await expect
      .poll(
        async () => {
          return page.evaluate(() => {
            try {
              const raw = localStorage.getItem('dd_attrib_v2');
              if (!raw) return null;
              return JSON.parse(raw);
            } catch {
              return null;
            }
          });
        },
        { timeout: 20_000 }
      )
      .toMatchObject({ referralCode: 'diana.bosa' });
  });

  test('invalid ref with space does not set referralCode', async ({ page, context }) => {
    await context.addInitScript(() => {
      try {
        localStorage.removeItem('dd_attrib_v2');
        sessionStorage.removeItem('dd_attrib_v1');
      } catch {
        /* ignore */
      }
    });

    await page.goto('/?ref=diana%20bosa', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const stored = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('dd_attrib_v2');
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    });
    expect(stored == null || stored.referralCode == null || stored.referralCode === '').toBeTruthy();
  });
});
