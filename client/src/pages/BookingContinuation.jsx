import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../services/api';
import { formatMoneyFromCents } from '../utils/formatMoney';

export default function BookingContinuation() {
  const { token } = useParams();
  const [state, setState] = useState('loading');
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.get(`/public/booking-continuation/${encodeURIComponent(token)}`);
        if (cancelled) return;
        if (!res.data?.success) {
          setState(res.data?.reason === 'expired_token' ? 'expired' : 'invalid');
          return;
        }
        setData(res.data.data);
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setState(err?.response?.data?.reason === 'expired_token' ? 'expired' : 'invalid');
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state === 'loading') {
    return (
      <div className="max-w-xl mx-auto px-4 py-16">
        <p className="text-sm text-gray-600">Loading your quote…</p>
      </div>
    );
  }

  if (state === 'expired' || state === 'invalid') {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 space-y-3">
        <h1 className="text-2xl font-semibold text-gray-900">
          {state === 'expired' ? 'Link expired' : 'Invalid link'}
        </h1>
        <p className="text-sm text-gray-600">
          This continuation link is no longer valid. You can still browse stays and request a new
          quote.
        </p>
        <Link to="/" className="text-sm underline text-gray-800">
          Back to home
        </Link>
      </div>
    );
  }

  const quote = data.originalQuote;

  return (
    <div className="max-w-xl mx-auto px-4 py-12 sm:py-16 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Continue your booking</h1>
        <p className="text-sm text-gray-600 mt-2">{data.stayLabel}</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-2 text-sm">
        <p>
          Original quote (immutable): {quote.checkIn} → {quote.checkOut}
        </p>
        <p>
          Guests: {quote.adults} adults, {quote.children} children
        </p>
        <p>
          Quoted total: {formatMoneyFromCents(quote.quotedTotalCents, quote.currency)}
        </p>
        <p className="text-xs text-gray-500">
          Availability status: {data.availabilityStatus}. {data.availabilityNote}
        </p>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
        This link does not reserve inventory or lock price after the original quote expiry. Current
        price and availability are revalidated when you continue.
      </div>

      <Link
        to={data.destinationPath}
        className="inline-flex px-4 py-2 rounded-lg bg-gray-900 text-white text-sm"
      >
        Continue to booking
      </Link>
    </div>
  );
}
