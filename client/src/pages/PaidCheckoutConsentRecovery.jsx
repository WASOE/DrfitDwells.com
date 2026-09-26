import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { bookingAPI } from '../services/api';
import {
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
  LEGAL_ACCEPTANCE_TERMS_VERSION
} from '../constants/legalAcceptance';

const initialForm = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  agreedToTerms: false,
  agreedToActivityRisk: false
};

export default function PaidCheckoutConsentRecovery() {
  const { checkoutId } = useParams();
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const update = (event) => {
    const { name, type, checked, value } = event.target;
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await bookingAPI.submitPaidCheckoutRecoveryConsent(checkoutId, {
        guestInfo: {
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          phone: form.phone
        },
        legalAcceptance: {
          acceptedTermsAndCancellation: form.agreedToTerms,
          acceptedActivityRisk: form.agreedToActivityRisk,
          termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
          activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
          checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
          checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
          locale: 'en'
        },
        experienceKeys: []
      });
      if (!response.data?.success || response.data?.noPaymentAttempted !== true) {
        throw new Error('Could not record your consent. Please contact support.');
      }
      setSubmitted(true);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        err?.message ||
        'Could not record your consent. Please contact support.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-5 py-12 text-stone-900">
      <h1 className="font-serif text-3xl">Complete your existing booking record</h1>
      <p className="mt-4 text-stone-700">
        Your payment has already been received. This secure form records your guest details
        and required acknowledgments for that existing checkout only. It does not collect
        payment details, create a PaymentIntent, or charge your card.
      </p>

      {submitted ? (
        <div className="mt-8 rounded-lg border border-green-700/30 bg-green-50 p-5" role="status">
          <h2 className="font-semibold">Your details and consent have been recorded.</h2>
          <p className="mt-2 text-sm">
            Your existing payment will be used to continue reservation recovery. Do not
            make another payment. We will contact you if any additional information is needed.
          </p>
        </div>
      ) : (
        <form className="mt-8 space-y-5" onSubmit={submit}>
          <p className="text-sm text-stone-700">
            Enter the email address used for the original booking. It must match the existing
            paid checkout.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              First name
              <input
                autoComplete="given-name"
                className="mt-1 block w-full rounded border border-stone-400 px-3 py-2"
                name="firstName"
                onChange={update}
                required
                value={form.firstName}
              />
            </label>
            <label className="block text-sm font-medium">
              Last name
              <input
                autoComplete="family-name"
                className="mt-1 block w-full rounded border border-stone-400 px-3 py-2"
                name="lastName"
                onChange={update}
                required
                value={form.lastName}
              />
            </label>
            <label className="block text-sm font-medium">
              Booking email
              <input
                autoComplete="email"
                className="mt-1 block w-full rounded border border-stone-400 px-3 py-2"
                name="email"
                onChange={update}
                required
                type="email"
                value={form.email}
              />
            </label>
            <label className="block text-sm font-medium">
              Phone
              <input
                autoComplete="tel"
                className="mt-1 block w-full rounded border border-stone-400 px-3 py-2"
                name="phone"
                onChange={update}
                required
                type="tel"
                value={form.phone}
              />
            </label>
          </div>

          <label className="flex items-start gap-3 text-sm">
            <input
              className="mt-1"
              checked={form.agreedToTerms}
              name="agreedToTerms"
              onChange={update}
              required
              type="checkbox"
            />
            <span>
              {LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT}
              {' Read the '}
              <Link className="underline" rel="noreferrer" target="_blank" to="/terms">
                current Terms &amp; Conditions
              </Link>{' '}
              and{' '}
              <Link
                className="underline"
                rel="noreferrer"
                target="_blank"
                to="/cancellation-policy"
              >
                current Cancellation Policy
              </Link>
              .
            </span>
          </label>

          <label className="flex items-start gap-3 text-sm">
            <input
              className="mt-1"
              checked={form.agreedToActivityRisk}
              name="agreedToActivityRisk"
              onChange={update}
              required
              type="checkbox"
            />
            <span>{LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT}</span>
          </label>

          {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
          <button
            className="rounded bg-stone-900 px-5 py-3 font-medium text-white disabled:opacity-60"
            disabled={submitting}
            type="submit"
          >
            {submitting ? 'Saving…' : 'Save details and consent'}
          </button>
          <p className="text-xs text-stone-600">
            Required consent versions: terms {LEGAL_ACCEPTANCE_TERMS_VERSION}; activity risk{' '}
            {LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION}.
          </p>
        </form>
      )}
    </main>
  );
}
