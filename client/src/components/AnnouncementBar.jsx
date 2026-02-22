import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';

const AnnouncementBar = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const location = useLocation();
  const isCabinPage = location.pathname === '/cabin';
  const isBuildPage = location.pathname === '/build';
  
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Don't show announcement bar on Build page (after all hooks)
  if (isBuildPage) {
    return null;
  }

  const handleBarClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
  };

  // On cabin page: always at bottom-0 (below booking bar)
  // On other pages: bottom-[70px] on mobile (above BookingDrawer), bottom-0 on desktop
  const bottomPosition = isCabinPage 
    ? 'bottom-0' 
    : 'bottom-[70px] md:bottom-0';

  return (
    <>
      {/* Announcement Bar */}
      <div
        onClick={handleBarClick}
        className={`fixed z-40 w-full bg-[#1c1917] border-t border-white/10 cursor-pointer hover:bg-black transition-colors ${bottomPosition}`}
        style={{ 
          isolation: 'isolate',
          transform: 'translateZ(0)'
        }}
      >
        <div className="text-center">
          <p className="text-[#F1ECE2] text-[10px] md:text-xs font-bold uppercase tracking-[0.2em] py-3">
            RATED TOP 1% ON PLATFORMS • WE'VE GONE SOLO • BOOK DIRECT & SAVE FEES
          </p>
        </div>
      </div>

      {/* Manifesto Modal */}
      {isModalOpen && isMounted && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md px-4"
          onClick={handleCloseModal}
        >
          <div
            className="bg-[#F1ECE2] text-[#1c1917] w-full max-w-md p-8 rounded-2xl shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              onClick={handleCloseModal}
              className="absolute top-4 right-4 text-[#1c1917] hover:text-stone-600 transition-colors"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Content */}
            <h2 className="font-serif text-3xl font-bold text-[#1c1917] mb-4">
              We've Gone Wild.
            </h2>
            <p className="font-sans text-xs uppercase tracking-widest text-stone-500 mb-6">
              From Top 1% on Airbnb to 100% Independent.
            </p>
            <p className="font-serif text-base leading-relaxed text-[#1c1917] mb-8">
              We realized something important: We'd rather invest in our guests than in platform fees. By booking direct, the 15% service fee stays in your pocket. Same luxury, better price.
            </p>
            <button
              onClick={handleCloseModal}
              className="w-full bg-[#1c1917] text-[#F1ECE2] font-semibold py-3 px-6 rounded-lg hover:bg-black transition-colors uppercase tracking-wide text-sm"
            >
              See Your Savings
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default AnnouncementBar;

