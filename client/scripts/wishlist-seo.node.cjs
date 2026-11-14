'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const sharp = require('sharp');

const dist = path.resolve(__dirname, '../dist');
const origin = 'https://driftdwells.com';

for (const [route, locale] of [['wishlist', 'en'], ['bg/wishlist', 'bg']]) {
  test(`built ${route} has localized, indexable SEO metadata`, async () => {
    const document = new JSDOM(fs.readFileSync(path.join(dist, route, 'index.html'), 'utf8')).window.document;
    const canonical = `${origin}/${route}/`;
    assert.equal(document.documentElement.lang, locale);
    assert.equal(document.querySelector('#root')?.dataset.prerenderRoute, `/${route}`);
    assert.equal(document.querySelector('link[rel="canonical"]')?.href, canonical);
    assert.equal(document.querySelector('meta[property="og:url"]')?.content, canonical);
    assert.ok(document.title.includes('Drift & Dwells'));
    assert.ok(document.querySelector('meta[name="description"]')?.content.length >= 40);
    assert.doesNotMatch(document.querySelector('meta[name="robots"]')?.content || '', /noindex/i);
    for (const [language, href] of [
      ['en', `${origin}/wishlist/`], ['bg', `${origin}/bg/wishlist/`], ['x-default', `${origin}/wishlist/`]
    ]) {
      assert.equal(document.querySelector(`link[rel="alternate"][hreflang="${language}"]`)?.href, href);
    }
    const image = new URL(document.querySelector('meta[property="og:image"]').content);
    assert.equal(image.origin, origin);
    const imageFile = path.resolve(dist, `.${image.pathname}`);
    assert.ok(imageFile.startsWith(`${dist}${path.sep}`));
    const metadata = await sharp(imageFile).metadata();
    assert.ok(metadata.width > 0 && metadata.height > 0);
    assert.ok(fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8').includes(`<loc>${canonical}</loc>`));
  });
}
