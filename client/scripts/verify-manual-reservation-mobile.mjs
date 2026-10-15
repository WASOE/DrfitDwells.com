import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:3017';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname), 'Use a local frontend only');
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox']
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 432, height: 936, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(() => localStorage.setItem('adminToken', 'local-browser-test'));
  let submitted = null;
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return request.continue();
    let data = {};
    if (url.pathname === '/api/ops/session') data = {
      authenticated: true, actorId: 'test-admin', role: 'admin', modules: ['*'],
      actions: ['ops.reservation.manual_create'], defaultRoute: '/ops', locale: 'en'
    };
    if (url.pathname === '/api/ops/reservations') data = {
      items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 }
    };
    if (url.pathname === '/api/ops/cabins') data = {
      items: [{ cabinId: 'parent', name: 'A-Frame', kind: 'single_cabin' }]
    };
    if (url.pathname === '/api/cabins') data = {
      cabins: [
        { _id: 'parent', name: 'A-Frame', inventoryType: 'multi', cabinTypeId: 'type', isActive: true },
        { _id: 'single', name: 'The Cabin', inventoryType: 'single', isActive: true }
      ]
    };
    if (url.pathname === '/api/units/by-type/type') data = { units: [
      { _id: 'available', cabinTypeId: 'type', isActive: true, displayName: 'A-Frame 1', unitNumber: 'AF-01' },
      { _id: 'occupied', cabinTypeId: 'type', isActive: true, displayName: 'A-Frame 2', unitNumber: 'AF-02' },
      { _id: 'blocked', cabinTypeId: 'type', isActive: true, displayName: 'A-Frame 3', unitNumber: 'AF-03' }
    ] };
    if (url.pathname === '/api/ops/calendar') data = { blocks: [
      { unitId: 'occupied', status: 'active', blockType: 'reservation', startDateOnly: '2027-04-01', endDateOnly: '2027-04-05' },
      { unitId: 'blocked', status: 'active', blockType: 'maintenance', startDateOnly: '2027-04-01', endDateOnly: '2027-04-05' }
    ] };
    if (request.method() !== 'GET') {
      assert.equal(url.pathname, '/api/ops/reservations/manual', 'Unexpected write');
      assert.equal(request.method(), 'POST');
      submitted = JSON.parse(request.postData());
      return request.respond({
        status: 409, contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Local test: no booking persisted' })
      });
    }
    return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });
  await page.goto(`${origin}/ops/reservations?create=1`, { waitUntil: 'networkidle0' });
  const selectId = await page.$eval('[role="dialog"] select', (element) => element.id);
  await page.select(`[id="${selectId}"]`, 'parent');
  await page.waitForFunction(() => document.querySelectorAll('[role="dialog"] select').length > 1);
  await page.evaluate(() => {
    const inputs = document.querySelectorAll('[role="dialog"] input[type="date"]');
    ['2027-04-01', '2027-04-03'].forEach((value, index) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inputs[index], value);
      inputs[index].dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  await page.waitForFunction(() => document.querySelector('[role="dialog"]').textContent.includes('A-Frame 1 — Available'));
  const unitSelectId = await page.$$eval('[role="dialog"] select', (elements) => elements[1].id);
  const options = await page.$$eval(`[id="${unitSelectId}"] option`, (elements) =>
    elements.map((element) => ({ label: element.textContent, disabled: element.disabled }))
  );
  assert.ok(options.some((option) => option.label === 'A-Frame 2 — Occupied' && option.disabled));
  assert.ok(options.some((option) => option.label === 'A-Frame 3 — Unavailable' && option.disabled));
  await page.select(`[id="${unitSelectId}"]`, 'available');
  const layout = await page.$eval('[role="dialog"]', (dialog) => {
    const selects = [...dialog.querySelectorAll('select')].map((element) => element.getBoundingClientRect());
    const rect = dialog.getBoundingClientRect();
    return {
      viewport: window.innerWidth, left: rect.left, right: rect.right,
      overflow: dialog.scrollWidth > dialog.clientWidth,
      selectsFit: selects.every((select) => select.left >= rect.left && select.right <= rect.right)
    };
  });
  assert.equal(layout.viewport, 432);
  assert.ok(layout.left >= 0 && layout.right <= 432 && !layout.overflow && layout.selectsFit, JSON.stringify(layout));
  await page.evaluate(() => document.getElementById('ops-reservations-create-form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent.includes('no booking persisted'));
  assert.deepEqual(
    { cabinId: submitted.cabinId, cabinTypeId: submitted.cabinTypeId, unitId: submitted.unitId },
    { cabinId: 'parent', cabinTypeId: 'type', unitId: 'available' }
  );
  console.log('PASS: 432px modal, explicit unit selection, occupied/unavailable options disabled, correct payload; no real API writes');
} finally {
  await browser.close();
}
