import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { stripLocaleFromPath } from '../utils/localizedRoutes';

/** Routes that render a fixed bottom bar (BookingDrawer or StickyBookingBar). Announcement bar sits above it. */
function hasStickyBottomBar(pathname) {
  pathname = stripLocaleFromPath(pathname);
  if (pathname === '/') return true;           // Home: BookingDrawer (mobile)
  if (pathname === '/valley') return true;     // Valley: BookingDrawer (mobile)
  if (/^\/cabin\/[^/]+$/.test(pathname)) return true;  // CabinDetails: StickyBookingBar
  if (/^\/craft\/step-[1-4]$/.test(pathname)) return true; // Craft steps: StickyBookingBar
  return false;
}

/** Desktop: only CabinDetails and craft steps have a visible sticky bar; Home/Valley use BookingDrawer md:hidden. */
function hasStickyBottomBarOnDesktop(pathname) {
  pathname = stripLocaleFromPath(pathname);
  if (/^\/cabin\/[^/]+$/.test(pathname)) return true;
  if (/^\/craft\/step-[1-4]$/.test(pathname)) return true;
  return false;
}

/** Bottom offset so banner sits flush above the sticky bar. BookingDrawer = 70px, StickyBookingBar ≈ 72px. */
function getBottomPosition(pathname) {
  const hasSticky = hasStickyBottomBar(pathname);
  const hasStickyDesktop = hasStickyBottomBarOnDesktop(pathname);
  if (!hasSticky) return 'bottom-0';
  // Home/Valley: BookingDrawer is exactly 70px — use 70 so no gap above "Check Availability"
  if (pathname === '/' || pathname === '/valley') {
    return hasStickyDesktop ? 'bottom-[72px]' : 'bottom-[70px] md:bottom-0';
  }
  // Cabin details & craft: StickyBookingBar ~72px
  return hasStickyDesktop ? 'bottom-[72px]' : 'bottom-[72px] md:bottom-0';
}

const AnnouncementBar = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const location = useLocation();
  const basePath = stripLocaleFromPath(location.pathname);
  const isBuildPage = basePath === '/build';
  
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

  // Smart position: only reserve space above when this route actually shows a sticky bottom bar.
  // Use exact bar height so there's no gap between banner and button (70px for BookingDrawer, 72px for StickyBookingBar).
  const bottomPosition = getBottomPosition(basePath);

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

