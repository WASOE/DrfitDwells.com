import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import '../../i18n/ns/cabinPriority';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import { localizePath } from '../../utils/localizedRoutes';

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];

function collectAttribution() {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  return {
    utmSource: params.get('utm_source'),
    utmMedium: params.get('utm_medium'),
    utmCampaign: params.get('utm_campaign'),
    referrer: document.referrer || null,
    landingPath: window.location.pathname
  };
}

export default function CabinPriorityListModal({ open, onClose, checkIn, checkOut, sourcePage }) {
  const { t } = useTranslation('cabinPriority');
  const { language } = useSiteLanguage();
  const [email, setEmail] = useState('');
  const [month, setMonth] = useState('flexible');
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const emailRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setStatus('idle');
    setError('');
    setEmail('');
    setMonth('flexible');
    setConsent(false);
    setHoneypot('');
    const timer = setTimeout(() => emailRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const submit = async (event) => {
    event.preventDefault();
    if (status === 'submitting') return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(t('errorEmail'));
      setStatus('error');
      return;
    }
    if (!consent) {
      setError(t('errorConsent'));
      setStatus('error');
      return;
    }

    setStatus('submitting');
    setError('');
    try {
      const response = await fetch('/api/public/cabin-priority-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          preferredMonth: month,
          checkIn: checkIn || null,
          checkOut: checkOut || null,
          language,
          sourcePath: `${window.location.pathname}${window.location.search}`,
          sourcePage: sourcePage || 'cabin',
          consent: true,
          website: honeypot,
          attribution: collectAttribution()
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.success !== true) {
        throw new Error(body.message || t('errorGeneric'));
      }
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setError(err?.message || t('errorGeneric'));
    }
  };

  return (
    <div
      className="fixed inset-0 z-[130] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cabin-priority-title"
        className="relative w-full max-w-lg bg-[#F9F8F6] p-6 shadow-2xl sm:rounded-2xl sm:p-8 max-h-[92vh] overflow-y-auto"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full text-stone-600 hover:bg-stone-200/70"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        {status === 'success' ? (
          <div className="py-2">
            <h2 id="cabin-priority-title" className="font-serif text-2xl text-[#1c1917] pr-8">
              {t('successBody')}
            </h2>
            <div className="mt-6 flex flex-col gap-3 text-sm">
              <Link to={localizePath('/valley', language)} className="font-medium text-[#1c1917] underline underline-offset-4">
                {t('exploreValley')}
              </Link>
              <Link to={localizePath('/gift-vouchers', language)} className="font-medium text-[#1c1917] underline underline-offset-4">
                {t('giftStay')}
              </Link>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-7 w-full rounded-xl bg-[#1c1917] px-5 py-3 text-sm font-semibold text-[#F8F5EF] hover:bg-stone-800"
            >
              {t('close')}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <h2 id="cabin-priority-title" className="font-serif text-2xl leading-tight text-[#1c1917] pr-8">
              {t('heading')}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-stone-600">{t('description')}</p>

            <label htmlFor="cabin-priority-email" className="mt-6 block text-xs font-semibold uppercase tracking-[0.14em] text-stone-600">
              {t('emailLabel')}
            </label>
            <input
              id="cabin-priority-email"
              ref={emailRef}
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t('emailPlaceholder')}
              className="mt-2 w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base text-[#1c1917] outline-none focus:border-[#81887A] focus:ring-2 focus:ring-[#81887A]/30"
            />

            <label htmlFor="cabin-priority-month" className="mt-4 block text-xs font-semibold uppercase tracking-[0.14em] text-stone-600">
              {t('monthLabel')} <span className="font-normal normal-case tracking-normal text-stone-400">({t('optional')})</span>
            </label>
            <select
              id="cabin-priority-month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="mt-2 w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base text-[#1c1917] outline-none focus:border-[#81887A] focus:ring-2 focus:ring-[#81887A]/30"
            >
              <option value="flexible">{t('monthFlexible')}</option>
              {MONTHS.map((key) => (
                <option key={key} value={key}>{t(`months.${key}`)}</option>
              ))}
            </select>

            <label className="mt-5 flex items-start gap-3 text-sm leading-relaxed text-stone-700">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-stone-400"
              />
              <span>{t('consentLabel')}</span>
            </label>

            <input
              type="text"
              name="website"
              value={honeypot}
              onChange={(event) => setHoneypot(event.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="sr-only"
            />

            {status === 'error' && error && (
              <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>
            )}

            <button
              type="submit"
              disabled={status === 'submitting'}
              className="mt-6 w-full rounded-xl bg-[#1c1917] px-5 py-3.5 text-sm font-semibold text-[#F8F5EF] transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === 'submitting' ? t('submitting') : t('submit')}
            </button>
            <p className="mt-3 text-center text-xs text-stone-500">{t('footnote')}</p>
          </form>
        )}
      </div>
    </div>
  );
}
