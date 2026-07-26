import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../services/api';

export default function CommunicationPreferences() {
  const { token } = useParams();
  const [state, setState] = useState('loading');
  const [data, setData] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.get(`/public/communication-preferences/${encodeURIComponent(token)}`);
        if (cancelled) return;
        if (!res.data?.success) {
          setState(res.data?.reason === 'expired_token' ? 'expired' : 'invalid');
          setReason(res.data?.reason || 'invalid_token');
          return;
        }
        setData(res.data.data);
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        const code = err?.response?.data?.reason;
        setState(code === 'expired_token' ? 'expired' : 'invalid');
        setReason(code || 'invalid_token');
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const withdraw = async (payload) => {
    setSaving(true);
    setResult(null);
    try {
      const res = await api.post(
        `/public/communication-preferences/${encodeURIComponent(token)}`,
        payload
      );
      if (!res.data?.success) {
        if (res.data?.reason === 'grant_not_allowed') {
          setResult({ error: 'This page cannot grant consent.' });
        } else {
          setResult({ error: res.data?.reason || 'Update failed' });
        }
        return;
      }
      setData((prev) => ({
        ...prev,
        preferences: res.data.data.preferences
      }));
      setResult({
        ok: true,
        idempotent: res.data.data.idempotent,
        message: res.data.data.idempotent
          ? 'Preferences were already updated.'
          : 'Preferences updated.'
      });
    } catch (err) {
      const code = err?.response?.data?.reason;
      if (code === 'grant_not_allowed') {
        setResult({ error: 'This page cannot grant consent.' });
      } else if (code === 'expired_token') {
        setState('expired');
      } else {
        setResult({ error: code || 'Update failed' });
      }
    } finally {
      setSaving(false);
    }
  };

  if (state === 'loading') {
    return (
      <div className="max-w-xl mx-auto px-4 py-16">
        <p className="text-sm text-gray-600">Loading preferences…</p>
      </div>
    );
  }

  if (state === 'expired') {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 space-y-3">
        <h1 className="text-2xl font-semibold text-gray-900">Link expired</h1>
        <p className="text-sm text-gray-600">
          This preferences link has expired. Contact us if you still need to update your email
          preferences.
        </p>
      </div>
    );
  }

  if (state === 'invalid') {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 space-y-3">
        <h1 className="text-2xl font-semibold text-gray-900">Invalid link</h1>
        <p className="text-sm text-gray-600">
          This preferences link is invalid or no longer available.
          {reason ? ` (${reason})` : ''}
        </p>
      </div>
    );
  }

  const prefs = data?.preferences || {};

  return (
    <div className="max-w-xl mx-auto px-4 py-12 sm:py-16 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Email preferences</h1>
        <p className="text-sm text-gray-600 mt-2">
          For {data?.maskedEmail}. This page can only withdraw optional contact — it cannot grant
          new consent.
        </p>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
        {data?.notice}
      </div>

      <ul className="text-sm text-gray-700 space-y-2">
        <li>Quote delivery: {prefs.quoteDeliveryAllowed ? 'allowed' : 'not allowed'}</li>
        <li>Booking reminders: {prefs.bookingReminderAllowed ? 'allowed' : 'not allowed'}</li>
        <li>Marketing: {prefs.marketingAllowed ? 'allowed' : 'not allowed'}</li>
        <li>
          Global suppression: {prefs.globallySuppressed ? 'on' : 'off'}
        </li>
      </ul>

      <div className="space-y-3">
        <button
          type="button"
          disabled={saving || !prefs.bookingReminderAllowed}
          onClick={() => withdraw({ withdrawBookingReminder: true })}
          className="w-full sm:w-auto px-4 py-2 rounded-lg border border-gray-300 text-sm disabled:opacity-40"
        >
          Withdraw booking reminder consent
        </button>
        <button
          type="button"
          disabled={saving || !prefs.quoteDeliveryAllowed}
          onClick={() => withdraw({ withdrawQuoteDelivery: true })}
          className="w-full sm:w-auto px-4 py-2 rounded-lg border border-gray-300 text-sm disabled:opacity-40 block"
        >
          Withdraw quote delivery consent
        </button>
        <button
          type="button"
          disabled={saving || !prefs.marketingAllowed}
          onClick={() => withdraw({ withdrawMarketing: true })}
          className="w-full sm:w-auto px-4 py-2 rounded-lg border border-gray-300 text-sm disabled:opacity-40 block"
        >
          Withdraw marketing consent
        </button>
        <button
          type="button"
          disabled={saving || prefs.globallySuppressed}
          onClick={() => withdraw({ suppressAll: true })}
          className="w-full sm:w-auto px-4 py-2 rounded-lg bg-gray-900 text-white text-sm disabled:opacity-40 block"
        >
          Suppress all optional contact
        </button>
      </div>

      {result?.ok ? (
        <p className="text-sm text-green-700">{result.message}</p>
      ) : null}
      {result?.error ? <p className="text-sm text-red-600">{result.error}</p> : null}
    </div>
  );
}
