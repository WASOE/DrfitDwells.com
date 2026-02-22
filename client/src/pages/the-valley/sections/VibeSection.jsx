import { motion } from 'framer-motion';
import { useState, useRef, useEffect } from 'react';
import { useBookingSearch } from '../../../context/BookingSearchContext';
import { getSEOAlt } from '../../../data/imageMetadata';

const VibeSection = ({ galleryRef }) => {
  const { openModal } = useBookingSearch();
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const sliderRef = useRef(null);

  // Lead images - seasonal comparison
  const summerImage = {
    path: '/uploads/The Valley/1768207815-2996ea84.jpg',
    encoded: '/uploads/The%20Valley/1768207815-2996ea84.jpg',
    alt: 'Panoramic summer view of The Valley mountain village at 1,550m altitude showing A-frame cabins, Stone House, and shared spaces, Rhodope Mountains, Bulgaria'
  };

  const winterImage = {
    path: '/uploads/The Valley/1768208001-196d2a1f.jpg',
    encoded: '/uploads/The%20Valley/1768208001-196d2a1f.jpg',
    alt: 'Panoramic winter view of The Valley mountain village at 1,550m altitude showing snow-covered A-frame cabins, Stone House, and shared spaces, Rhodope Mountains, Bulgaria'
  };

  // Handle mouse/touch events for slider
  const handleMove = (clientX) => {
    if (!sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percentage);
  };

  const handleMouseDown = (e) => {
    setIsDragging(true);
    handleMove(e.clientX);
  };

  const handleMouseMove = (e) => {
    if (isDragging) {
      handleMove(e.clientX);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('touchmove', (e) => {
        if (e.touches[0]) handleMove(e.touches[0].clientX);
      });
      document.addEventListener('touchend', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.removeEventListener('touchmove', handleMove);
        document.removeEventListener('touchend', handleMouseUp);
      };
    }
  }, [isDragging]);

  // Image-anchored moments (Pattern A: each image has its moment below)
  // Matched to metadata for precise categorization
  const imageMoments = [
    {
      // Firepit: New fireplace image showing evening gathering
      image: {
        path: '/uploads/The Valley/-03e7a985-8967-4a35-9169-36206d128506.png',
        encoded: '/uploads/The%20Valley/-03e7a985-8967-4a35-9169-36206d128506.png',
        alt: 'Communal fireplace evening gathering at The Valley showing glowing fire and warm atmosphere at 1,550m altitude, Rhodope Mountains, Bulgaria',
        ratio: '4/5'
      },
      moment: 'Evenings by the communal firepit'
    },
    {
      // Morning coffee: Couple with mugs on porch bench (A-Frame)
      image: {
        path: '/uploads/The Valley/WhatsApp Image 2025-12-03 at 4.36.14 PM.jpeg',
        encoded: '/uploads/The%20Valley/WhatsApp%20Image%202025-12-03%20at%204.36.14%20PM.jpeg',
        alt: 'Couple enjoying front of A-frame cabin at The Valley with mountain forest backdrop at 1,550m altitude, Rhodope Mountains, Bulgaria',
        ratio: '4/5'
      },
      moment: 'Morning coffee on the porch with mountain views'
    },
    {
      // Reading: Person reading in nature
      image: {
        path: '/uploads/The Valley/Lux-cabin-exterior-1768207498-98737209.jpg',
        encoded: '/uploads/The%20Valley/Lux-cabin-exterior-1768207498-98737209.jpg',
        alt: 'Person reading in nature at The Valley showing outdoor reading space and natural setting at 1,550m altitude, Rhodope Mountains, Bulgaria',
        ratio: '4/5'
      },
      moment: 'Quiet reading in nature'
    },
    {
      // Sunrise window: Person looking out window at sunrise/sunset
      image: {
        path: '/uploads/The Valley/Lux-cabin-WhatsApp Image 2026-01-11 at 11.43.42 AM (1).jpeg',
        encoded: '/uploads/The%20Valley/Lux-cabin-WhatsApp%20Image%202026-01-11%20at%2011.43.42%20AM%20%281%29.jpeg',
        alt: 'Luxury cabin interior with sunset window view at The Valley showing person looking out at golden hour, 1,550m altitude, Rhodope Mountains, Bulgaria',
        ratio: '4/5'
      },
      moment: 'Sunrise from your cabin window'
    },
    {
      // Stargazing: Starry night landscape
      image: {
        path: '/uploads/Content website/drift-dwells-bulgaria-starlit-mountain.avif',
        encoded: '/uploads/Content%20website/drift-dwells-bulgaria-starlit-mountain.avif',
        alt: 'Starry night sky over The Valley showing mountains, starry sky, and night landscape at 1,550m altitude, Rhodope Mountains, Bulgaria',
        ratio: '4/5'
      },
      moment: 'Hot tub under the stars'
    },
    {
      // ATV: Actual ATV vehicles in mountain landscape
      image: {
        path: '/uploads/The Valley/WhatsApp Image 2026-01-11 at 11.43.40 AM.jpeg',
        encoded: '/uploads/The%20Valley/WhatsApp%20Image%202026-01-11%20at%2011.43.40%20AM.jpeg',
        alt: 'ATVs in mountain landscape at The Valley showing red vehicles and mountain views at 1,550m altitude, Rhodope Mountains, Bulgaria',
        ratio: '4/5'
      },
      moment: 'ATV adventures through mountain trails'
    }
  ];

  return (
    <section 
      ref={galleryRef}
      className="valley-section"
    >
      <div className="valley-container">
        {/* Section Title */}
        <h2 className="font-['Montserrat'] text-[#1a1a1a] mb-5 vibe-section-title" style={{ fontSize: '48px', fontWeight: 800 }}>
          <style>{`
            @media (max-width: 768px) {
              .vibe-section-title {
                font-size: 34px !important;
              }
            }
          `}</style>
          The Vibe
        </h2>

        {/* Large Statement Sentence */}
        <p className="font-['Montserrat'] text-[#1a1a1a] mb-8 max-w-[28ch] vibe-statement" style={{ fontSize: '28px', fontWeight: 700, lineHeight: '1.2' }}>
          <style>{`
            @media (max-width: 768px) {
              .vibe-statement {
                font-size: 22px !important;
              }
            }
          `}</style>
          Unstructured days. Hike, read, cook, sit by the fire.
        </p>

        {/* Seasonal Comparison Image (Full Width) with Caption */}
        <div className="mb-12">
          <div 
            ref={sliderRef}
            className="relative w-full rounded-xl overflow-hidden cursor-col-resize select-none"
            style={{ aspectRatio: '21 / 9', backgroundColor: '#e8e8e8' }}
            onMouseDown={handleMouseDown}
            onTouchStart={(e) => {
              if (e.touches[0]) {
                setIsDragging(true);
                handleMove(e.touches[0].clientX);
              }
            }}
          >
            {/* Summer Image (Background) */}
            <div 
              className="absolute inset-0 bg-cover bg-center"
              style={{
                backgroundImage: `url(${summerImage.encoded})`,
              }}
              role="img"
              aria-label={getSEOAlt(summerImage.path) || summerImage.alt}
            />
            
            {/* Winter Image (Clipped) */}
            <div 
              className="absolute inset-0 bg-cover bg-center"
              style={{
                backgroundImage: `url(${winterImage.encoded})`,
                clipPath: `inset(0 ${100 - sliderPosition}% 0 0)`,
              }}
              role="img"
              aria-label={getSEOAlt(winterImage.path) || winterImage.alt}
            />
            
            {/* Slider Handle */}
            <div
              className="absolute top-0 bottom-0 w-1 bg-white shadow-lg cursor-col-resize z-10"
              style={{
                left: `${sliderPosition}%`,
                transform: 'translateX(-50%)',
              }}
            >
              {/* Handle Circle */}
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center border-2 border-gray-200">
                <div className="flex gap-1">
                  <svg className="w-3 h-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  <svg className="w-3 h-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>
            
            {/* Season Labels */}
            <div className="absolute bottom-4 left-4 bg-black/60 text-white px-3 py-1.5 rounded-md text-xs font-medium backdrop-blur-sm">
              Summer
            </div>
            <div className="absolute bottom-4 right-4 bg-black/60 text-white px-3 py-1.5 rounded-md text-xs font-medium backdrop-blur-sm">
              Winter
            </div>
            
            <div className="absolute inset-0 bg-black/5 pointer-events-none" />
          </div>
          <p className="valley-caption mt-3 text-left">
            The Valley at 1,550m altitude, a mountain village where each stay is private but the land is shared. Drag to compare seasons.
          </p>
        </div>

        {/* Image-Anchored Moments Grid (Pattern A) */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6" style={{ marginTop: '32px' }}>
          {imageMoments.map((item, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="flex flex-col"
            >
              {/* Image */}
              <div 
                className="relative w-full mb-2 rounded-xl overflow-hidden cursor-pointer"
                style={{ 
                  aspectRatio: item.image.ratio,
                  backgroundColor: '#e8e8e8'
                }}
                onClick={openModal}
              >
                <div 
                  className="absolute inset-0 bg-cover bg-center transition-transform duration-700 hover:scale-105"
                  style={{
                    backgroundImage: `url(${item.image.encoded})`,
                  }}
                  role="img"
                  aria-label={getSEOAlt(item.image.path) || item.image.alt}
                />
                <div className="absolute inset-0 bg-black/5" />
              </div>
              
              {/* Moment Text - Directly Below Image */}
              <h3 className="font-['Montserrat'] text-[#1a1a1a] text-center" style={{ fontSize: '15px', fontWeight: 400 }}>
                {item.moment}
              </h3>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default VibeSection;
