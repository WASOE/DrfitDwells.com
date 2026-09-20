import { Coins } from 'lucide-react';
import OpsButton from '../../../ops/primitives/OpsButton';
import OpsBanner from '../../../ops/primitives/OpsBanner';
import OpsStatus from '../../../ops/primitives/OpsStatus';
import OpsCleaningLineItemsTable, { formatMoney } from './OpsCleaningLineItemsTable';

export default function OpsCleaningPaymentPanel({
  selectedDate,
  paymentSummary,
  paymentLoading,
  paymentError,
  paymentBusy,
  togglePaidError,
  canWritePayment,
  formatLongDate,
  onTogglePaid
}) {
  const currency = paymentSummary?.currency || 'EUR';
  const totalAmount = paymentSummary?.totalAmount ?? 0;
  const paidAmount = paymentSummary?.paidAmount ?? 0;
  const pendingAmount = Math.max(0, totalAmount - paidAmount);
  const isPaid = paymentSummary?.status === 'paid';
  const isSnapshot = paymentSummary?.isSnapshot === true;
  const cabinCount = paymentSummary?.cabinCount ?? 0;
  const lineItems = paymentSummary?.lineItems || [];

  return (
    <div className="ops-cleaning-pay" data-testid="cleaning-payment-panel-desktop">
      <div className="ops-cleaning-pay__row">
        <div className="ops-cleaning-pay__icon" aria-hidden="true">
          <Coins className="h-5 w-5" />
        </div>
        <div className="ops-cleaning-pay__body">
          <div className="ops-cleaning-pay__head">
            <div>
              <p className="ops-cleaning-pay__eyebrow">Daily cleaning payment</p>
              <p className="ops-cleaning-pay__sub">
                {formatLongDate(selectedDate)} · {cabinCount}{' '}
                {cabinCount === 1 ? 'checkout' : 'checkouts'}
              </p>
            </div>
            <p className="ops-cleaning-pay__amount">{formatMoney(totalAmount, currency)}</p>
          </div>

          <div className="ops-cleaning-pay__chips">
            <span className="ops-cleaning-pay__chip ops-cleaning-pay__chip--paid">
              PAID {formatMoney(paidAmount, currency)}
            </span>
            <span className="ops-cleaning-pay__chip ops-cleaning-pay__chip--pending">
              PENDING {formatMoney(pendingAmount, currency)}
            </span>
            {isSnapshot ? (
              <span className="ops-cleaning-pay__chip ops-cleaning-pay__chip--info">
                Frozen snapshot
                {paymentSummary?.pricingVersion ? ` · ${paymentSummary.pricingVersion}` : ''}
              </span>
            ) : null}
            {isPaid ? <OpsStatus name="cleaning_payment.paid" /> : null}
          </div>

          {canWritePayment ? (
            <div className="ops-cleaning-pay__action">
              <OpsButton
                variant={isPaid ? 'secondary' : 'primary'}
                size="compact"
                onClick={onTogglePaid}
                disabled={paymentBusy || paymentLoading}
                loading={paymentBusy}
                loadingLabel="…"
                data-testid="toggle-paid-desktop"
              >
                {isPaid ? 'Unmark Paid' : 'Mark Paid'}
              </OpsButton>
              {togglePaidError ? <OpsBanner tone="danger" body={togglePaidError} /> : null}
            </div>
          ) : null}
        </div>
      </div>

      {paymentLoading ? <p className="ops-cleaning-pay__muted">Loading payment summary…</p> : null}
      {paymentError ? <OpsBanner tone="danger" body={paymentError} /> : null}

      {!paymentLoading && !paymentError ? (
        <OpsCleaningLineItemsTable
          lineItems={lineItems}
          currency={currency}
          totalAmount={totalAmount}
        />
      ) : null}
    </div>
  );
}
