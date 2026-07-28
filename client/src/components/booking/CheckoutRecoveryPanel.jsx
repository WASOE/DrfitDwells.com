import { CONTACT_EMAIL } from '../../data/gmbLocations';

/**
 * Guest-facing post-payment recovery panel (Batch 9).
 * Copy is fixed English for familiarity; keep hierarchy calm and non-technical.
 */
export default function CheckoutRecoveryPanel({
  phase = 'finalizing',
  checkoutId = '',
  bookingReference = null,
  onCheckStatus = null,
  canRetryPayment = false,
  onRetryPayment = null
}) {
  const isDelayed = phase === 'delayed';
  const isNeedsReview = phase === 'needs_review';
  const isFailed = phase === 'payment_failed';

  let title = 'Confirming your reservation';
  let body = 'Your payment has been received. We are now confirming your stay.';
  let important = 'Please keep this page open and do not make another payment.';
  let secondary = null;

  if (isDelayed) {
    title = 'Your payment was received';
    body =
      'Your reservation is taking a little longer than usual to confirm. You do not need to make another payment.';
    important = null;
    secondary = 'We will send your booking confirmation by email as soon as it is ready.';
  } else if (isNeedsReview) {
    title = 'Your payment was received';
    body = 'Your reservation needs a quick review before it can be confirmed.';
    important = 'Please do not make another payment.';
    secondary =
      'Our team has been notified and will contact you using the details provided with your reservation.';
  } else if (isFailed) {
    title = 'Payment was not completed';
    body = 'We could not confirm a successful payment for this reservation.';
    important = null;
    secondary = 'You can safely try again when you are ready.';
  }

  const reference = bookingReference || checkoutId;
  const showSpinner = phase === 'finalizing' || phase === 'checking_payment';

  return (
    <div
      className="w-full max-w-xl mx-auto rounded-2xl border border-stone-200 bg-white/95 px-5 py-8 md:px-8 md:py-10 shadow-sm"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="checkout-recovery-panel"
      data-phase={phase}
    >
      {showSpinner ? (
        <div className="flex justify-center mb-5" aria-hidden="true">
          <div className="h-8 w-8 rounded-full border-2 border-drift-green/30 border-t-drift-green animate-spin" />
        </div>
      ) : null}

      <h2 className="font-display text-2xl md:text-3xl text-stone-900 text-center mb-3">
        {title}
      </h2>
      <p className="text-stone-600 text-center text-base md:text-lg max-w-md mx-auto mb-3">
        {body}
      </p>
      {important ? (
        <p className="text-stone-800 text-center text-sm md:text-base font-medium max-w-md mx-auto mb-3">
          {important}
        </p>
      ) : null}
      {secondary ? (
        <p className="text-stone-500 text-center text-sm max-w-md mx-auto mb-4">{secondary}</p>
      ) : null}

      {reference ? (
        <p className="text-center text-xs md:text-sm text-stone-500 mt-4">
          Reference:{' '}
          <span className="font-mono text-stone-700 break-all">{reference}</span>
        </p>
      ) : null}

      <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center items-center">
        {isDelayed || isNeedsReview ? (
          <button
            type="button"
            onClick={typeof onCheckStatus === 'function' ? onCheckStatus : undefined}
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-drift-green text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Check reservation status
          </button>
        ) : null}

        {isFailed && canRetryPayment && typeof onRetryPayment === 'function' ? (
          <button
            type="button"
            onClick={onRetryPayment}
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-drift-green text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Try payment again
          </button>
        ) : null}

        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="text-sm text-drift-green hover:underline"
        >
          Contact Drift &amp; Dwells
        </a>
      </div>
    </div>
  );
}
