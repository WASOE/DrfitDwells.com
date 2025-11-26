import React from "react";
import { Outlet } from "react-router-dom";
import Header from "../components/Header";
import Footer from "../components/Footer";
import AudioPlayer from "../components/AudioPlayer";

export default function  SiteLayout() {
  return (
    <div className="relative">
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
        <Footer />
        <AudioPlayer />
      </div>
    </div>
  );
}

