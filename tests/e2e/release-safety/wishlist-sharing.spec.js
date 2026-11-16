const { test, expect } = require('@playwright/test');
const { validateCorporateGiftLead } = require('../../../server/services/corporateGiftLeads/validation');

test.beforeEach(async ({ page }, testInfo) => {
  if (!process.env.RELEASE_GATE_BASE_URL) throw new Error('RELEASE_GATE_BASE_URL is required');
  if (testInfo.project.name.includes('mobile')) await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === 'wa.me' || url.protocol === 'mailto:') return route.abort();
    if (url.pathname === '/api/public/corporate-gift-leads') {
      const validation = validateCorporateGiftLead(request.postDataJSON());
      return route.fulfill({ status: validation.ok ? 200 : 400, json: { success: validation.ok } });
    }
    // Never write to live bookings, payments, leads or analytics in these tests.
    if (!['GET', 'HEAD'].includes(request.method())) return route.fulfill({ status: 200, json: { success: true } });
    if (url.hostname.endsWith('stripe.com')) return route.abort();
    return route.continue();
  });
});

for (const bg of [false, true]) {
  const locale = bg ? 'BG' : 'EN';
  const route = `${bg ? '/bg' : ''}/wishlist/`;
  const personalLabel = bg ? 'Подскажи на любим човек ;)' : 'Hint a loved one ;)';
  for (const mode of ['nomination', 'hr']) {
    test(`${locale} ${mode} accepts normalized URLs and rejects invalid websites`, async ({ page }) => {
      for (const website of ['wasoe.nl', 'www.wasoe.nl', 'https://wasoe.nl', 'wasoe.nl/team/contact?ref=gift']) {
        await page.goto(`${route}${mode === 'hr' ? '?intent=hr' : ''}`);
        const form = page.locator('#root #wishlist-form');
        await form.getByLabel(bg ? 'Име на компанията' : 'Company name', { exact: true }).fill('Browser test - intercepted only');
        if (mode === 'hr') {
          await form.getByLabel(bg ? 'Вашето име' : 'Your name', { exact: true }).fill('Test HR');
          await form.getByLabel(bg ? 'Служебен имейл' : 'Work email', { exact: true }).fill('hr@example.com');
        }
        const input = form.locator('input[inputmode="url"]');
        await expect(input).toHaveAttribute('type', 'text');
        await input.fill(website);
        await form.getByRole('checkbox').check();
        const requestPromise = page.waitForRequest('**/api/public/corporate-gift-leads');
        await form.locator('button[type="submit"]').click();
        const request = await requestPromise;
        expect(request.postDataJSON().companyWebsite).toBe(new URL(website.startsWith('https://') ? website : `https://${website}`).href);
        expect(request.postDataJSON().type).toBe(mode);
        await expect(form.getByRole('status')).toBeVisible();
      }
      await page.goto(`${route}${mode === 'hr' ? '?intent=hr' : ''}`);
      const form = page.locator('#root #wishlist-form');
      await form.getByLabel(bg ? 'Име на компанията' : 'Company name', { exact: true }).fill('Test company');
      if (mode === 'hr') {
        await form.getByLabel(bg ? 'Вашето име' : 'Your name', { exact: true }).fill('Test HR');
        await form.getByLabel(bg ? 'Служебен имейл' : 'Work email', { exact: true }).fill('hr@example.com');
      }
      await form.getByRole('checkbox').check();
      let submissions = 0;
      page.on('request', request => { if (request.url().includes('/api/public/corporate-gift-leads')) submissions += 1; });
      for (const website of ['not-a-domain', 'https://user:password@wasoe.nl', 'javascript:alert(1)', 'ftp://wasoe.nl']) {
        await form.locator('input[inputmode="url"]').fill(website);
        await form.locator('button[type="submit"]').click();
        await expect(form.getByRole('alert')).toContainText(bg ? 'валиден' : 'valid');
      }
      expect(submissions).toBe(0);
    });
  }

  test(`${locale} personal sharing uses gift vouchers, requires clicks and never submits a lead`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: process.env.RELEASE_GATE_BASE_URL });
    const leadRequests = [];
    page.on('request', request => { if (request.url().includes('/corporate-gift-leads')) leadRequests.push(request.url()); });
    await page.goto(route);
    const form = page.locator('#root #wishlist-form');
    await form.getByLabel(personalLabel, { exact: true }).check();
    await expect(form.locator('form')).toHaveCount(0);
    const message = form.getByRole('textbox', { name: bg ? 'Твоето съобщение' : 'Your message', exact: true });
    await expect(message).toHaveValue(/Drift & Dwells/);
    const edited = bg ? 'Мечтая за планината & време за нас ;)' : 'Mountains & time together, please ;)';
    await message.fill(edited);
    const giftUrl = `https://driftdwells.com${bg ? '/bg' : ''}/gift-vouchers`;
    const whatsapp = form.getByRole('link', { name: 'WhatsApp', exact: true });
    expect(new URL(await whatsapp.getAttribute('href')).searchParams.get('text')).toBe(`${edited}\n\n${giftUrl}`);
    // Capture the user-triggered action without sending a message or opening an external app.
    await form.evaluate(element => element.addEventListener('click', event => {
      const link = event.target.closest('a');
      if (link) { event.preventDefault(); window.__wishlistShareClick = link.href; }
    }));
    await whatsapp.click();
    expect(await page.evaluate(() => window.__wishlistShareClick)).toBe(await whatsapp.getAttribute('href'));
    const email = form.getByRole('link', { name: bg ? 'Имейл' : 'Email', exact: true });
    const mailUrl = new URL(await email.getAttribute('href'));
    expect(mailUrl.protocol).toBe('mailto:');
    expect(mailUrl.searchParams.get('body')).toBe(`${edited}\n\n${giftUrl}`);
    expect(mailUrl.searchParams.get('subject')).toContain(bg ? 'подсказка' : 'hint');
    await email.click();
    expect(await page.evaluate(() => window.__wishlistShareClick)).toBe(await email.getAttribute('href'));
    await form.getByRole('button', { name: bg ? 'Копирай линка' : 'Copy Link', exact: true }).click();
    await expect(form.getByRole('status')).toContainText(bg ? 'копиран' : 'copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(giftUrl);
    expect(leadRequests).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const label of [bg ? 'Предложение от служител' : 'Employee nomination', bg ? 'Купувате за екип?' : 'Buying for a team?', personalLabel]) {
      await form.getByLabel(label, { exact: true }).check();
      await expect(form.getByLabel(label, { exact: true })).toBeChecked();
    }
    const localGiftRoute = new URL(giftUrl).pathname;
    await page.goto(localGiftRoute);
    await expect(page).toHaveURL(new RegExp(`${localGiftRoute}/?$`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
}
