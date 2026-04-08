import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * Airbnb-style "Price details" modal with breakdown.
 */
const PriceDetailsModal = ({
  isOpen,
  onClose,
  nights,
  pricePerNight,
  totalPrice,
  /** When set, show server subtotal + optional discount (lodging + extras combined). */
  serverSubtotal,
  discountAmount = 0,
  currency = 'EUR',
  extras = [] // { label, amount }
}) => {
  const { t } = useTranslation('booking');
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const baseTotal = nights && pricePerNight ? nights * pricePerNight : totalPrice || 0;
  const extrasTotal = Array.isArray(extras) ? extras.reduce((s, e) => s + (e.amount || 0), 0) : 0;
  const displayTotal = totalPrice ?? (baseTotal + extrasTotal);
  const showServerBreakdown = serverSubtotal != null && Number.isFinite(Number(serverSubtotal));
  const disc = Math.max(0, Number(discountAmount) || 0);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[9999] flex flex-col md:items-center md:justify-end md:pb-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div
          className="absolute inset-0 bg-black/50"
          onClick={onClose}
          aria-hidden="true"
        />
        <motion.div
          className="relative bg-white rounded-t-2xl shadow-2xl max-h-[80vh] overflow-hidden md:max-w-lg md:mx-auto md:rounded-2xl"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 220 }}
        >
          {/* Header */}
          <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">{t('confirm.priceDetailsModalTitle')}</h2>
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors"
              aria-label={t('modal.closeAria')}
            >
              <X className="w-5 h-5" />
            </button>
          </header>

          {/* Breakdown */}
          <div className="px-6 py-4 space-y-4">
            {showServerBreakdown ? (
              <div className="flex justify-between items-center text-gray-900">
                <span>{t('confirm.stayAndAddons')}</span>
                <span className="font-medium tabular-nums">€{Number(serverSubtotal).toLocaleString()}</span>
              </div>
            ) : (
              <>
                {nights && pricePerNight != null && (
                  <div className="flex justify-between items-center text-gray-900">
                    <span>
                      {t('modal.nights', { count: nights })} × €{Number(pricePerNight).toLocaleString()}
                    </span>
                    <span className="font-medium tabular-nums">
                      €{(nights * pricePerNight).toLocaleString()}
                    </span>
                  </div>
                )}
                {extras.map((extra, i) => (
                  <div key={i} className="flex justify-between items-center text-gray-900">
                    <span>{extra.label}</span>
                    <span className="font-medium tabular-nums">€{Number(extra.amount || 0).toLocaleString()}</span>
                  </div>
                ))}
              </>
            )}
            {disc > 0 && (
              <div className="flex justify-between items-center text-gray-700">
                <span>{t('confirm.promoShort')}</span>
                <span className="font-medium tabular-nums">−€{disc.toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-3 border-t border-gray-200 font-semibold text-gray-900">
              <span>{t('confirm.totalWithCurrency', { currency })}</span>
              <span className="tabular-nums">€{Number(displayTotal).toLocaleString()}</span>
            </div>
          </div>

          <div className="px-6 pb-6">
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-gray-600 underline hover:text-gray-900"
            >
              {t('confirm.priceBreakdownDismiss')}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default PriceDetailsModal;
