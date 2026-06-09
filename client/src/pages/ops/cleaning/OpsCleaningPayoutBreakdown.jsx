import { Coins } from 'lucide-react';
import { formatMoney } from './OpsCleaningLineItemsTable';

const ZONE_ORDER = ['cabin', 'valley'];

const ZONE_LABELS = {
  cabin: 'The Cabin',
  valley: 'The Valley'
};

function groupLineItemsByZone(lineItems = []) {
  const groups = { cabin: [], valley: [] };
  for (const item of lineItems) {
    const key = item?.propertyKind === 'valley' ? 'valley' : 'cabin';
    groups[key].push(item);
  }
  return groups;
}

function zoneSubtotal(items = []) {
  return items.reduce((sum, item) => sum + (Number(item?.amountEUR) || 0), 0);
}

function ZoneLineItems({ items, currency }) {
  if (!items.length) {
    return <p className="mt-2 text-sm text-gray-500">No line items.</p>;
  }

  return (
    <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
      {items.map((item, idx) => (
        <li
          key={`${item.ruleKey || item.label}-${item.bookingId || idx}`}
          className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm"
        >
          <div className="min-w-0">
            <p className="font-medium text-gray-900">{item.label}</p>
            {item.cabinName ? (
              <p className="mt-0.5 text-xs text-gray-500">{item.cabinName}</p>
            ) : null}
          </div>
          <p className="shrink-0 tabular-nums font-medium text-gray-900">
            {formatMoney(item.amountEUR, currency)}
          </p>
        </li>
      ))}
    </ul>
  );
}

export default function OpsCleaningPayoutBreakdown({
  selectedDate,
  payoutSummary,
  loading,
  error,
  formatLongDate,
  className = '',
  testId = 'cleaner-payout-breakdown'
}) {
  const currency = payoutSummary?.currency || 'EUR';
  const totalAmount = payoutSummary?.totalAmount ?? 0;
  const checkoutCount = payoutSummary?.checkoutCount ?? 0;
  const noPolicyZones = payoutSummary?.noPolicyZones || [];
  const zones = payoutSummary?.zones || {};
  const grouped = groupLineItemsByZone(payoutSummary?.lineItems || []);

  return (
    <div
      className={`rounded-2xl border border-gray-200 bg-white p-4 shadow-sm md:p-5 ${className}`}
      data-testid={testId}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600 md:h-10 md:w-10">
          <Coins className="h-4 w-4 md:h-5 md:w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Daily Payout
              </p>
              <p className="mt-0.5 text-sm text-gray-600">
                {formatLongDate(selectedDate)} · {checkoutCount}{' '}
                {checkoutCount === 1 ? 'checkout' : 'checkouts'}
              </p>
            </div>
            <p className="shrink-0 text-xl font-bold tabular-nums text-gray-900 md:text-2xl">
              {formatMoney(totalAmount, currency)}
            </p>
          </div>
        </div>
      </div>

      {loading ? <p className="mt-4 text-sm text-gray-400">Loading payout…</p> : null}
      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      {!loading && !error ? (
        <div className="mt-4 space-y-4">
          {ZONE_ORDER.map((zoneKey) => {
            const zoneMeta = zones[zoneKey] || {};
            const hasNoPolicy = noPolicyZones.includes(zoneKey) || zoneMeta.noPolicy;
            const items = grouped[zoneKey];
            const subtotal = hasNoPolicy ? 0 : zoneSubtotal(items);

            return (
              <section key={zoneKey} data-testid={`payout-zone-${zoneKey}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">{ZONE_LABELS[zoneKey]}</h3>
                  {!hasNoPolicy ? (
                    <p className="text-sm font-semibold tabular-nums text-gray-700">
                      {formatMoney(subtotal, currency)}
                    </p>
                  ) : null}
                </div>
                {hasNoPolicy ? (
                  <p
                    className="mt-1 text-sm text-amber-800"
                    data-testid={`payout-no-policy-${zoneKey}`}
                  >
                    {ZONE_LABELS[zoneKey]}: no active pricing
                  </p>
                ) : (
                  <ZoneLineItems items={items} currency={currency} />
                )}
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export { ZONE_LABELS, groupLineItemsByZone };
