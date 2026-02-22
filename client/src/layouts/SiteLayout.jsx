import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import Header from "../components/Header";
import Footer from "../components/Footer";
import AudioPlayer from "../components/AudioPlayer";
import BookingModal from "../components/BookingModal";
import AnnouncementBar from "../components/AnnouncementBar";

export default function  SiteLayout() {
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <div className="relative overflow-x-hidden">
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-5 mix-blend-soft-light"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")"
        }}
      />
      <div className="relative z-10">
        <Header />
        <Outlet />
        {!isHome && <Footer />}
        <AudioPlayer />
        <BookingModal />
        <AnnouncementBar />
      </div>
    </div>
  );
}
