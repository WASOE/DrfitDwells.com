import { useEffect, useState } from 'react';
import AudioPlayer from './AudioPlayer';
import AnnouncementBar from './AnnouncementBar';
import ChatWidgetLazy from './ChatWidgetLazy';

/**
 * Defer non-blocking global UI until idle (home + search first paint).
 * Keeps booking modal + consent in SiteLayout so Book / GDPR still work immediately.
 */
export default function DeferredIdleSiteChrome() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) setReady(true);
    };
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(run, { timeout: 2000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(id);
      };
    }
    const t = window.setTimeout(run, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  if (!ready) return null;

  return (
    <>
      <AudioPlayer />
      <AnnouncementBar />
      <ChatWidgetLazy />
    </>
  );
}
