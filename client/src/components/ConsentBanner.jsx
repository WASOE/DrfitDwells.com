import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { applyConsentToTags, readConsentChoice, writeConsentChoice } from '../tracking/consent';
import { loadGtmOnce, loadMetaPixelOnce, loadGoogleAdsGtagOnce } from '../tracking/tagLoader';
import { localizePath } from '../utils/localizedRoutes';

/**
 * Minimal EEA-friendly consent: optional analytics + ads before GTM / Meta load.
 */
export default function ConsentBanner() {
  const location = useLocation();
  const lang = location.pathname === '/bg' || location.pathname.startsWith('/bg/') ? 'bg' : 'en';
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(!readConsentChoice());
  }, []);

  const choose = (choice) => {
    writeConsentChoice(choice);
    applyConsentToTags(choice, {
      loadGtm: loadGtmOnce,
      loadMetaPixel: loadMetaPixelOnce,
      loadGoogleAdsGtag: loadGoogleAdsGtagOnce
    });
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[100] border-t border-stone-200 bg-[#F9F8F6]/95 backdrop-blur-md px-4 py-4 md:py-5 shadow-[0_-8px_30px_rgba(0,0,0,0.08)]"
      role="dialog"
      aria-label="Cookie and privacy choices"
    >
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <p className="text-sm text-stone-700 max-w-3xl leading-relaxed">
          We use optional analytics and marketing cookies to measure visits and improve ads. You can change your mind anytime.
          See our{' '}
          <Link to={localizePath('/privacy', lang)} className="underline text-stone-900 font-medium">
            Privacy Policy
          </Link>
          .
        </p>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 shrink-0">
          <button
            type="button"
            className="px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] border border-stone-300 text-stone-800 hover:bg-stone-100 transition-colors"
            onClick={() => choose({ analytics: false, ads: false })}
          >
            Decline optional
          </button>
          <button
            type="button"
            className="px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] bg-[#1c1917] text-[#F8F5EF] hover:bg-stone-800 transition-colors"
            onClick={() => choose({ analytics: true, ads: true })}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
