import { useRef, useEffect, useState } from "react";
import { motion } from "framer-motion";

// Use your actual image paths here
const photos = [
  { src: "/uploads/Content%20website/drift-dwells-bulgaria-lake-dawn.png", caption: "Lake Dawn", rotate: 2 },
  { src: "/uploads/Content%20website/drift-dwells-bulgaria-fern-study.png", caption: "Fern Study", rotate: -1 },
  { src: "/uploads/Content%20website/drift-dwells-bulgaria-pine-sketch.png", caption: "Pine Sketch", rotate: 1.5 },
  { src: "/uploads/Content%20website/drift-dwells-bulgaria-valley-haven.avif", caption: "Valley Fog", rotate: -2 },
  { src: "/uploads/Content%20website/drift-dwells-bulgaria-cabin-path.png", caption: "Cabin Path", rotate: 1 },
  { src: "/uploads/Content%20website/drift-dwells-bulgaria-rainy-eaves.avif", caption: "Rain Hymns", rotate: -1.5 },
];

export default function MemoryStream() {
  const [width, setWidth] = useState(0);
  const carousel = useRef();

  useEffect(() => {
    if (!carousel.current) return;
    setWidth(carousel.current.scrollWidth - carousel.current.offsetWidth);
  }, []);

  return (
    <section className="py-24 bg-[#f4f2ed] overflow-hidden">
      <div className="text-center mb-12">
        <h2 className="font-serif text-4xl md:text-5xl text-stone-900 mb-4">
          Slide through the archive
        </h2>
        <p className="font-script text-2xl text-stone-500">
          Drag to feel each chapter breathe.
        </p>
      </div>

      {/* The Carousel Container */}
      <motion.div 
        ref={carousel} 
        className="cursor-grab active:cursor-grabbing overflow-hidden pl-8 md:pl-32"
        whileTap={{ cursor: "grabbing" }}
        onMouseEnter={() => window.dispatchEvent(new Event('cursor-drag-on'))}
        onMouseLeave={() => window.dispatchEvent(new Event('cursor-drag-off'))}
      >
        <motion.div
          drag="x"
          dragConstraints={{ right: 0, left: -width }}
          className="flex gap-8 md:gap-12 w-fit pb-12 pr-12"
        >
          {photos.map((photo, index) => (
            <motion.div
              key={index}
              className="relative shrink-0"
              whileHover={{ scale: 1.05, rotate: 0, zIndex: 10 }}
              transition={{ duration: 0.3 }}
            >
              <div 
                className={`bg-white p-3 pb-8 shadow-lg w-[280px] md:w-[350px] transform ${
                  `rotate-[${photo.rotate}deg]`
                }`}
                style={{ rotate: `${photo.rotate}deg` }}
              >
                <div className="aspect-[4/5] bg-stone-200 overflow-hidden mb-4 grayscale hover:grayscale-0 transition-all duration-700 ease-in-out">
                  <img 
                    src={photo.src} 
                    alt={photo.caption} 
                    className="w-full h-full object-cover pointer-events-none" 
                  />
                </div>
                <p className="font-handwriting text-stone-800 text-xl text-center opacity-80">
                  {photo.caption}
                </p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </section>
  );
}

