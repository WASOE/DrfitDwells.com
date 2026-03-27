import React, { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Header from "../components/Header";
import Footer from "../components/Footer";
import AudioPlayer from "../components/AudioPlayer";
import BookingModal from "../components/BookingModal";
import AnnouncementBar from "../components/AnnouncementBar";
import ChatWidgetLazy from "../components/ChatWidgetLazy";
import ConsentBanner from "../components/ConsentBanner";
import { stripLocaleFromPath } from "../utils/localizedRoutes";
import { useFloatingSafeArea } from "../hooks/useFloatingSafeArea";
import { captureAttributionFromUrl } from "../tracking/attribution";

/** Routes where the first section is a full-bleed hero (content intentionally under the nav). No top padding. */
const HERO_PATHS = ['/', '/cabin', '/valley'];

export default function SiteLayout() {
  const location = useLocation();
  const { bottomOffset } = useFloatingSafeArea();

  // Sync CSS variable for components that use raw CSS (e.g. var(--floating-bottom-offset))
  useEffect(() => {
    document.documentElement.style.setProperty('--floating-bottom-offset', `${bottomOffset}px`);
    return () => document.documentElement.style.removeProperty('--floating-bottom-offset');
  }, [bottomOffset]);

  useEffect(() => {
    captureAttributionFromUrl();
  }, []);
  const basePath = stripLocaleFromPath(location.pathname);
  const isHome = basePath === '/';
  const isGuidePage = basePath.startsWith('/guides/');
  const isHeroPage = HERO_PATHS.includes(basePath);

  return (
    <div className="relative overflow-x-hidden">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-white focus:px-4 focus:py-2 focus:rounded focus:shadow-lg focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-5 mix-blend-soft-light"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")"
        }}
      />
      <div className="relative z-10">
        <Header />
        <main
          id="main"
          style={isHeroPage ? undefined : { paddingTop: 'var(--header-offset)' }}
          className={isHeroPage ? '' : 'min-h-0'}
        >
          <Outlet />
        </main>
        {!isHome && !isGuidePage && <Footer />}
        <AudioPlayer />
        <BookingModal />
        <AnnouncementBar />
        <ChatWidgetLazy />
        <ConsentBanner />
      </div>
    </div>
  );
}
