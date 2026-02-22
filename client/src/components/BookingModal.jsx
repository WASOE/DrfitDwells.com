import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import { X, Minus, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useBookingSearch } from '../context/BookingSearchContext';

const BookingModal = () => {
  const navigate = useNavigate();
  const {
    checkIn,
    checkOut,
    adults,
    children,
    nights,
    updateDates,
    updateGuests,
    resetSearch,
    isModalOpen,
    closeModal
  } = useBookingSearch();

  const [range, setRange] = useState({ from: checkIn, to: checkOut });
  const [error, setError] = useState('');
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setRange({ from: checkIn, to: checkOut });
  }, [checkIn, checkOut]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (isModalOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isModalOpen]);

  const handleSelect = (selectedRange) => {
    setRange(selectedRange || { from: null, to: null });
    if (selectedRange?.from && selectedRange?.to) {
      updateDates(selectedRange.from, selectedRange.to);
      setError('');
    }
  };

  const adjustGuests = (field, delta) => {
    if (field === 'adults') {
      updateGuests({ adults: adults + delta });
    } else {
      updateGuests({ children: children + delta });
    }
  };

  const handleClear = () => {
    setRange({ from: null, to: null });
    resetSearch();
    setError('');
  };

  const handleSearch = () => {
    if (!checkIn || !checkOut) {
      setError('Please select arrival and departure dates.');
      return;
    }

    const searchParams = new URLSearchParams({
      checkIn: checkIn.toISOString().split('T')[0],
      checkOut: checkOut.toISOString().split('T')[0],
      adults: adults.toString(),
      children: children.toString()
    });

    closeModal();
    navigate(`/search?${searchParams.toString()}`);
  };

  const dateSummary = useMemo(() => {
    if (checkIn && checkOut) {
      return `${checkIn.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} → ${checkOut.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    }
    return 'Select your stay';
  }, [checkIn, checkOut]);

  return (
    <AnimatePresence>
      {isModalOpen && (
        <>
          {/* Backdrop - desktop only */}
          <motion.div
            className="hidden md:block fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeModal}
          />
          
          {/* Modal */}
          <motion.div
            className="fixed inset-0 z-[9999] bg-[#F7F4EE] flex flex-col md:bg-transparent md:items-center md:justify-center md:p-8"
            initial={isMobile ? { y: '100%' } : { opacity: 0 }}
            animate={isMobile ? { y: 0 } : { opacity: 1 }}
            exit={isMobile ? { y: '100%' } : { opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
          >
            <motion.div
              className="flex flex-col h-full md:h-auto md:max-w-4xl md:w-full md:bg-white md:shadow-2xl md:rounded-3xl md:overflow-hidden"
              initial={isMobile ? {} : { scale: 0.96, opacity: 0 }}
              animate={isMobile ? {} : { scale: 1, opacity: 1 }}
              exit={isMobile ? {} : { scale: 0.96, opacity: 0 }}
              transition={{ type: 'spring', damping: 30, stiffness: 400 }}
            >
              {/* Header */}
              <header className="flex items-center justify-between px-6 md:px-8 h-16 md:h-20 border-b border-stone-200 bg-white">
                <button
                  type="button"
                  onClick={closeModal}
                  className="w-10 h-10 rounded-full border border-stone-200 flex items-center justify-center text-stone-700 hover:bg-stone-50 transition-colors"
                  aria-label="Close booking modal"
                >
                  <X className="w-5 h-5" />
                </button>
                <h2 className="font-['Playfair_Display'] text-lg md:text-xl text-stone-900">
                  Plan your stay
                </h2>
                <button
                  type="button"
                  onClick={handleClear}
                  className="text-xs uppercase tracking-[0.3em] text-stone-500 hover:text-stone-900 transition-colors"
                >
                  Clear
                </button>
              </header>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6 md:p-10">
                <div className="max-w-3xl mx-auto space-y-10 md:space-y-12">
                  {/* Dates Section */}
                  <section>
                    <div className="mb-6">
                      <p className="text-xs uppercase tracking-[0.4em] text-stone-500 mb-3">
                        Dates
                      </p>
                      <h3 className="font-['Playfair_Display'] text-2xl md:text-3xl text-stone-900 mb-2">
                        When will you be there?
                      </h3>
                      <p className="text-sm md:text-base text-stone-600">{dateSummary}</p>
                    </div>

                    <div className="mt-8">
                      <DayPicker
                        mode="range"
                        selected={range}
                        onSelect={handleSelect}
                        numberOfMonths={isMobile ? 1 : 2}
                        pagedNavigation
                        captionLayout="dropdown-buttons"
                        fromDate={new Date()}
                        modifiersClassNames={{
                          selected: 'bg-stone-900 text-white',
                          range_middle: 'bg-stone-100 text-stone-900',
                          today: 'text-stone-900 font-semibold'
                        }}
                        className="w-full"
                        styles={{
                          caption: { textAlign: 'left', fontFamily: 'Playfair Display' },
                          months: { display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '2rem' }
                        }}
                      />
                      {error && (
                        <p className="text-red-500 text-sm mt-4">{error}</p>
                      )}
                    </div>
                  </section>

                  {/* Guests Section */}
                  <section>
                    <div className="mb-6">
                      <p className="text-xs uppercase tracking-[0.4em] text-stone-500 mb-3">
                        Guests
                      </p>
                      <h3 className="font-['Playfair_Display'] text-2xl md:text-3xl text-stone-900">
                        Who is coming?
                      </h3>
                    </div>

                    <div className="mt-8 space-y-3 md:space-y-4">
                      {[
                        { label: 'Adults', description: 'Ages 13 or above', field: 'adults', value: adults, min: 1 },
                        { label: 'Children', description: 'Ages 2–12', field: 'children', value: children, min: 0 }
                      ].map(({ label, description, field, value, min }) => (
                        <div key={field} className="flex items-center justify-between bg-stone-50 rounded-xl border border-stone-200 px-6 py-5 hover:border-stone-300 transition-colors">
                          <div>
                            <p className="text-base md:text-lg font-semibold text-stone-900">{label}</p>
                            <p className="text-sm text-stone-500">{description}</p>
                          </div>
                          <div className="flex items-center gap-4">
                            <button
                              type="button"
                              onClick={() => adjustGuests(field, -1)}
                              disabled={value <= min}
                              className="w-10 h-10 rounded-full border-2 border-stone-300 flex items-center justify-center text-stone-700 hover:border-stone-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                              <Minus className="w-5 h-5" />
                            </button>
                            <span className="w-8 text-center text-lg font-semibold text-stone-900">{value}</span>
                            <button
                              type="button"
                              onClick={() => adjustGuests(field, 1)}
                              className="w-10 h-10 rounded-full border-2 border-stone-900 bg-stone-900 text-white flex items-center justify-center hover:bg-stone-800 transition-colors"
                            >
                              <Plus className="w-5 h-5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </div>

              {/* Footer */}
              <footer className="border-t border-stone-200 px-6 md:px-8 py-5 md:py-6 bg-white flex items-center justify-between">
                <div>
                  <p className="text-xs md:text-sm text-stone-500 uppercase tracking-[0.3em]">
                    {nights ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : 'Select dates'}
                  </p>
                  <p className="text-base md:text-lg text-stone-900 font-serif mt-1">
                    {adults + children} guest{adults + children === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSearch}
                  disabled={!checkIn || !checkOut}
                  className={`h-12 md:h-14 px-8 md:px-12 rounded-full bg-black text-white font-semibold text-sm uppercase tracking-[0.3em] hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all ${
                    !checkIn || !checkOut ? '' : 'shadow-lg hover:shadow-xl'
                  }`}
                >
                  Search
                </button>
              </footer>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default BookingModal;






