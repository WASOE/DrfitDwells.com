'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderGmaEmailHtml } = require('../services/messaging/gmaEmailHtmlRenderer');

test('guest GMA email uses branded lifecycle shell', () => {
  const html = renderGmaEmailHtml({
    audience: 'guest',
    subject: 'Your arrival to The Cabin',
    fragmentHtml: '<section lang="en"><p>Hi Alex,</p></section>',
    propertyName: 'The Cabin'
  });

  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('email-outer'));
  assert.ok(html.includes('email-card'));
  assert.ok(html.includes('Arrival information'));
  assert.ok(html.includes('Hi Alex,'));
  assert.ok(html.includes('driftdwells.com'));
});

test('ops GMA email uses internal notification shell', () => {
  const html = renderGmaEmailHtml({
    audience: 'ops',
    subject: '[OPS] Guest arrives tomorrow',
    fragmentHtml: '<p><strong>Guest arrives tomorrow.</strong></p>'
  });

  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('email-outer'));
  assert.ok(html.includes('Operations'));
  assert.ok(html.includes('Internal notification'));
});
