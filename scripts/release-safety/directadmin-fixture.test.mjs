import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { renderAccountConfig, renderCustom } from './fixtures/directadmin/renderer.mjs';
import { apacheSharedAssetsDirectives } from './shared-assets.mjs';

const source = fs.readFileSync(new URL('./fixtures/directadmin/cust_httpd.conf', import.meta.url), 'utf8');
const ssl = fs.readFileSync(new URL('./fixtures/directadmin/cust_httpd_ssl.conf', import.meta.url), 'utf8');
const templates = fs.readFileSync(new URL('./fixtures/directadmin/template-excerpts.txt', import.meta.url), 'utf8');
const root = '/home/illoc/domains/driftdwells.com/public_html';
const testRoot = `${root}/test`;
const pointer = '/home/illoc/releases/frontend/current';
const unrelated = '<VirtualHost 127.0.0.1:80>\nServerName unrelated.example\nDocumentRoot "/fixture/other"\n</VirtualHost>';
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const blocks = text => [...text.matchAll(/<VirtualHost\b[^>]*>[\s\S]*?<\/VirtualHost>/g)].map(match => match[0]);

test('fixture records the inspected persistent sources without using HTTPS directives as effective configuration', () => {
  assert.equal(hash(source), '6b6a07976d55b029da9b44ea386a9db14e701fe0959ca1bd3653c81350005024');
  assert.equal(hash(ssl), '9967aa555ad2f23a2f180f8b006d6d5a685085141e3901146227731d40f04ab3');
  const generated = renderAccountConfig(source, { root, testRoot, unrelated });
  assert.equal(blocks(generated).length, 5);
  for (const block of blocks(generated).slice(0, 4)) {
    assert.match(block, /X-Forwarded-Proto "http"/);
    assert.match(block, /X-Forwarded-Port "80"/);
    assert.match(block, /ProxyPass \/api /);
    assert.match(block, /ProxyPass \/uploads /);
    assert.doesNotMatch(block, /SSLProxyEngine On/);
  }
});

test('fixture models main-domain token scoping, HTTPS CGI and unrelated host preservation', () => {
  const excerpts = templates.split(/^# virtual_host2/m).slice(1);
  assert.equal(excerpts.length, 4);
  for (const excerpt of excerpts) {
    assert.ok(excerpt.indexOf('|CUSTOM|') < excerpt.indexOf('DocumentRoot "|DOCROOT|"'));
    assert.ok(excerpt.includes('<Directory "|DOCROOT|">'));
  }
  const custom = `${source}\n|*if !SUB|\n|?DOCROOT=${pointer}|\n|*endif|\n`;
  const baseline = blocks(renderAccountConfig(source, { root, testRoot, unrelated }));
  const changed = blocks(renderAccountConfig(custom, { root, testRoot, unrelated }));
  assert.match(changed[0], new RegExp(`DocumentRoot "${pointer}"`));
  assert.match(changed[1], new RegExp(`DocumentRoot "${pointer}"`));
  assert.match(changed[0], new RegExp(`ScriptAlias /cgi-bin/ "${pointer}/cgi-bin/"`));
  assert.match(changed[1], new RegExp(`ScriptAlias /cgi-bin/ "${root}/cgi-bin/"`));
  assert.deepEqual(changed.slice(2), baseline.slice(2));
  assert.equal(renderAccountConfig(custom, { root, testRoot, unrelated }),
    renderAccountConfig(custom, { root, testRoot, unrelated }));
});

test('fixture rejects unsupported or unbalanced generator control tokens', () => {
  assert.throws(() => renderCustom('|*if !SUB|\n', false, root), /Unclosed/);
  assert.throws(() => renderCustom('|*endif|\n', false, root), /Unmatched/);
  assert.throws(() => renderCustom('|*else|\n', false, root), /Unmatched/);
  assert.throws(() => renderCustom('|*if FOO|\n', false, root), /Unsupported/);
});

test('fixture models mutually exclusive legal overrides without changing subdomains', () => {
  const legal = `Alias /legal/ ${root}/legal/`;
  const adjusted = source.replace(legal, [
    '|*if !SUB|',
    `Alias /legal/ ${pointer}/legal/`,
    '|*else|',
    legal,
    '|*endif|'
  ].join('\n'));
  const original = blocks(renderAccountConfig(source, { root, testRoot, unrelated }));
  const regenerated = blocks(renderAccountConfig(adjusted, { root, testRoot, unrelated }));
  assert.match(regenerated[0], new RegExp(`Alias /legal/ ${pointer}/legal/`));
  assert.match(regenerated[1], new RegExp(`Alias /legal/ ${pointer}/legal/`));
  assert.deepEqual(regenerated.slice(2), original.slice(2));
});

test('fixture keeps shared-assets mapping scoped to both main vhosts', () => {
  const mapping = apacheSharedAssetsDirectives('/home/illoc/releases/frontend/assets');
  const changed = blocks(renderAccountConfig(`${source}\n|*if !SUB|\n${mapping}\n|*endif|\n`, {
    root, testRoot, unrelated
  }));
  assert.ok(changed[0].includes(mapping));
  assert.ok(changed[1].includes(mapping));
  assert.ok(changed.slice(2).every(block => !block.includes(mapping)));
});
