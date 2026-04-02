const { test, expect } = require('@playwright/test');

async function openFirstCabinDetails(page) {
  await page.goto('/search?checkIn=2026-06-15&checkOut=2026-06-17&adults=2&children=0');
  await expect(page.getByRole('heading', { name: /browse stays/i })).toBeVisible();

  const detailsBtn = page.getByRole('button', { name: /view details|select this cabin/i }).first();
  await expect(detailsBtn).toBeVisible();
  await detailsBtn.click();

  await expect(page).toHaveURL(/\/cabin\/|\/stays\//);
}

test.describe('booking flow', () => {
  test('date search requests availability', async ({ page }) => {
    await page.goto('/search?checkIn=2026-06-15&checkOut=2026-06-17&adults=2&children=0');
    await expect(page.getByRole('heading', { name: /^Browse stays$/i })).toBeVisible();
    await expect(page).toHaveURL(/checkIn=2026-06-15/);
    await expect(page).toHaveURL(/checkOut=2026-06-17/);
  });

  test('large party still sees listings (capacity/eligibility messaging)', async ({ page }) => {
    await page.goto('/search?checkIn=2026-06-15&checkOut=2026-06-17&adults=10&children=10');
    await expect(page.getByRole('heading', { name: /^Browse stays$/i })).toBeVisible();

    const resultsGrid = page.locator('.card-cabin');
    const emptyCatalog = page.getByRole('heading', { name: /no properties to show/i });
    await expect(resultsGrid.first().or(emptyCatalog)).toBeVisible();
  });

  test('confirm form validation blocks invalid guest info', async ({ page }) => {
    await openFirstCabinDetails(page);
    await page.locator('[data-booking-primary-cta="true"]').first().click();

    await expect(page).toHaveURL(/\/confirm/);
    await expect(page.getByRole('heading', { name: /confirm and pay/i })).toBeVisible();

    await page.fill('#confirm-first-name', 'QA');
    await page.fill('#confirm-last-name', 'User');
    await page.fill('#confirm-email', 'not-an-email');
    await page.fill('#confirm-phone', '+359000000');

    await expect(page.getByText(/add your guest details before continuing to payment/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /confirm and pay/i })).toBeDisabled();
  });

  test('valid booking path reaches safe pre-submit point', async ({ page }) => {
    await openFirstCabinDetails(page);
    await page.locator('[data-booking-primary-cta="true"]').first().click();

    await expect(page).toHaveURL(/\/confirm/);
    await page.fill('#confirm-first-name', 'QA');
    await page.fill('#confirm-last-name', 'Automation');
    await page.fill('#confirm-email', 'qa.automation@example.com');
    await page.fill('#confirm-phone', '+359888000000');

    // Non-destructive stopping point: form valid and submit available.
    await expect(page.getByRole('button', { name: /confirm and pay/i })).toBeEnabled();
  });

  test('booking success path only runs in explicit test mode', async ({ page }) => {
    test.skip(
      process.env.E2E_ALLOW_BOOKING_SUBMIT !== 'true',
      'Skipping destructive booking submit without explicit E2E_ALLOW_BOOKING_SUBMIT=true'
    );

    await openFirstCabinDetails(page);
    await page.locator('[data-booking-primary-cta="true"]').first().click();
    await expect(page).toHaveURL(/\/confirm/);

    await page.fill('#confirm-first-name', 'QA');
    await page.fill('#confirm-last-name', 'Automation');
    await page.fill('#confirm-email', 'qa.automation@example.com');
    await page.fill('#confirm-phone', '+359888000000');
    await page.getByRole('button', { name: /confirm and pay/i }).click();

    await expect(page).toHaveURL(/\/booking-success\//);
  });
});
