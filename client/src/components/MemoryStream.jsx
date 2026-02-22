import { useRef, useEffect, useState } from "react";
import { motion } from "framer-motion";

// Use your actual image paths here
const photos = [
  { src: "/uploads/Content%20website/drift-dwells-bulgaria-lake-dawn.png", caption: "Lake Dawn" },
  { src: "/uploads/Content%20website/drift-dwells-bulgaria-fern-study.png", caption: "Fern Study" },
  { src: "/uploads/Content%20website/drift-dwells-bulgaria-pine-sketch.png", caption: "Pine Sketch" },
  { src: "/uploads/Content%20website/drift-dwells-bulgaria-valley-haven.avif", caption: "Valley Fog" },
  { src: "/uploads/Content%20website/drift-dwells-bulgaria-cabin-path.png", caption: "Cabin Path" },
  { src: "/uploads/Content%20website/drift-dwells-bulgaria-rainy-eaves.avif", caption: "Rain Hymns" },
];

export default function MemoryStream() {
  const [width, setWidth] = useState(0);
  const carousel = useRef();

  useEffect(() => {
    if (!carousel.current) return;
    setWidth(carousel.current.scrollWidth - carousel.current.offsetWidth);
  }, []);

  return (
    <section className="py-12 md:py-24 bg-[#f4f2ed] overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="text-center mb-12 md:mb-16">
          <h2 className="font-serif text-4xl md:text-5xl text-stone-900 mb-4">
            Slide through the archive
          </h2>
          <p className="text-sm md:text-xl text-stone-400 font-light italic mt-2">
            Drag to feel each chapter breathe.
          </p>
        </div>
      </div>

      {/* Mobile: Horizontal Scroll Container */}
      <div className="md:hidden flex overflow-x-auto snap-x snap-mandatory scrollbar-hide gap-4 px-4">
        {photos.map((photo, index) => (
          <div
            key={index}
            className="relative shrink-0 snap-center w-[280px]"
          >
            <div className="relative aspect-[4/5] overflow-hidden rounded-xl group">
              <img 
                src={photo.src} 
                alt={photo.caption} 
                className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105" 
                loading="lazy"
                decoding="async"
              />
              {/* Caption overlay with stronger gradient scrim */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/60 to-black/20 pt-20 pb-5 px-5">
                <p className="text-white text-sm uppercase tracking-[0.15em] font-light">
                  {photo.caption}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: The Carousel Container with Bleed Effect */}
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
          {photos.map((photo, index) => (
            <motion.div
              key={index}
              className="relative shrink-0 w-[400px] md:w-[450px]"
              whileHover={{ scale: 1.02, zIndex: 10 }}
              transition={{ duration: 0.3 }}
            >
              <div className="relative aspect-[4/5] overflow-hidden rounded-xl group">
                <img 
                  src={photo.src} 
                  alt={photo.caption} 
                  className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105" 
                  loading="lazy"
                  decoding="async"
                />
                {/* Caption overlay with stronger gradient scrim */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/65 to-black/25 pt-24 pb-6 px-6">
                  <p className="text-white text-sm md:text-base uppercase tracking-[0.2em] font-light">
                    {photo.caption}
                  </p>
                </div>
                {/* Subtle hover overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300" />
              </div>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </section>
  );
}
