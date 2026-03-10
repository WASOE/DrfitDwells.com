import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import App from './App.jsx';
import './index.css';
import { BookingSearchProvider } from './context/BookingSearchContext.jsx';
import { LanguageProvider } from './context/LanguageContext.jsx';
import { SeasonProvider } from './context/SeasonContext.jsx';
import './i18n/i18n.js';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HelmetProvider>
      <LanguageProvider>
        <SeasonProvider>
          <BookingSearchProvider>
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <App />
            </BrowserRouter>
          </BookingSearchProvider>
        </SeasonProvider>
      </LanguageProvider>
    </HelmetProvider>
  </React.StrictMode>,
);
