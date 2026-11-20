import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import '../i18n/ns/cabinPriority';
import { localizePath } from '../utils/localizedRoutes';

export default function CabinPriorityUnsubscribe() {
  const { token } = useParams();
  const { i18n } = useTranslation('cabinPriority');
  const [state, setState] = useState('loading');
  const [language, setLanguage] = useState('en');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/public/cabin-priority/unsubscribe/${encodeURIComponent(token)}`);
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || body.success !== true) {
          setReason(body.reason === 'expired_token' ? 'expired' : 'invalid');
          setState('error');
          return;
        }
        setLanguage(body.data.language === 'bg' ? 'bg' : 'en');
        setState(body.data.alreadyUnsubscribed ? 'already' : 'ready');
      } catch {
        if (!cancelled) {
          setReason('invalid');
          setState('error');
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [token]);

  const t = i18n.getFixedT(language, 'cabinPriority');
  const home = localizePath('/', language);

  const confirm = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/public/cabin-priority/unsubscribe/${encodeURIComponent(token)}`, {
        method: 'POST'
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.success !== true) {
        setReason(body.reason === 'expired_token' ? 'expired' : 'invalid');
        setState('error');
        return;
      }
      setState(body.data.idempotent ? 'already' : 'success');
    } catch {
      setReason('invalid');
      setState('error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-[70vh] bg-[#FAF9F6] px-4 py-16 md:py-24">
      <div className="mx-auto w-full max-w-lg rounded-2xl border border-stone-200 bg-white p-6 md:p-10 shadow-sm">
        <h1 className="font-serif text-3xl text-[#1c1917]">{t('unsubscribe.title')}</h1>

        {state === 'loading' && <p className="mt-4 text-stone-600">{t('submitting')}</p>}

        {state === 'ready' && (
          <>
            <p className="mt-4 text-[15px] leading-relaxed text-stone-700">{t('unsubscribe.body')}</p>
            <button
              type="button"
              onClick={confirm}
              disabled={saving}
              className="mt-6 w-full rounded-xl bg-[#1c1917] px-5 py-3.5 text-sm font-semibold text-[#F8F5EF] hover:bg-stone-800 disabled:opacity-60"
            >
              {saving ? t('unsubscribe.working') : t('unsubscribe.confirm')}
            </button>
          </>
        )}

        {state === 'success' && <p className="mt-4 text-[15px] text-stone-700" role="status">{t('unsubscribe.success')}</p>}
        {state === 'already' && <p className="mt-4 text-[15px] text-stone-700" role="status">{t('unsubscribe.already')}</p>}

        {state === 'error' && (
          <p className="mt-4 text-[15px] text-stone-700" role="alert">
            {reason === 'expired' ? t('unsubscribe.expired') : t('unsubscribe.invalid')}
          </p>
        )}

        {(state === 'success' || state === 'already' || state === 'error') && (
          <Link to={home} className="mt-6 inline-block text-sm font-medium text-[#1c1917] underline underline-offset-4">
            {t('unsubscribe.home')}
          </Link>
        )}
      </div>
    </main>
  );
}
