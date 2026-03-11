/**
 * Lazy-loaded chat widget trigger.
 * Valley design system: Montserrat, sage, editorial.
 * Derives propertyContext from current route for property-scoped FAQ retrieval.
 * Uses useFloatingSafeArea to avoid overlapping sticky booking bar.
 */

import { useState, lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { useFloatingSafeArea } from '../hooks/useFloatingSafeArea';

const ChatWidget = lazy(() => import('./ChatWidget'));

/** Derive property context from path: cabin, valley, or null (both/ambiguous) */
function getPropertyContextFromPath(pathname) {
  if (!pathname) return null;
  const p = pathname.toLowerCase();
  if (p.includes('/cabin')) return 'cabin';
  if (p.includes('/valley')) return 'valley';
  return null;
}

export default function ChatWidgetLazy() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const propertyContext = getPropertyContextFromPath(location.pathname);
  const { bottomOffset } = useFloatingSafeArea();

  return (
    <>
      {/* Floating trigger — refined, minimal; positioned above sticky bar via safe area */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-6 md:right-8 z-[9997] w-12 h-12 rounded-full flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A]/40 focus-visible:ring-offset-2 transition-all duration-200 bg-white/95 border border-black/[0.08] text-sage shadow-[0_4px_20px_rgba(0,0,0,0.08)] hover:bg-sage/10 hover:shadow-[0_6px_24px_rgba(129,136,122,0.15)]"
          style={{ bottom: `${bottomOffset}px` }}
          aria-label="Ask Drift & Dwells"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </button>
      )}

      {/* Chat panel — loaded only on first click */}
      {open && (
        <Suspense fallback={null}>
          <ChatWidget onClose={() => setOpen(false)} propertyContext={propertyContext} />
        </Suspense>
      )}
    </>
  );
}
