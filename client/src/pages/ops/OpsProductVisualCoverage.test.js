import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OPS_NAV_ITEMS } from '../../layouts/ops/opsNavConfig';

const here = path.dirname(fileURLToPath(import.meta.url));

const PRODUCT_ROUTE_FILES = Object.freeze({
  '/ops': 'OpsDashboard.jsx',
  '/ops/calendar': 'calendar/OpsCalendarIndex.jsx',
  '/ops/calendar/work-windows': 'calendar/OpsWorkWindows.jsx',
  '/ops/cleaning': 'cleaning/OpsCleaningCalendar.jsx',
  '/ops/reservations': 'OpsReservations.jsx',
  '/ops/payments': 'OpsPayments.jsx',
  '/ops/promo-codes': 'OpsPromoCodes.jsx',
  '/ops/rate-plans': 'OpsRatePlans.jsx',
  '/ops/creator-partners': 'OpsCreatorPartners.jsx',
  '/ops/sync': 'OpsSyncCenter.jsx',
  '/ops/cabins': 'OpsCabinsList.jsx',
  '/ops/reviews': 'OpsReviews.jsx',
  '/ops/communications': 'OpsCommunicationOversight.jsx',
  '/ops/messaging': 'OpsMessaging.jsx',
  '/ops/gift-vouchers': 'OpsGiftVouchers.jsx',
  '/ops/insights': 'OpsInsights.jsx',
  '/ops/insights/performance': 'OpsInsightsPerformance.jsx',
  '/ops/conversion': 'OpsConversion.jsx',
  '/ops/conversion/recovery': 'OpsConversionRecovery.jsx',
  '/ops/manual-review': 'OpsManualReviewBacklog.jsx',
  '/ops/readiness': 'OpsReadiness.jsx',
  '/ops/settings/cleaning': 'cleaning/OpsCleaningSettings.jsx',
  '/ops/users': 'OpsUsers.jsx'
});

describe('Ops product visual coverage', () => {
  it('keeps every menu destination in the governed route ledger', () => {
    const navRoutes = OPS_NAV_ITEMS.map((item) => item.to).sort();
    const governedRoutes = Object.keys(PRODUCT_ROUTE_FILES).sort();
    expect(navRoutes).toHaveLength(23);
    expect(governedRoutes).toEqual(navRoutes);
  });

  it.each(Object.entries(PRODUCT_ROUTE_FILES))(
    '%s uses the shared page and hierarchy primitives',
    (_route, relativeFile) => {
      const source = fs.readFileSync(path.join(here, relativeFile), 'utf8');
      expect(source).toContain('<OpsPage');
      expect(source).toContain('<OpsPageHeader');
    }
  );
});
