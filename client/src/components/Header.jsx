import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useBookingSearch } from '../context/BookingSearchContext';
import { useLanguage } from '../context/LanguageContext.jsx';

const Header = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const location = useLocation();
  const { t } = useTranslation('nav');
  const { language, setLanguage } = useLanguage();
  const { openModal } = useBookingSearch();
  const isHeroOverlay = location.pathname === '/' || location.pathname === '/cabin' || location.pathname === '/valley';

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
    { to: '/', label: t('home') },
    { to: '/cabin', label: t('cabin') },
    { to: '/valley', label: t('valley') },
    { to: '/about', label: t('about') },
    { to: '/build', label: t('build') }
  ];

  // Mobile navigation links (including Search)
  const mobileNavLinks = [
    { to: '/', label: t('home'), isModal: false },
    { to: '/cabin', label: t('cabin'), isModal: false },
    { to: '/valley', label: t('valley'), isModal: false },
    { to: '/about', label: t('about'), isModal: false },
    { to: '/build', label: t('build'), isModal: false },
    { to: null, label: t('search'), isModal: true }
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

  // Link text colors based on theme (minimalist text, no pills)
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
                  <img 
                    src="/uploads/Logo/DRIFTS-ai.png" 
                    alt="Drift & Dwells" 
                    className="h-8 sm:h-10 w-auto transition-opacity duration-300"
                    style={{ filter: 'contrast(1.1) brightness(0.95)' }}
                  />
                ) : (
                  <img 
                    src="/uploads/Logo/Drift-Dwell-white.png" 
                    alt="Drift & Dwells" 
                    className="h-8 sm:h-10 w-auto transition-opacity duration-300 drop-shadow-md"
                  />
                )}
              </Link>
            </div>

            {/* Zone 2: The Console (Center) - Minimalist text links */}
            <nav className="hidden md:flex items-center gap-8 lg:gap-10 transition-all duration-300 whitespace-nowrap">
              {navLinks.map((link) => {
                const active = isActive(link.to);
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={`
                      text-[11px] md:text-xs font-medium uppercase tracking-[0.2em] transition-colors duration-200 ${linkTextClasses}
                      ${active ? 'opacity-100' : useDarkTheme ? 'opacity-70 hover:opacity-100' : 'opacity-80 hover:opacity-100'}
                    `}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>

            {/* Zone 3: The Action (Right) */}
            <div className="hidden md:flex items-center flex-shrink-0 ml-4 lg:ml-6 gap-2">
              {/* Language toggle */}
              <div className="flex items-center gap-1 text-[11px] uppercase tracking-[0.2em]">
                <button
                  type="button"
                  onClick={() => setLanguage('en')}
                  className={`px-2 py-1 rounded-full ${
                    language === 'en'
                      ? 'bg-stone-900 text-[#F1ECE2]'
                      : 'bg-transparent text-stone-500'
                  }`}
                >
                  {t('language.en')}
                </button>
                <button
                  type="button"
                  onClick={() => setLanguage('bg')}
                  className={`px-1.5 py-0.5 rounded-full ${
                    language === 'bg'
                      ? 'bg-stone-900 text-[#F1ECE2]'
                      : 'bg-transparent text-stone-500'
                  }`}
                >
                  {t('language.bg')}
                </button>
              </div>
              <button
                onClick={openModal}
                className="bg-[#F1ECE2] text-stone-900 px-5 py-2.5 rounded-full font-bold uppercase tracking-[0.3em] text-xs hover:scale-105 transition-transform shadow-md active:scale-95 min-h-[2.5rem] flex items-center justify-center"
              >
                {t('book')}
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
