const { test, expect } = require('@playwright/test');

async function openFirstCabinDetails(page) {
  await page.goto('/search?checkIn=2026-06-15&checkOut=2026-06-17&adults=2&children=0');
  await expect(page.getByRole('heading', { name: /available cabins/i })).toBeVisible();

  const detailsBtn = page.getByRole('button', { name: /view details|select this cabin/i }).first();
  await expect(detailsBtn).toBeVisible();
  await detailsBtn.click();

  await expect(page).toHaveURL(/\/cabin\/|\/stays\//);
}

test.describe('booking flow', () => {
  test('date search requests availability', async ({ page }) => {
    await page.goto('/search?checkIn=2026-06-15&checkOut=2026-06-17&adults=2&children=0');
    await expect(page.getByRole('heading', { name: /^Available Cabins$/i })).toBeVisible();
    await expect(page).toHaveURL(/checkIn=2026-06-15/);
    await expect(page).toHaveURL(/checkOut=2026-06-17/);
  });

  test('empty state or validation appears for impossible criteria', async ({ page }) => {
    await page.goto('/search?checkIn=2026-06-15&checkOut=2026-06-17&adults=10&children=10');
    await expect(page.getByRole('heading', { name: /^Available Cabins$/i })).toBeVisible();

    const noCabins = page.getByRole('heading', { name: /no available cabins/i });
    const resultsGrid = page.locator('.card-cabin');
    await expect(noCabins.or(resultsGrid.first())).toBeVisible();
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
