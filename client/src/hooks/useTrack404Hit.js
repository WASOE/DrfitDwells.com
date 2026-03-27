import { useEffect } from 'react';
import { readConsentChoice } from '../tracking/consent';

const eventName = 'dd_404_hit';

export default function useTrack404Hit(pathname) {
  useEffect(() => {
    const payload = {
      pathname,
      referrer: document.referrer || '',
      timestamp: new Date().toISOString()
    };

    if (import.meta.env.DEV) {
      console.info('[404-tracking]', payload);
    }

    const consent = readConsentChoice();
    if (!consent?.analytics) return;

    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: eventName, ...payload });
    }

    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, {
        page_path: payload.pathname,
        page_referrer: payload.referrer
      });
    }
  }, [pathname]);
}
