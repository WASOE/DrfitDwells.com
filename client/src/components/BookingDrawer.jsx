import { useTranslation } from 'react-i18next';
import { useBookingSearch } from '../context/BookingSearchContext';
import '../i18n/ns/booking';

const BookingDrawer = () => {
  const { openModal } = useBookingSearch();
  const { t } = useTranslation('booking');

  return (
    <div className="fixed bottom-0 left-0 w-full h-[70px] z-50 bg-stone-900/90 backdrop-blur-md border-t border-white/10 p-4 safe-area-bottom md:hidden flex items-center">
      <button
        onClick={openModal}
        className="w-full bg-[#F1ECE2] text-stone-900 py-3 rounded-none uppercase tracking-[0.2em] text-xs font-bold focus:outline-none focus:ring-2 focus:ring-[#F1ECE2]/50 active:scale-[0.98] transition-all duration-150 touch-manipulation"
      >
        {t('cta.checkAvailability')}
      </button>
    </div>
  );
};

export default BookingDrawer;

