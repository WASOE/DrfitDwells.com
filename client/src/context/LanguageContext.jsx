import { createContext, useContext, useEffect, useState } from 'react';
import i18n from '../i18n/i18n';

const LanguageContext = createContext({
  language: 'en',
  setLanguage: () => {}
});

export const LanguageProvider = ({ children }) => {
  const [language, setLanguageState] = useState(i18n.language || 'en');

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('dd_language') : null;
    if (saved && (saved === 'en' || saved === 'bg')) {
      i18n.changeLanguage(saved);
      setLanguageState(saved);
    }
  }, []);

  const setLanguage = (lng) => {
    if (lng !== 'en' && lng !== 'bg') return;
    i18n.changeLanguage(lng);
    setLanguageState(lng);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('dd_language', lng);
    }
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);

