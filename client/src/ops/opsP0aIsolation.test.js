import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPS_NAV_ITEMS } from '../layouts/ops/opsNavConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, '../..');

function readClient(rel) {
  return fs.readFileSync(path.join(CLIENT_ROOT, rel), 'utf8');
}

const EXPECTED_OPS_ROUTE_STRINGS = [
  'path="/ops"',
  'path="/ops/reservations"',
  'path="/ops/reservations/:id"',
  'path="/ops/payments"',
  'path="/ops/promo-codes"',
  'path="/ops/creator-partners"',
  'path="/ops/sync"',
  'path="/ops/cabins"',
  'path="/ops/cabins/:id"',
  'path="/ops/reviews"',
  'path="/ops/communications"',
  'path="/ops/messaging"',
  'path="/ops/manual-review"',
  'path="/ops/gift-vouchers"',
  'path="/ops/gift-vouchers/:id"',
  'path="/ops/insights"',
  'path="/ops/insights/performance"',
  'path="/ops/conversion"',
  'path="/ops/conversion/recovery"',
  'path="/ops/readiness"',
  'path="/ops/cleaning"',
  'path="/ops/settings/cleaning"',
  'path="/ops/users"',
  'path="/ops/design-system"',
  'OPS_CALENDAR_BASE_PATH',
  'OPS_WORK_WINDOWS_SEGMENT',
  'OPS_CALENDAR_CABIN_PARAM_PATH'
];

describe('P0A isolation guards', () => {
  it('keeps public-site heading CSS on Playfair (font-serif)', () => {
    const css = readClient('src/index.css');
    expect(css).toMatch(/h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{[^}]*font-serif/s);
  });

  it('scopes Ops heading isolation to Inter inside .ops-root', () => {
    const css = readClient('src/ops/ops.css');
    expect(css).toMatch(/\.ops-root\s+h1[\s\S]*font-family:\s*Inter/);
    expect(css).not.toMatch(/Playfair/);
  });

  it('path-gates appearance initialization in index.html and does not set html.dark', () => {
    const html = readClient('index.html');
    expect(html).toContain("path !== '/ops' && path.indexOf('/ops/') !== 0");
    expect(html).toContain('dd_ops_appearance');
    expect(html).toContain("setAttribute('data-ops-appearance'");
    expect(html).not.toMatch(/classList\.add\(\s*['"]dark['"]\s*\)/);
    expect(html).not.toMatch(/html\.dark/);
    expect(html).toContain('fonts.googleapis.com');
    expect(html).toContain('The-cabin-header.summer-poster.jpg');
  });

  it('does not remove existing Ops routes from App.jsx', () => {
    const app = readClient('src/App.jsx');
    for (const fragment of EXPECTED_OPS_ROUTE_STRINGS) {
      expect(app, fragment).toContain(fragment);
    }
    expect(app).toContain('path="/ops/design-system"');
  });

  it('does not change navigation configuration', () => {
    expect(OPS_NAV_ITEMS).toHaveLength(22);
    expect(OPS_NAV_ITEMS.map((item) => item.to)).toEqual([
      '/ops',
      '/ops/calendar',
      '/ops/calendar/work-windows',
      '/ops/cleaning',
      '/ops/reservations',
      '/ops/payments',
      '/ops/promo-codes',
      '/ops/creator-partners',
      '/ops/sync',
      '/ops/cabins',
      '/ops/reviews',
      '/ops/communications',
      '/ops/messaging',
      '/ops/gift-vouchers',
      '/ops/insights',
      '/ops/insights/performance',
      '/ops/conversion',
      '/ops/conversion/recovery',
      '/ops/manual-review',
      '/ops/readiness',
      '/ops/settings/cleaning',
      '/ops/users'
    ]);
  });

  it('attaches ops-root on loading, authenticated, and cleaner shells in OpsLayout source', () => {
    const layout = readClient('src/layouts/OpsLayout.jsx');
    expect(layout.match(/<OpsRoot /g)?.length).toBe(2);
    expect(layout).toContain('OpsAppearanceProvider');
    expect(layout).toContain('isCleanerOnlySession');
    expect(layout).toContain('Loading ops console');
    expect(layout).toMatch(/<OpsRoot themed className="min-h-screen"/);
    expect(layout).not.toMatch(/<OpsRoot[^>]*bg-gray-50/);
  });

  it('does not change public sage theme values', () => {
    const tw = readClient('tailwind.config.js');
    expect(tw).toContain("'sage': '#81887A'");
    expect(tw).toContain("'serif': ['Playfair Display', 'Georgia', 'serif']");
    expect(tw).toContain("canvas: 'var(--ops-canvas)'");
    expect(tw).not.toMatch(/ops:\s*\{[^}]*#[0-9A-Fa-f]{3,8}/);
  });
});
