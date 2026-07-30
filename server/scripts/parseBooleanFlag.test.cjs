'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseBooleanFlag,
  parseBooleanFlagWithDefault
} = require('../../shared/env/parseBooleanFlag.js');

test('parseBooleanFlag accepts documented truthy tokens only', () => {
  for (const v of ['1', 'true', 'TRUE', ' on ', 'Yes']) {
    assert.equal(parseBooleanFlag(v), true, v);
  }
  for (const v of ['0', 'false', 'off', 'no', '', 'maybe', null, undefined, 1, true]) {
    assert.equal(parseBooleanFlag(v), false, String(v));
  }
});

test('parseBooleanFlagWithDefault distinguishes missing vs explicit off', () => {
  assert.equal(parseBooleanFlagWithDefault(undefined, true), true);
  assert.equal(parseBooleanFlagWithDefault('', false), false);
  assert.equal(parseBooleanFlagWithDefault('0', true), false);
  assert.equal(parseBooleanFlagWithDefault('false', true), false);
  assert.equal(parseBooleanFlagWithDefault('1', false), true);
  assert.equal(parseBooleanFlagWithDefault('junk', true), true);
});
