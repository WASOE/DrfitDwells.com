#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * /bg translation crawl — flags visible English text on Bulgarian pages.
 *
 * This is the only detection layer that sees the rendered result, so it
 * catches untranslated DB content (cabin names/descriptions), hardcoded JSX
 * strings, and missing i18n keys alike.
 *
 * Routes are derived from client/src/App.jsx (every <Route path="/bg...">):
 * static routes are crawled directly; cabin detail routes (/bg/cabin/:id)
 * are expanded with real ids fetched from /api/availability. Routes that
 * require booking/payment state are skipped (listed in SKIP_ROUTES).
 *
 * Detection: visible text nodes are flagged when their Latin-script content
 * looks like an English sentence — at least MIN_WORDS Latin words including
 * at least MIN_STOPWORD_HITS English function words. Single proper nouns and
 * brand names do not trip it. Genuinely non-translatable tokens (brands,
 * emails, phone numbers, URLs, currency codes) are stripped before analysis.
 *
 * Usage:
 *   node scripts/crawlBgPages.cjs                                # http://localhost:5000
 *   node scripts/crawlBgPages.cjs --url https://driftdwells.com  # production
 *   node scripts/crawlBgPages.cjs --url ... --verbose            # also list clean routes
 *
 * Exit codes: 0 = clean, 1 = English found on /bg pages, 2 = crawl error.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const APP_JSX = path.join(__dirname, '..', 'client', 'src', 'App.jsx');

// Routes that need booking/payment/session state and render placeholders or
// error states without it. Crawling them would only flag legitimate fallbacks.
const SKIP_ROUTES = new Set([
  '/bg/stays/a-frame/confirm',
  '/bg/booking-refund',
  '/bg/gift-vouchers/success'
]);

// Elements inside these selectors are not checked. Components can opt out of
// the crawl (e.g. user-generated guest reviews) by adding data-i18n-exempt.
const EXEMPT_SELECTORS = ['[data-i18n-exempt]'];

// Genuinely non-translatable tokens, removed before analysis.
const TOKEN_WHITELIST = [
  'Drift & Dwells',
  'Drift&Dwells',
  'Airbnb',
  'Booking.com',
  'TripAdvisor',
  'Instagram',
  'Facebook',
  'WhatsApp',
  'YouTube',
  'Google Maps',
  'Google',
  'Starlink',
  'what3words',
  'A-Frame',
  'A-frame',
  'ATV',
  'GMT',
  'Wi-Fi',
  'WiFi'
];

const STRIP_PATTERNS = [
  /[\w.+-]+@[\w-]+\.[\w.]+/g, // emails
  /\+?\d[\d\s().-]{6,}\d/g, // phone numbers
  /https?:\/\/\S+|www\.\S+/gi, // URLs
  /\b(EUR|BGN|USD|GBP)\b/g, // currency codes
  /[€$£лвBGN]+\s?\d[\d.,]*/g // prices
];

// English function words — strong signal that Latin text is an English sentence.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
  'from', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its',
  'this', 'that', 'these', 'those', 'you', 'your', 'yours', 'we', 'our', 'ours',
  'they', 'their', 'them', 'he', 'she', 'his', 'her', 'as', 'not', 'no', 'but',
  'if', 'so', 'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should',
  'has', 'have', 'had', 'all', 'any', 'more', 'most', 'some', 'such', 'than',
  'then', 'there', 'here', 'when', 'where', 'how', 'what', 'who', 'which',
  'why', 'about', 'into', 'over', 'after', 'before', 'between', 'through',
  'during', 'out', 'up', 'down', 'off', 'own', 'each', 'per', 'via', 'please',
  'while', 'because', 'until', 'against', 'without', 'within'
]);

const MIN_WORDS = 4;
const MIN_STOPWORD_HITS = 2;

const parseArg = (flag, fallback) => {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
};

