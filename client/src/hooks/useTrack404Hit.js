import { useEffect } from 'react';

const eventName = 'dd_404_hit';

export default function useTrack404Hit(pathname) {
  useEffect(() => {
    const payload = {
      pathname,
      referrer: document.referrer || '',
      timestamp: new Date().toISOString()
    };

    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: eventName, ...payload });
    }

    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, {
        page_path: payload.pathname,
        page_referrer: payload.referrer
      });
    }

    if (import.meta.env.DEV) {
      // Keep a lightweight signal for local QA when analytics is unavailable.
      console.info('[404-tracking]', payload);
    }
  }, [pathname]);
}
