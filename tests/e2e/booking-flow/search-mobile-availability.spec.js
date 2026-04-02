const { test, expect } = require('@playwright/test');

/**
 * Ensures the day-picker grid for June 2026 is visible (caption `aria-label` on the grid).
 * Tries previous, then next, from whatever month the modal opened on.
 */
async function ensureJune2026Grid(dialog) {
  const grid = dialog.getByRole('grid', { name: /june 2026/i });
  const prev = dialog.getByRole('button', { name: /Go to the Previous Month/i });
  const next = dialog.getByRole('button', { name: /Go to the Next Month/i });

  if ((await grid.count()) > 0) return grid;

  for (let i = 0; i < 24; i++) {
    await next.click();
    if ((await grid.count()) > 0) return grid;
  }
  for (let i = 0; i < 24; i++) {
    await prev.click();
    if ((await grid.count()) > 0) return grid;
  }
  throw new Error('June 2026 calendar grid not found in booking modal');
}

/** Picks a civil day in June 2026 (matches EN long names from react-day-picker, e.g. "Thursday, June 20th, 2026"). */
async function pickJune2026Day(dialog, dayOfMonth) {
  const grid = await ensureJune2026Grid(dialog);
  const dayRe = new RegExp(`june ${dayOfMonth}(st|nd|rd|th)?,? 2026`, 'i');
  await grid.getByRole('button', { name: dayRe }).click();
}

test.describe('mobile search results — dates modal and unavailable listings', () => {
  test('dates open BookingModal, new search updates URL, unavailable card has disabled primary CTA', async ({
    page
  }) => {
    const vs = page.viewportSize();
    test.skip(!vs || vs.width >= 768, 'Mobile viewport only (narrow width)');

    await page.goto('/search?checkIn=2026-06-10&checkOut=2026-06-14&adults=2&children=0', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000
    });

    // Title string changed in app update; accept either until production fully rolls over.
    await expect(
      page.getByRole('heading', { level: 1 }).filter({ hasText: /browse stays|available cabins/i })
    ).toBeVisible({ timeout: 25_000 });

    // Post-change: dedicated "Edit dates"; legacy mobile UI only had "Plan your stay" (same modal).
    const editDates = page.getByRole('button', { name: /edit dates/i });
    if (await editDates.count()) {
      await editDates.first().click();
    } else {
      await page.getByRole('button', { name: /plan your stay/i }).click();
    }

    // Multiple role=dialog on site (consent, lazy booking shell). Scope to the booking modal title.
    await expect(page.locator('#booking-modal-title')).toBeVisible({ timeout: 25_000 });
    const dialog = page.locator('[role="dialog"]').filter({ has: page.locator('#booking-modal-title') });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: /plan your stay/i })).toBeVisible();

    await expect(dialog.locator('.booking-modal-daypicker')).toBeVisible({ timeout: 15_000 });

    // Replace the existing URL range: range picks on top of a selection can leave check-in unchanged.
    await dialog.getByRole('button', { name: /^clear$/i }).click();

    await pickJune2026Day(dialog, 20);
    await pickJune2026Day(dialog, 24);

    await dialog
      .getByTestId('booking-modal-submit-search')
      .or(dialog.getByRole('button', { name: /^search$/i }))
      .click();
    await expect(dialog).toBeHidden({ timeout: 25_000 });

    await expect(page).toHaveURL(/checkIn=2026-06-20/);
    await expect(page).not.toHaveURL(/checkOut=2026-06-14/);

    await expect(
      page.getByRole('heading', { level: 1 }).filter({ hasText: /browse stays|available cabins/i })
    ).toBeVisible();

    const unavailableCard = page.locator('[data-testid="search-result-card"][data-available="false"]');
    if ((await unavailableCard.count()) === 0) {
      test.skip(
        true,
        'No unavailable listing for this date query in this environment (depends on bookings / inventory).'
      );
    }

    const firstUnavail = unavailableCard.first();
    await expect(firstUnavail).toHaveAttribute('data-unavailability-reason', /^(dates|min_guests|max_guests|min_nights|criteria)$/);
    const primaryDisabled = firstUnavail.locator('button[disabled]').first();
    await expect(primaryDisabled).toBeVisible();
  });
});
