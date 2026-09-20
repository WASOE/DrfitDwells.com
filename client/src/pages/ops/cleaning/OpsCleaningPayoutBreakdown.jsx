import { Coins } from 'lucide-react';
import OpsBanner from '../../../ops/primitives/OpsBanner';
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
    return <p className="ops-cleaning-pay__muted">No line items.</p>;
  }

  return (
    <ul className="ops-cleaning-pay__zone-list">
      {items.map((item, idx) => (
        <li
          key={`${item.ruleKey || item.label}-${item.bookingId || idx}`}
          className="ops-cleaning-pay__zone-item"
        >
          <div className="min-w-0">
            <p className="ops-cleaning-pay__zone-title">{item.label}</p>
            {item.cabinName ? <span className="ops-cleaning-pay__cabin">{item.cabinName}</span> : null}
          </div>
          <p className="ops-cleaning-pay__zone-amount">{formatMoney(item.amountEUR, currency)}</p>
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
  testId = 'cleaner-payout-breakdown',
  headlineLabel = 'Daily Payout'
}) {
  const currency = payoutSummary?.currency || 'EUR';
  const totalAmount = payoutSummary?.totalAmount ?? 0;
  const checkoutCount = payoutSummary?.checkoutCount ?? 0;
  const noPolicyZones = payoutSummary?.noPolicyZones || [];
  const zones = payoutSummary?.zones || {};
  const grouped = groupLineItemsByZone(payoutSummary?.lineItems || []);

  return (
    <div className={`ops-cleaning-pay ${className}`.trim()} data-testid={testId}>
      <div className="ops-cleaning-pay__row">
        <div className="ops-cleaning-pay__icon" aria-hidden="true">
          <Coins className="h-4 w-4 md:h-5 md:w-5" />
        </div>
        <div className="ops-cleaning-pay__body">
          <div className="ops-cleaning-pay__head">
            <div>
              <p className="ops-cleaning-pay__eyebrow">{headlineLabel}</p>
              <p className="ops-cleaning-pay__sub">
                {formatLongDate(selectedDate)} · {checkoutCount}{' '}
                {checkoutCount === 1 ? 'checkout' : 'checkouts'}
              </p>
            </div>
            <p className="ops-cleaning-pay__amount">{formatMoney(totalAmount, currency)}</p>
          </div>
        </div>
      </div>

      {loading ? <p className="ops-cleaning-pay__muted">Loading payout…</p> : null}
      {error ? <OpsBanner tone="danger" body={error} /> : null}

      {!loading && !error ? (
        <div className="ops-cleaning-pay__lines">
          {ZONE_ORDER.map((zoneKey) => {
            const zoneMeta = zones[zoneKey] || {};
            const hasNoPolicy = noPolicyZones.includes(zoneKey) || zoneMeta.noPolicy;
            const items = grouped[zoneKey];
            const subtotal = hasNoPolicy ? 0 : zoneSubtotal(items);

            return (
              <section key={zoneKey} data-testid={`payout-zone-${zoneKey}`} className="ops-cleaning-pay__zone-block">
                <div className="ops-cleaning-pay__head">
                  <h3 className="ops-cleaning-pay__zone-heading">{ZONE_LABELS[zoneKey]}</h3>
                  {!hasNoPolicy ? (
                    <p className="ops-cleaning-pay__zone-amount">{formatMoney(subtotal, currency)}</p>
                  ) : null}
                </div>
                {hasNoPolicy ? (
                  <p className="ops-cleaning-pay__warn" data-testid={`payout-no-policy-${zoneKey}`}>
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