const futureDateOnly = (daysFromToday) => {
  const d = new Date(Date.now() + daysFromToday * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
};

const SEARCH_QS = () =>
  `checkIn=${futureDateOnly(30)}&checkOut=${futureDateOnly(33)}&adults=2&children=0`;

/** Derive /bg routes from the client router so new pages are crawled automatically. */
const deriveRoutesFromRouter = () => {
  const source = fs.readFileSync(APP_JSX, 'utf8');
  const matches = [...source.matchAll(/path="(\/bg[^"]*)"/g)].map((m) => m[1]);
  const staticRoutes = [];
  const paramRoutes = [];
  for (const route of new Set(matches)) {
    if (route.includes('*')) continue;
    if (SKIP_ROUTES.has(route)) continue;
    if (route.includes(':')) paramRoutes.push(route);
    else staticRoutes.push(route);
  }
  return { staticRoutes, paramRoutes };
};

/** Expand /bg/cabin/:id with real listing ids from the live API. */
const expandParamRoutes = async (baseUrl, paramRoutes) => {
  const expanded = [];
  const needsCabinIds = paramRoutes.some((r) => r.startsWith('/bg/cabin/:id'));
  if (!needsCabinIds) return expanded;

  const url = `${baseUrl}/api/availability?${SEARCH_QS()}&locale=bg`;
  try {
    const res = await fetch(url);
    const body = await res.json();
    const cabins = body?.data?.cabins || [];
    for (const cabin of cabins) {
      const isMulti = cabin.inventoryMode === 'multi' || cabin.inventoryType === 'multi';
      if (isMulti) continue; // /bg/stays/a-frame is already a static route
      expanded.push(`/bg/cabin/${cabin._id}?${SEARCH_QS()}`);
    }
  } catch (error) {
    console.warn(`[bg-crawl] WARN could not expand cabin routes (${error.message}); detail pages not crawled.`);
  }
  return expanded;
};

const stripNonTranslatable = (text) => {
  let result = text;
  for (const token of TOKEN_WHITELIST) {
    result = result.split(token).join(' ');
  }
  for (const pattern of STRIP_PATTERNS) {
    result = result.replace(pattern, ' ');
  }
  return result;
};

/** True when the (already stripped) text reads like an English sentence. */
const looksLikeEnglish = (text) => {
  const words = (text.match(/[A-Za-z][A-Za-z']*/g) || []).map((w) => w.toLowerCase());
  if (words.length < MIN_WORDS) return false;
  const stopwordHits = words.filter((w) => STOPWORDS.has(w)).length;
  return stopwordHits >= MIN_STOPWORD_HITS;
};

/** Runs inside the page: collect visible text nodes with a short DOM path. */
const collectVisibleText = (exemptSelectors) => {
  const cssPath = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`${part}#${node.id}`);
        break;
      }
      const cls = (node.className && typeof node.className === 'string')
        ? node.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
      if (cls) part += `.${cls}`;
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  const isVisible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const results = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const tag = node.parentElement?.tagName;
      if (!tag || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(tag)) return NodeFilter.FILTER_REJECT;
      if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
      if (exemptSelectors.some((sel) => node.parentElement.closest(sel))) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const el = node.parentElement;
    if (!isVisible(el)) continue;
    results.push({ text: node.textContent.trim().replace(/\s+/g, ' '), selector: cssPath(el) });
  }
  return results;
};

const main = async () => {
  const baseUrl = parseArg('--url', process.env.CRAWL_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
  const verbose = process.argv.includes('--verbose');

  const { staticRoutes, paramRoutes } = deriveRoutesFromRouter();
  const dynamicRoutes = await expandParamRoutes(baseUrl, paramRoutes);

  const routes = [
    ...staticRoutes.map((r) => (r === '/bg/search' ? `${r}?${SEARCH_QS()}` : r)),
    ...dynamicRoutes
  ].sort();

  console.log(`[bg-crawl] Base URL: ${baseUrl}`);
  console.log(`[bg-crawl] Routes derived from App.jsx: ${staticRoutes.length} static, ${dynamicRoutes.length} expanded from :params, ${SKIP_ROUTES.size} skipped (booking-state pages).`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    locale: 'bg-BG',
    viewport: { width: 1280, height: 900 }
  });
  const page = await context.newPage();

  const findings = new Map();
  let crawlError = false;

  for (const route of routes) {
    const target = `${baseUrl}${route}`;
    try {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
      // Try to reach network idle, but pages with video/analytics streams never
      // do — proceed after a grace period either way.
      await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(1500); // let lazy chunks and i18n bundles settle
      const nodes = await page.evaluate(collectVisibleText, EXEMPT_SELECTORS);

      const flagged = [];
      const seen = new Set();
      for (const { text, selector } of nodes) {
        if (seen.has(text)) continue;
        const stripped = stripNonTranslatable(text);
        if (looksLikeEnglish(stripped)) {
          seen.add(text);
          flagged.push({ text, selector });
        }
      }
      if (flagged.length > 0) {
        findings.set(route, flagged);
        console.log(`\n[bg-crawl] ${route} — ${flagged.length} English string(s):`);
        for (const f of flagged) {
          console.log(`  ✗ "${f.text.slice(0, 140)}${f.text.length > 140 ? '…' : ''}"`);
          console.log(`    at ${f.selector}`);
        }
      } else if (verbose) {
        console.log(`[bg-crawl] ${route} — clean`);
      }
    } catch (error) {
      crawlError = true;
      console.error(`[bg-crawl] ERROR loading ${target}: ${error.message}`);
    }
  }

  await browser.close();

  const total = [...findings.values()].reduce((n, list) => n + list.length, 0);
  console.log(`\n[bg-crawl] Crawled ${routes.length} routes. Flagged strings: ${total} across ${findings.size} route(s).`);
  if (crawlError) {
    console.error('[bg-crawl] Crawl errors occurred — result incomplete.');
    process.exit(2);
  }
  if (total > 0) {
    console.error('[bg-crawl] FAIL — English content visible on /bg pages (see above).');
    process.exit(1);
  }
  console.log('[bg-crawl] OK — no English sentences detected on /bg pages.');
  process.exit(0);
};

main().catch((error) => {
  console.error('[bg-crawl] Fatal:', error);
  process.exit(2);
});
