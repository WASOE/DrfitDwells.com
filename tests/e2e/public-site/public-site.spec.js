const { test, expect } = require('@playwright/test');

test.describe('public site', () => {
  test('homepage loads with key nav links', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Drift & Dwells/i);

    await expect(page.getByRole('link', { name: /home/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /cabin/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /valley/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /about/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /build/i }).first()).toBeVisible();
  });

  test('key listing pages render images and content', async ({ page }) => {
    await page.goto('/cabin');
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(page.locator('img').first()).toBeVisible();

    await page.goto('/valley');
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(page.locator('img').first()).toBeVisible();
  });

  test('booking button opens booking flow entrypoint', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-chromium', 'Desktop booking CTA assertion');
    await page.goto('/');
    const bookBtn = page.getByRole('button', { name: /^book$/i }).first();
    await bookBtn.click();
    await expect(page.getByRole('heading', { name: /plan your stay/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /search/i }).first()).toBeVisible();
  });

  test('mobile viewport can open menu and booking modal', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile-only sanity check');
    await page.goto('/');
    await page.getByRole('button', { name: /toggle menu/i }).click();
    await expect(page.getByRole('link', { name: /cabin/i }).first()).toBeVisible();
    await page.getByRole('button', { name: /^search$/i }).first().click();
    await expect(page.getByRole('heading', { name: /plan your stay/i })).toBeVisible();
  });

  test('gift voucher preview switches to BG card copy with BG route toggle', async ({ page }) => {
    await page.goto('/gift-vouchers');
    await expect(page.locator('[data-gv-card-brand-line="1"]').first()).toContainText(
      'The gift of time offline.'
    );

    await page.getByRole('button', { name: /^BG$/ }).first().click();
    await expect(page).toHaveURL(/\/bg\/gift-vouchers$/);

    const brandLine = page.locator('[data-gv-card-brand-line="1"]').first();
    await expect(brandLine).toContainText('Подари време офлайн.');
    await expect(brandLine).not.toContainText('The gift of time offline.');
    await expect(page.locator('[data-gv-card-form-block="1"]').first()).toContainText('ЗА');
    await expect(page.locator('[data-gv-card-form-block="1"]').first()).toContainText('СТОЙНОСТ');
  });

  test('gift voucher mobile preview keeps logo and brand line readable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/bg/gift-vouchers');

    const card = page.locator('[data-gv-card-template]').first();
    const logo = page.locator('[data-gv-card-logo="1"]').first();
    const brandLine = page.locator('[data-gv-card-brand-line="1"]').first();

    await expect(card).toBeVisible();
    await expect(logo).toBeVisible();
    await expect(brandLine).toBeVisible();

    const [cardBox, logoBox, brandBox] = await Promise.all([
      card.boundingBox(),
      logo.boundingBox(),
      brandLine.boundingBox()
    ]);

    expect(cardBox).not.toBeNull();
    expect(logoBox).not.toBeNull();
    expect(brandBox).not.toBeNull();

    expect(logoBox.width).toBeGreaterThanOrEqual(92);
    expect(logoBox.width).toBeLessThanOrEqual(108);
    expect(brandBox.width).toBeGreaterThanOrEqual(cardBox.width * 0.6);

    const lineCount = await brandLine.evaluate((el) => {
      const style = window.getComputedStyle(el);
      const lineHeight = parseFloat(style.lineHeight || '0') || 1;
      return el.clientHeight / lineHeight;
    });
    expect(lineCount).toBeLessThanOrEqual(2.1);
  });
});
