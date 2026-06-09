import { Coins } from 'lucide-react';
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
    <div
      className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
      data-testid={testId}
    >
      {loading ? (
        <p className="text-sm text-gray-400">Loading payment summary…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600">
            <Coins className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Total Daily Cleaning Fee
                </p>
                <p className="mt-0.5 text-sm text-gray-600">
                  {formatLongDate(selectedDate)} · {checkoutCount}{' '}
                  {checkoutCount === 1 ? 'checkout' : 'checkouts'}
                </p>
              </div>
              <p className="shrink-0 text-xl font-bold tabular-nums text-gray-900">
                {formatMoney(totalAmount)}
              </p>
            </div>

            {isEmptyDay ? (
              <p className="mt-2 text-sm text-gray-500">No checkouts on this day.</p>
            ) : null}

            {noPolicyZones.length > 0 ? (
              <p className="mt-2 text-sm text-amber-800" data-testid="daily-fee-no-policy">
                {noPolicyZones.map((zone) => `${zone}: no active pricing`).join(' · ')}
              </p>
            ) : null}

            {statusMessage ? (
              <p className="mt-2 text-sm text-amber-800">{statusMessage}</p>
            ) : null}

            {showPaidPending && totalAmount > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                  PAID {formatMoney(paidAmount)}
                </span>
                <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
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
