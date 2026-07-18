import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORT_WHATSAPP_LINK } from '../pages/guides/guideUtils';

/**
 * Failure / slow / webview recovery UI only. Renders null on happy path.
 */
export default function PaymentRecoveryNotice({
  variant = null,
  onRetry = null,
  className = ''
}) {
  const { t } = useTranslation('booking');
  const [copied, setCopied] = useState(false);

  const whatsappHref = `${SUPPORT_WHATSAPP_LINK}?text=${encodeURIComponent(
    t('confirm.payment.whatsappPrefill')
  )}`;

  const handleCopy = useCallback(async () => {
    try {
      const url = typeof window !== 'undefined' ? window.location.href : '';
      if (!url) return;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }, []);

  if (!variant) return null;

  if (variant === 'slow') {
    return (
      <p className={`text-sm text-amber-800 ${className}`.trim()} role="status">
        {t('confirm.payment.slowHint')}
      </p>
    );
  }

  if (variant === 'webview') {
    return (
      <div
        className={`rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 space-y-2 ${className}`.trim()}
        role="status"
      >
        <p className="text-sm font-medium text-amber-950">{t('confirm.payment.webviewTitle')}</p>
        <p className="text-sm text-amber-900">{t('confirm.payment.webviewBody')}</p>
        <p className="text-xs text-amber-800">{t('confirm.payment.webviewHint')}</p>
        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex justify-center items-center h-10 px-4 rounded-lg border border-amber-300 bg-white text-sm font-medium text-amber-950 hover:bg-amber-100"
          >
            {copied ? t('confirm.payment.linkCopied') : t('confirm.payment.copyLink')}
          </button>
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex justify-center items-center h-10 px-4 rounded-lg bg-[#81887A] text-sm font-medium text-white hover:opacity-95"
          >
            {t('confirm.payment.contactWhatsapp')}
          </a>
        </div>
      </div>
    );
  }

  if (variant === 'terminal') {
    return (
      <div
        className={`rounded-lg border border-red-200 bg-red-50 px-3 py-3 space-y-2 ${className}`.trim()}
        role="alert"
      >
        <p className="text-sm font-medium text-red-900">{t('confirm.payment.terminalTitle')}</p>
        <p className="text-sm text-red-800">{t('confirm.payment.terminalBody')}</p>
        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          {typeof onRetry === 'function' ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex justify-center items-center h-10 px-4 rounded-lg bg-[#81887A] text-sm font-medium text-white hover:opacity-95"
            >
              {t('confirm.payment.tryAgain')}
            </button>
          ) : null}
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex justify-center items-center h-10 px-4 rounded-lg border border-red-200 bg-white text-sm font-medium text-red-900 hover:bg-red-100"
          >
            {t('confirm.payment.contactWhatsapp')}
          </a>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex justify-center items-center h-10 px-4 rounded-lg border border-red-200 bg-white text-sm font-medium text-red-900 hover:bg-red-100"
          >
            {copied ? t('confirm.payment.linkCopied') : t('confirm.payment.copyPageLink')}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
