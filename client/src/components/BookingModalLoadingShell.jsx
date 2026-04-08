import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '../i18n/ns/booking';

/** Body-level shell: use inline positioning so nothing in the React layout tree affects stacking. */
const SHELL_ROOT_STYLE = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  width: '100%',
  height: '100%',
  zIndex: 9999,
  display: 'flex',
  flexDirection: 'column',
  background: '#F7F4EE',
  pointerEvents: 'auto'
};

/**
 * Visible full-screen placeholder while the booking modal chunk or inner UI loads.
 * Render via createPortal(..., document.body) from BookingModalLazy.
 * @param {{ onClose: () => void, message?: string, variant?: 'loading' | 'error' }} props
 */
export default function BookingModalLoadingShell({ onClose, message, variant = 'loading' }) {
  const { t } = useTranslation('booking');
  const resolvedMessage =
    variant === 'error' ? t('modal.plannerOpenError') : (message ?? t('modal.loadingPlannerShell'));
  const dialogAria =
    variant === 'error' ? t('modal.plannerOpenError') : t('modal.loadingPlannerAria');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-busy={variant === 'loading' ? 'true' : undefined}
      aria-label={dialogAria}
      style={{
        ...SHELL_ROOT_STYLE,
        paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)'
      }}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-stone-200/80 bg-white px-6 py-3 md:px-8">
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-stone-200 text-stone-700 transition-colors hover:bg-stone-50"
          aria-label={t('modal.closeAria')}
        >
          <X className="h-5 w-5" />
        </button>
        <h2 className="font-['Playfair_Display'] text-lg text-stone-900">{t('mobile.planYourStay')}</h2>
        <span className="w-10" aria-hidden />
      </header>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6">
        {variant === 'loading' ? (
          <div
            className="h-10 w-10 animate-spin rounded-full border-2 border-stone-200 border-t-stone-700"
            aria-hidden
          />
        ) : null}
        <p className="text-center text-sm text-stone-600">{resolvedMessage}</p>
      </div>
    </div>
  );
}
