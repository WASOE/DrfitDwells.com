import { Coins } from 'lucide-react';
import OpsCleaningLineItemsTable, { formatMoney } from './OpsCleaningLineItemsTable';
import OpsCleaningDayInputsForm from './OpsCleaningDayInputsForm';

export default function OpsCleaningPaymentPanel({
  selectedDate,
  paymentSummary,
  paymentLoading,
  paymentError,
  paymentBusy,
  inputsSaving,
  inputsError,
  togglePaidError,
  canWritePayment,
  canEditDayInputs,
  formatLongDate,
  onTogglePaid,
  onSaveDayInputs
}) {
  const currency = paymentSummary?.currency || 'EUR';
  const totalAmount = paymentSummary?.totalAmount ?? 0;
  const paidAmount = paymentSummary?.paidAmount ?? 0;
  const pendingAmount = Math.max(0, totalAmount - paidAmount);
  const isPaid = paymentSummary?.status === 'paid';
  const isSnapshot = paymentSummary?.isSnapshot === true;
  const cabinCount = paymentSummary?.cabinCount ?? 0;
  const lineItems = paymentSummary?.lineItems || [];
  const editableInputFields = paymentSummary?.editableInputFields || [];
  const dayInputs = paymentSummary?.inputs?.inputs || {};
  const canEditInputs = Boolean(paymentSummary?.canEditInputs && canEditDayInputs);

  return (
    <div
      className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:sticky lg:top-6"
      data-testid="cleaning-payment-panel-desktop"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600">
          <Coins className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Daily cleaning payment
              </p>
              <p className="mt-0.5 text-sm text-gray-600">
                {formatLongDate(selectedDate)} · {cabinCount}{' '}
                {cabinCount === 1 ? 'checkout' : 'checkouts'}
              </p>
            </div>
            <p className="shrink-0 text-2xl font-bold tabular-nums text-gray-900">
              {formatMoney(totalAmount, currency)}
            </p>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
              PAID {formatMoney(paidAmount, currency)}
            </span>
            <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
              PENDING {formatMoney(pendingAmount, currency)}
            </span>
            {isSnapshot ? (
              <span className="rounded-md bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800">
                Frozen snapshot
                {paymentSummary?.pricingVersion ? ` · ${paymentSummary.pricingVersion}` : ''}
              </span>
            ) : null}
            {isPaid ? (
              <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-semibold uppercase text-gray-700">
                {paymentSummary?.status}
              </span>
            ) : null}
          </div>

          {canWritePayment ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={onTogglePaid}
                disabled={paymentBusy || paymentLoading}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                  isPaid
                    ? 'border border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                    : 'bg-gray-900 text-white hover:bg-gray-800'
                }`}
                data-testid="toggle-paid-desktop"
              >
                {paymentBusy ? '…' : isPaid ? 'Unmark Paid' : 'Mark Paid'}
              </button>
              {togglePaidError ? (
                <p className="mt-2 text-sm text-red-600">{togglePaidError}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {paymentLoading ? (
        <p className="mt-4 text-sm text-gray-400">Loading payment summary…</p>
      ) : null}
      {paymentError ? <p className="mt-4 text-sm text-red-600">{paymentError}</p> : null}

      {!paymentLoading && !paymentError ? (
        <>
          <OpsCleaningLineItemsTable
            lineItems={lineItems}
            currency={currency}
            totalAmount={totalAmount}
          />
          <OpsCleaningDayInputsForm
            editableInputFields={editableInputFields}
            inputs={dayInputs}
            canEditInputs={canEditInputs}
            currency={currency}
            saving={inputsSaving}
            error={inputsError}
            onSave={onSaveDayInputs}
          />
        </>
      ) : null}
    </div>
  );
}
