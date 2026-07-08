import { useEffect, useState } from 'react';
import { CONSENT_UPDATED_EVENT, readConsentChoice } from '../tracking/consent';

/** True while the cookie consent banner should be shown (no saved choice yet). */
export function useConsentBannerOpen() {
  const [open, setOpen] = useState(() => !readConsentChoice());

  useEffect(() => {
    const sync = () => setOpen(!readConsentChoice());
    window.addEventListener(CONSENT_UPDATED_EVENT, sync);
    return () => window.removeEventListener(CONSENT_UPDATED_EVENT, sync);
  }, []);

  return open;
}
