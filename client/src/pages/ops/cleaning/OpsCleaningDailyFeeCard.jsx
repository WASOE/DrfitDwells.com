import { Coins } from 'lucide-react';
import OpsBanner from '../../../ops/primitives/OpsBanner';
import { formatMoney } from './OpsCleaningLineItemsTable';

/**
 * Compact day-total card — matches the original cleaning calendar payment card
 * (below calendar on mobile): big € total on day select.
 */
export default function OpsCleaningDailyFeeCard({
  selectedDate,
  totalAmount = 0,
  checkoutCount = 0,
  paidAmount = 0,
  loading = false,
  error = '',
  noPolicyZones = [],
  hasCheckouts = false,
  formatLongDate,
  showPaidPending = false,
  statusMessage = null,
  children = null,
  testId = 'daily-fee-card'
}) {
  const pendingAmount = Math.max(0, totalAmount - paidAmount);
  const isEmptyDay = !hasCheckouts && !loading && !error;

  return (
    <div className="ops-cleaning-pay" data-testid={testId}>
      {loading ? (
        <p className="ops-cleaning-pay__muted">Loading payment summary…</p>
      ) : error ? (
        <OpsBanner tone="danger" body={error} />
      ) : (
        <div className="ops-cleaning-pay__row">
          <div className="ops-cleaning-pay__icon" aria-hidden="true">
            <Coins className="h-4 w-4" />
          </div>
          <div className="ops-cleaning-pay__body">
            <div className="ops-cleaning-pay__head">
              <div>
                <p className="ops-cleaning-pay__eyebrow">Total Daily Cleaning Fee</p>
                <p className="ops-cleaning-pay__sub">
                  {formatLongDate(selectedDate)} · {checkoutCount}{' '}
                  {checkoutCount === 1 ? 'checkout' : 'checkouts'}
                </p>
              </div>
              <p className="ops-cleaning-pay__amount">{formatMoney(totalAmount)}</p>
            </div>

            {isEmptyDay ? <p className="ops-cleaning-pay__muted">No checkouts on this day.</p> : null}

            {noPolicyZones.length > 0 ? (
              <p className="ops-cleaning-pay__warn" data-testid="daily-fee-no-policy">
                {noPolicyZones.map((zone) => `${zone}: no active pricing`).join(' · ')}
              </p>
            ) : null}

            {statusMessage ? <p className="ops-cleaning-pay__warn">{statusMessage}</p> : null}

            {showPaidPending && totalAmount > 0 ? (
              <div className="ops-cleaning-pay__chips">
                <span className="ops-cleaning-pay__chip ops-cleaning-pay__chip--paid">
                  PAID {formatMoney(paidAmount)}
                </span>
                <span className="ops-cleaning-pay__chip ops-cleaning-pay__chip--pending">
                  PENDING {formatMoney(pendingAmount)}
                </span>
              </div>
            ) : null}

            {children}
          </div>
        </div>
      )}
    </div>
  );
}
