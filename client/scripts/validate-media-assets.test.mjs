import test from 'node:test';
import assert from 'node:assert/strict';
import { isProductionSourceFile } from './validate-media-assets.mjs';

test('isProductionSourceFile keeps production modules', () => {
  assert.equal(isProductionSourceFile('OpsCabinsList.jsx'), true);
  assert.equal(isProductionSourceFile('mediaConfig.js'), true);
  assert.equal(isProductionSourceFile('hero.ts'), true);
  assert.equal(isProductionSourceFile('Hero.tsx'), true);
});

test('isProductionSourceFile excludes test and spec fixtures', () => {
  assert.equal(isProductionSourceFile('OpsCabinsList.test.jsx'), false);
  assert.equal(isProductionSourceFile('OpsCabinsList.test.js'), false);
  assert.equal(isProductionSourceFile('media.spec.js'), false);
  assert.equal(isProductionSourceFile('media.spec.jsx'), false);
  assert.equal(isProductionSourceFile('helper.test.ts'), false);
  assert.equal(isProductionSourceFile('helper.spec.tsx'), false);
});

test('isProductionSourceFile rejects non-source extensions', () => {
  assert.equal(isProductionSourceFile('readme.md'), false);
  assert.equal(isProductionSourceFile('styles.css'), false);
});
