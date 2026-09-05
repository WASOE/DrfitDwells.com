import { motion } from 'framer-motion';
import { useState, useRef, useEffect, useMemo } from 'react';
import { useBookingSearch } from '../../../context/BookingSearchContext';
import { useSeason } from '../../../context/SeasonContext';
import { getSEOAlt } from '../../../data/imageMetadata';
import { VALLEY_PAGE_SEASON_IMAGES } from '../data';

const VibeSection = ({ galleryRef }) => {
  const { openModal } = useBookingSearch();
  const { season } = useSeason();
  const seasonKey = season === 'winter' ? 'winter' : 'summer';

  const [sliderPosition, setSliderPosition] = useState(seasonKey === 'winter' ? 72 : 50);
  const [isDragging, setIsDragging] = useState(false);
  const sliderRef = useRef(null);

  const summerImage = VALLEY_PAGE_SEASON_IMAGES.vibeCompare.summer;
  const winterImage = VALLEY_PAGE_SEASON_IMAGES.vibeCompare.winter;

  const imageMoments = useMemo(
    () => VALLEY_PAGE_SEASON_IMAGES.vibeMoments[seasonKey],
    [seasonKey]
  );

  // Bias the compare slider toward the active season when the toggle changes.
  useEffect(() => {
    setSliderPosition(seasonKey === 'winter' ? 72 : 28);
  }, [seasonKey]);

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
              key={`${seasonKey}-${item.image.path}`}
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
