import { useState, useEffect } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import '../../styles/daypicker-theme.css';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
/**
 * Airbnb-style "Change dates" modal with DayPicker, Clear dates, Save.
 */
const ChangeDatesModal = ({ isOpen, onClose, checkIn, checkOut, onSave, minDate }) => {
  const [range, setRange] = useState({ from: checkIn, to: checkOut });
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    setRange({ from: checkIn, to: checkOut });
  }, [checkIn, checkOut, isOpen]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen]);

  const handleSelect = (selectedRange) => {
    setRange(selectedRange || { from: null, to: null });
  };

  const handleClear = () => {
    setRange({ from: null, to: null });
  };

  const handleSave = () => {
    if (range?.from && range?.to && range.to > range.from) {
      onSave(range.from, range.to);
      onClose();
    }
  };

  if (!isOpen) return null;

  const fromDate = minDate || new Date();

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[9999] bg-[#F7F4EE] flex flex-col md:bg-black/50 md:items-center md:justify-center md:p-8"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 220 }}
      >
        <motion.div
          className="flex flex-col h-full md:h-auto md:max-w-2xl md:w-full md:bg-white md:rounded-t-2xl md:overflow-hidden md:shadow-2xl"
          initial={{}}
          animate={{}}
        >
          {/* Header */}
          <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
            <h2 className="text-lg font-semibold text-gray-900">Change dates</h2>
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </header>

          {/* Calendar */}
          <div className="flex-1 overflow-y-auto p-6 bg-white">
            <DayPicker
              mode="range"
              selected={range}
              onSelect={handleSelect}
              numberOfMonths={isMobile ? 1 : 2}
              pagedNavigation
              captionLayout="dropdown-buttons"
              fromDate={fromDate}
              disabled={{ before: fromDate }}
              modifiersClassNames={{
                selected: 'bg-gray-900 text-white rounded-full',
                range_middle: 'bg-gray-100 text-gray-900 rounded-none',
                today: 'text-gray-900 font-semibold'
              }}
              className="w-full border-0"
            />
          </div>

          {/* Footer */}
          <footer className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-white">
            <button
              type="button"
              onClick={handleClear}
              className="text-sm text-gray-600 underline hover:text-gray-900"
            >
              Clear dates
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!range?.from || !range?.to || range.to <= range.from}
              className="h-11 px-6 rounded-lg bg-gray-900 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-800 transition-colors"
            >
              Save
            </button>
          </footer>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default ChangeDatesModal;
