'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const http = require('node:http');
const {
  isRebookEnabled,
  assertRebookEnabled
} = require('../services/stayChange/rebookWriteGate');
const {
  rebookReservation,
  reconcileRebookStayChange
} = require('../services/stayChange/rebookStayChangeService');

const ROUTE_PATH = path.join(__dirname, '../routes/ops/modules/reservationsRoutes.js');

test('REBOOK gate enables only for explicit valid true configuration', () => {
  for (const value of [undefined, '', 'false', 'TRUE', '1', 'yes', 'invalid']) {
    assert.equal(isRebookEnabled(value), false, `value ${String(value)} must fail closed`);
  }
  assert.equal(isRebookEnabled('true'), true);
});

test('disabled gate rejects REBOOK service entry points before database access', async () => {
  const original = process.env.REBOOK_ENABLED;
  delete process.env.REBOOK_ENABLED;
  try {
    assert.throws(assertRebookEnabled, error =>
      error.details?.code === 'REBOOK_DISABLED' && error.status === 503);
    await assert.rejects(
      rebookReservation({ bookingId: 'not-read', idempotencyKey: 'gate-test-key' }),
      error => error.details?.code === 'REBOOK_DISABLED' && error.status === 503
    );
    await assert.rejects(
      reconcileRebookStayChange('not-read'),
      error => error.details?.code === 'REBOOK_DISABLED' && error.status === 503
    );
  } finally {
    if (original === undefined) delete process.env.REBOOK_ENABLED;
    else process.env.REBOOK_ENABLED = original;
  }
});

test('HTTP REBOOK route enforces gate before validation and service invocation', () => {
  const source = fs.readFileSync(ROUTE_PATH, 'utf8');
  const routeStart = source.indexOf("router.post(\n  '/:id/actions/rebook'");
  assert.notEqual(routeStart, -1);
  const routeEnd = source.indexOf("router.post('/:id/actions/edit-dates'", routeStart);
  const handler = source.slice(routeStart, routeEnd);
  assert.ok(handler.indexOf('assertRebookEnabled();') >= 0);
  assert.ok(handler.indexOf('assertRebookEnabled();') < handler.indexOf('validationResult(req)'));
  assert.ok(handler.indexOf('validationResult(req)') < handler.indexOf('rebookReservation({'));
});

test('actual HTTP REBOOK endpoint returns 503 while disabled without invoking persistence', async () => {
  const original = process.env.REBOOK_ENABLED;
  delete process.env.REBOOK_ENABLED;
  const app = express();
  app.use(express.json());
  app.use(require('../routes/ops/modules/reservationsRoutes'));
  const server = http.createServer(app);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/aaaaaaaaaaaaaaaaaaaaaaaa/actions/rebook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: 'gate-http-test',
        targetCabinId: 'bbbbbbbbbbbbbbbbbbbbbbbb'
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.equal(payload.details?.code, 'REBOOK_DISABLED');
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (original === undefined) delete process.env.REBOOK_ENABLED;
    else process.env.REBOOK_ENABLED = original;
  }
});
