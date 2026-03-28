import { useRef, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";

/** Order matches imageMetadata: cabin / Rhodopes scenes (valley-haven asset is cabin interior). */
const PHOTOS = [
  { src: "/uploads/Content%20website/drift-dwells-bulgaria-lake-dawn.png", key: "lakeDawn" },
  { src: "/uploads/Content%20website/drift-dwells-bulgaria-fern-study.png", key: "fernRhodopes" },
  { src: "/uploads/Content%20website/drift-dwells-bulgaria-pine-sketch.png", key: "pineSketch" },
  { src: "/uploads/Content%20website/drift-dwells-bulgaria-valley-haven.avif", key: "cabinInterior" },
  { src: "/uploads/Content%20website/drift-dwells-bulgaria-cabin-path.png", key: "forestPath" },
  { src: "/uploads/Content%20website/drift-dwells-bulgaria-rainy-eaves.avif", key: "rainEaves" },
];

export default function MemoryStream() {
  const { t } = useTranslation("home");
  const [width, setWidth] = useState(0);
  const carousel = useRef();
  const sectionRef = useRef(null);
  const [mountGallery, setMountGallery] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setMountGallery(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px 0px', threshold: 0.01 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!carousel.current) return;
    setWidth(carousel.current.scrollWidth - carousel.current.offsetWidth);
  }, [mountGallery]);

  return (
    <section ref={sectionRef} className="py-12 md:py-24 bg-[#f4f2ed] overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="text-center mb-12 md:mb-16">
          <h2 className="font-serif text-4xl md:text-5xl text-stone-900 mb-4">
            {t("memory.title")}
          </h2>
          <p className="text-sm md:text-xl text-stone-400 font-light italic mt-2">
            {t("memory.subtitle")}
          </p>
        </div>
      </div>

      {!mountGallery ? (
        <div
          className="min-h-[280px] md:min-h-[360px] mx-4 md:mx-8 rounded-xl bg-[#ebe8e2]"
          aria-hidden
        />
      ) : null}

      {/* Mobile: Horizontal Scroll Container */}
      {mountGallery ? (
      <div className="md:hidden flex overflow-x-auto snap-x snap-mandatory scrollbar-hide gap-4 px-4">
        {PHOTOS.map((photo) => {
          const caption = t(`memory.photos.${photo.key}`);
          return (
            <div
              key={photo.src}
              className="relative shrink-0 snap-center w-[280px]"
            >
              <div className="relative aspect-[4/5] overflow-hidden rounded-xl group">
                <img
                  src={photo.src}
                  alt={caption}
                  className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                  loading="lazy"
                  decoding="async"
                />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/60 to-black/20 pt-20 pb-5 px-5">
                <p className="text-white text-sm uppercase tracking-[0.15em] font-light">
                  {caption}
                </p>
              </div>
            </div>
          </div>
          );
        })}
      </div>
      ) : null}

      {/* Desktop: The Carousel Container with Bleed Effect */}
      {mountGallery ? (
      <motion.div 
        ref={carousel} 
        className="hidden md:block cursor-grab active:cursor-grabbing overflow-hidden w-full pl-8 md:pl-12 lg:pl-16"
        whileTap={{ cursor: "grabbing" }}
        onMouseEnter={() => window.dispatchEvent(new Event('cursor-drag-on'))}
        onMouseLeave={() => window.dispatchEvent(new Event('cursor-drag-off'))}
      >
        <motion.div
          drag="x"
          dragConstraints={{ right: 0, left: -width }}
          className="flex gap-4 w-fit pr-8 md:pr-12 lg:pr-16"
        >
          {PHOTOS.map((photo) => {
            const caption = t(`memory.photos.${photo.key}`);
            return (
            <motion.div
              key={photo.src}
              className="relative shrink-0 w-[400px] md:w-[450px]"
              whileHover={{ scale: 1.02, zIndex: 10 }}
              transition={{ duration: 0.3 }}
            >
              <div className="relative aspect-[4/5] overflow-hidden rounded-xl group">
                <img 
                  src={photo.src} 
                  alt={caption} 
                  className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105" 
                  loading="lazy"
                  decoding="async"
                />
                {/* Caption overlay with stronger gradient scrim */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/65 to-black/25 pt-24 pb-6 px-6">
                  <p className="text-white text-sm md:text-base uppercase tracking-[0.2em] font-light">
                    {caption}
                  </p>
                </div>
                {/* Subtle hover overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300" />
              </div>
            </motion.div>
          );
          })}
        </motion.div>
      </motion.div>
      ) : null}
    </section>
  );
}
