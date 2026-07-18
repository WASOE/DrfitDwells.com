import { useTranslation } from 'react-i18next';
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import '../../../i18n/ns/booking';

function LocationPaymentForm({
  onSubmit,
  loading,
  disabled = false,
  isSheet = false,
  onPaymentElementReady,
  onPaymentElementLoadError,
  suppressStripeLoadingHint = false
}) {
  const { t } = useTranslation('booking');
  const stripe = useStripe();
  const elements = useElements();

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!stripe || !elements) return;
    await onSubmit(stripe, elements);
  };

  const buttonClass = isSheet
    ? 'w-full py-4 rounded-xl bg-[#81887A] text-white font-semibold text-base hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation'
    : 'w-full py-3.5 rounded-xl bg-[#81887A] text-white font-semibold text-sm hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed';

  const submitDisabled = !stripe || loading || disabled;
  const showStripeHint = submitDisabled && !loading && !stripe && !suppressStripeLoadingHint;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        onReady={() => onPaymentElementReady?.()}
        onLoadError={(event) => onPaymentElementLoadError?.(event)}
      />
      <button type="submit" disabled={submitDisabled} className={buttonClass}>
        {loading ? t('confirm.processingPayment') : t('cta.confirmAndPay')}
      </button>
      {showStripeHint ? (
        <p className="text-sm text-gray-700" role="status">
          {t('confirm.payment.formNotReady')}
        </p>
      ) : null}
    </form>
  );
}

export default LocationPaymentForm;
