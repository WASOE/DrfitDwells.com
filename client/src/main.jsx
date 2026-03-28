import { installConsentDefaults } from './tracking/consent.js';
installConsentDefaults();

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/600.css';
import '@fontsource/playfair-display/700.css';
import './index.css';
import { BookingSearchProvider } from './context/BookingSearchContext.jsx';
import { LanguageProvider } from './context/LanguageContext.jsx';
import { SeasonProvider } from './context/SeasonContext.jsx';
import './i18n/i18nCore.js';
import { initWebVitals } from './tracking/webVitals.js';

const scheduleWebVitals = () => initWebVitals();
if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
  window.requestIdleCallback(scheduleWebVitals, { timeout: 4000 });
} else if (typeof window !== 'undefined') {
  window.setTimeout(scheduleWebVitals, 0);
}

const scheduleSwRegister = () => {
  import('virtual:pwa-register')
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => {});
};
if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
  window.requestIdleCallback(scheduleSwRegister, { timeout: 8000 });
} else if (typeof window !== 'undefined') {
  window.setTimeout(scheduleSwRegister, 4000);
}

const scheduleDeferredCss = () => {
  import('./index-deferred.css').catch(() => {});
};
if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
  window.requestIdleCallback(scheduleDeferredCss, { timeout: 2500 });
} else if (typeof window !== 'undefined') {
  window.setTimeout(scheduleDeferredCss, 0);
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HelmetProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <LanguageProvider>
            <SeasonProvider>
              <BookingSearchProvider>
                <App />
              </BookingSearchProvider>
            </SeasonProvider>
          </LanguageProvider>
        </BrowserRouter>
      </HelmetProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
