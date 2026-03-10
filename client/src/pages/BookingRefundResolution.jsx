import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { bookingAPI } from '../services/api';
import { CONTACT_EMAIL } from '../data/gmbLocations';

const statusLabels = {
  finalization_failed: 'Processing refund',
  refund_pending: 'Refund in progress',
  refunded: 'Refund completed',
  refund_failed: 'Refund failed – support notified'
};

const BookingRefundResolution = () => {
  const [searchParams] = useSearchParams();
  const paymentIntentId = searchParams.get('payment_intent');
  const email = searchParams.get('email') || '';
  const checkIn = searchParams.get('checkIn');
  const checkOut = searchParams.get('checkOut');
  const adults = searchParams.get('adults');
  const children = searchParams.get('children');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const searchHref = (() => {
    const params = new URLSearchParams();
    if (checkIn) params.set('checkIn', checkIn);
    if (checkOut) params.set('checkOut', checkOut);
    if (adults) params.set('adults', adults);
    if (children != null) params.set('children', children);
    const q = params.toString();
    return q ? `/search?${q}` : '/search';
  })();

  useEffect(() => {
    if (!paymentIntentId) {
      setError('Missing payment reference');
      setLoading(false);
      return;
    }
    if (!email || !email.includes('@')) {
      setError('Could not verify your booking. Please use the link from your email or contact support.');
      setLoading(false);
      return;
    }
    const fetchStatus = async () => {
      try {
        const res = await bookingAPI.getRefundStatus(paymentIntentId, email);
        if (res.data?.success && res.data?.data) {
          setData(res.data.data);
        } else {
          setError('Could not load refund status');
        }
      } catch (err) {
        setError(err.response?.data?.message || 'Could not load refund status');
      } finally {
        setLoading(false);
      }
    };
    fetchStatus();
  }, [paymentIntentId, email]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F7F4EE] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#81887A]" />
      </div>
    );
  }

  if (error || !paymentIntentId) {
    return (
      <div className="min-h-screen bg-[#F7F4EE] flex items-center justify-center px-4">
        <div className="max-w-xl w-full text-center">
          <h1 className="text-2xl font-semibold text-stone-800 mb-4">Refund status</h1>
          <p className="text-stone-600 mb-6">{error || 'No payment reference provided.'}</p>
          <Link
            to={searchHref}
            className="inline-block px-6 py-3 rounded-xl bg-[#81887A] text-white font-medium hover:opacity-95"
          >
            Search availability
          </Link>
        </div>
      </div>
    );
  }

  const amount = data?.amountCents != null ? (data.amountCents / 100).toFixed(2) : null;
  const checkInStr = data?.checkIn ? new Date(data.checkIn).toLocaleDateString('en-GB') : '';
  const checkOutStr = data?.checkOut ? new Date(data.checkOut).toLocaleDateString('en-GB') : '';

  return (
    <div className="min-h-screen bg-[#F7F4EE] flex items-center justify-center px-4 py-16">
      <div className="max-w-xl w-full mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
          <div className="bg-[#81887A] text-white px-6 py-8 text-center">
            <h1 className="text-2xl md:text-3xl font-semibold">Refund in progress</h1>
            <p className="mt-2 opacity-90">Your payment is being refunded</p>
          </div>
          <div className="px-6 py-8 space-y-6">
            <p className="text-stone-700 leading-relaxed">
              Unfortunately, this stay was booked moments before your payment completed. We have started your refund.
            </p>

            {data && (
              <div className="bg-stone-50 rounded-xl p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-stone-500">Status</span>
                  <span className="font-medium">{statusLabels[data.status] || data.status}</span>
                </div>
                {amount && (
                  <div className="flex justify-between">
                    <span className="text-stone-500">Amount</span>
                    <span>€{amount}</span>
                  </div>
                )}
                {data.cabinName && (
                  <div className="flex justify-between">
                    <span className="text-stone-500">Cabin</span>
                    <span>{data.cabinName}</span>
                  </div>
                )}
                {checkInStr && checkOutStr && (
                  <div className="flex justify-between">
                    <span className="text-stone-500">Dates</span>
                    <span>{checkInStr} – {checkOutStr}</span>
                  </div>
                )}
                <div className="flex justify-between items-start gap-2">
                  <span className="text-stone-500 shrink-0">Payment reference</span>
                  <span className="font-mono text-xs break-all text-right">{paymentIntentId}</span>
                </div>
              </div>
            )}

            <p className="text-stone-600 text-sm">
              Refunds typically take 5–10 business days to appear, depending on your bank or card issuer. You will receive a confirmation by email once the refund is processed.
            </p>

            <div className="pt-4 space-y-3">
              <Link
                to={searchHref}
                className="block w-full py-3 text-center rounded-xl bg-[#81887A] text-white font-medium hover:opacity-95"
              >
                Search for availability
              </Link>
              <p className="text-center text-sm text-stone-500">
                Questions? <a href={`mailto:${CONTACT_EMAIL}`} className="underline hover:text-stone-700">{CONTACT_EMAIL}</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookingRefundResolution;
