import { createContext, useContext, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import i18n from '../i18n/i18n';
import { getLanguageFromPath, localizePath } from '../utils/localizedRoutes';

const LanguageContext = createContext({
  language: 'en',
  setLanguage: () => {}
});

export const LanguageProvider = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [language, setLanguageState] = useState(getLanguageFromPath(location.pathname));

  useEffect(() => {
    const nextLanguage = getLanguageFromPath(location.pathname);

    if (i18n.language !== nextLanguage) {
      i18n.changeLanguage(nextLanguage);
    }

    setLanguageState(nextLanguage);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem('dd_language', nextLanguage);
    }
  }, [location.pathname]);

  const setLanguage = (lng) => {
    if (lng !== 'en' && lng !== 'bg') return;

    const nextPath = `${localizePath(location.pathname, lng)}${location.search}${location.hash}`;

    i18n.changeLanguage(lng);
    setLanguageState(lng);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem('dd_language', lng);
    }

    if (nextPath !== `${location.pathname}${location.search}${location.hash}`) {
      navigate(nextPath);
    }
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);

