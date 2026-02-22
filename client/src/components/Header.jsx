import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useBookingSearch } from '../context/BookingSearchContext';

const Header = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const location = useLocation();
  const { openModal } = useBookingSearch();
  const isHeroOverlay = location.pathname === '/' || location.pathname === '/cabin' || location.pathname === '/valley' || location.pathname === '/about';

  // Detect scroll position
  useEffect(() => {
    if (!isHeroOverlay) {
      setIsScrolled(false);
      return;
    }

    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isHeroOverlay]);

  // Determine if we should use dark theme (scrolled on hero or non-hero pages)
  const useDarkTheme = isScrolled || !isHeroOverlay;

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileMenuOpen]);

  // Desktop navigation links
  const navLinks = [
    { to: '/', label: 'Home' },
    { to: '/cabin', label: 'The Cabin' },
    { to: '/valley', label: 'The Valley' },
    { to: '/about', label: 'About' },
    { to: '/build', label: 'Build' }
  ];

  // Mobile navigation links (including Search)
  const mobileNavLinks = [
    { to: '/', label: 'Home', isModal: false },
    { to: '/cabin', label: 'The Cabin', isModal: false },
    { to: '/valley', label: 'The Valley', isModal: false },
    { to: '/about', label: 'About', isModal: false },
    { to: '/build', label: 'Build', isModal: false },
    { to: null, label: 'Search', isModal: true }
  ];

  const isActive = (path) => location.pathname === path;

  const handleMobileLinkClick = (link) => {
    setIsMobileMenuOpen(false);
    if (link.isModal) {
      openModal();
    }
  };

  // Animation variants for mobile menu
  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
        delayChildren: 0.1
      }
    },
    exit: {
      opacity: 0,
      transition: {
        staggerChildren: 0.05,
        staggerDirection: -1
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    show: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.4,
        ease: [0.22, 1, 0.36, 1]
      }
    },
    exit: {
      opacity: 0,
      y: 20,
      transition: {
        duration: 0.3,
        ease: [0.22, 1, 0.36, 1]
      }
    }
  };

  // Console island styles based on theme
  const consoleIslandClasses = useDarkTheme
    ? 'bg-white/80 backdrop-blur-md border border-stone-200 shadow-sm'
    : 'bg-black/20 backdrop-blur-md border border-white/10 shadow-lg';

  // Link text colors based on theme
  const linkTextClasses = useDarkTheme
    ? 'text-stone-900'
    : 'text-white';

  return (
    <>
      <header className={`fixed top-0 w-full z-50 px-6 py-6 transition-all duration-300 ${useDarkTheme ? 'bg-white/90 backdrop-blur-md shadow-sm' : 'bg-transparent'}`}>
        <div className="max-w-7xl mx-auto">
          {/* 3-Zone Layout */}
          <div className="flex justify-between items-center">
            {/* Zone 1: The Brand (Left) */}
            <div className="flex-shrink-0">
              <Link to="/" className="flex items-center" onClick={() => setIsMobileMenuOpen(false)}>
                {useDarkTheme ? (
                  // Dark logo for light backgrounds (scrolled or non-hero pages)
                  <img 
                    src="/uploads/Logo/DRIFTS-ai.png" 
                    alt="Drift & Dwells" 
                    className="h-8 sm:h-10 w-auto transition-opacity duration-300"
                    style={{ filter: 'contrast(1.1) brightness(0.95)' }}
                  />
                ) : (
                  // White logo for dark hero background (top of page) - with drop shadow
                  <img 
                    src="/uploads/Logo/Drift-Dwell-white.png" 
                    alt="Drift & Dwells" 
                    className="h-8 sm:h-10 w-auto transition-opacity duration-300 drop-shadow-md"
                  />
                )}
              </Link>
            </div>

            {/* Zone 2: The Console (Center) - Floating Island */}
            <nav className={`hidden md:flex items-center gap-1 ${consoleIslandClasses} rounded-full px-2 py-2 transition-all duration-300`}>
              {navLinks.map((link) => {
                const active = isActive(link.to);
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={`
                      px-5 py-2 rounded-full text-sm font-medium transition-all duration-300 ${linkTextClasses}
                      ${active
                        ? useDarkTheme
                          ? 'bg-stone-100'
                          : 'bg-white/10'
                        : useDarkTheme
                          ? 'hover:bg-stone-100'
                          : 'hover:bg-white/10'
                      }
                    `}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>

            {/* Zone 3: The Action (Right) */}
            <div className="hidden md:flex items-center gap-3 flex-shrink-0">
              <button
                onClick={openModal}
                className="bg-[#F1ECE2] text-stone-900 px-6 py-3 rounded-full font-bold uppercase tracking-widest text-xs hover:scale-105 transition-transform shadow-md active:scale-95"
              >
                Book
              </button>
            </div>

            {/* Mobile menu button */}
            <div className="md:hidden relative z-[70] flex-shrink-0 flex items-center gap-2">
              <button 
                className={`
                  p-2 -mr-2 touch-manipulation transition-colors duration-200
                  ${isMobileMenuOpen 
                    ? 'text-[#F1ECE2]' 
                    : useDarkTheme 
                      ? 'text-stone-700 hover:text-stone-900' 
                      : 'text-white/80 hover:text-white'
                  }
                `}
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                aria-label="Toggle menu"
              >
                <motion.div
                  initial={false}
                  animate={{ rotate: isMobileMenuOpen ? 90 : 0 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                >
                  {isMobileMenuOpen ? (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                    </svg>
                  )}
                </motion.div>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Navigation Menu - The Glass Veil */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[60] bg-stone-900/90 backdrop-blur-xl md:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          >
            <motion.nav
              variants={containerVariants}
              initial="hidden"
              animate="show"
              exit="exit"
              className="h-full flex flex-col items-center justify-center px-6"
              onClick={(e) => e.stopPropagation()}
            >
              {mobileNavLinks.map((link) => (
                <motion.div
                  key={link.label}
                  variants={itemVariants}
                  className="mb-6"
                >
                  {link.isModal ? (
                    <button
                      onClick={() => handleMobileLinkClick(link)}
                      className="font-['Playfair_Display'] text-4xl text-[#F1ECE2] hover:text-white transition-colors duration-200 touch-manipulation"
                    >
                      {link.label}
                    </button>
                  ) : (
                    <Link
                      to={link.to}
                      onClick={() => handleMobileLinkClick(link)}
                      className="font-['Playfair_Display'] text-4xl text-[#F1ECE2] hover:text-white transition-colors duration-200 touch-manipulation block"
                    >
                      {link.label}
                    </Link>
                  )}
                </motion.div>
              ))}
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default Header;
