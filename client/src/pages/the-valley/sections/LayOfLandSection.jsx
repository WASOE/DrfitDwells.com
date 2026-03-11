import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getSEOAlt, getSEOTitle } from '../../../data/imageMetadata';

const LayOfLandSection = ({ scrollToAccommodations }) => {
  const [hoveredHotspot, setHoveredHotspot] = useState(null);
  const [mapImageLoaded, setMapImageLoaded] = useState(false);
  const [mapImageError, setMapImageError] = useState(false);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [showImage, setShowImage] = useState(false);
  const [mapImageSize, setMapImageSize] = useState({ w: 0, h: 0 });
  const mapVideoRef = useRef(null);
  const svgRef = useRef(null);

  const MAP_PINS = [
    { id: 'drifters', x: 644, y: 804, label: 'The Drifters', subtitle: '13 Geometric Cocoons', tabId: 'drifters' },
    { id: 'swing', x: 1205, y: 60, label: 'Panoramic Swing', subtitle: 'Overlook the valley', tabId: null },
    { id: 'fire', x: 1679, y: 527, label: 'Fireplace', subtitle: 'Gather around the fire', tabId: null },
    { id: 'stone', x: 1701, y: 764, label: 'The Stone House', subtitle: 'Starlink & Community', tabId: 'stone' },
    { id: 'lux', x: 2353, y: 1360, label: 'Lux Cabin', subtitle: 'Secluded Vantage Point', tabId: 'lux' },
  ];

  const handleMapPinClick = (tabId) => {
    if (tabId) {
      setTimeout(() => {
        scrollToAccommodations?.();
      }, 100);
    }
  };

  const locationPills = [
    { title: 'Stone House', sleeps: 'up to 6', bestFor: 'families or small groups' },
    { title: 'A-Frames', sleeps: '2 per cabin', bestFor: 'solo travelers or couples' },
    { title: 'Luxury Cabin', sleeps: '2', bestFor: 'couples' }
  ];

  return (
    <section className="relative pt-32 md:pt-48 pb-40 md:pb-56 border-t border-white/5">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="text-center mb-20 md:mb-28">
          <h2 className="font-serif italic font-thin text-5xl md:text-7xl lg:text-8xl text-white mb-6">
            The Lay of the Land
          </h2>
        </div>

        {/* Aerial Image - Editorial Frame */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="relative w-full max-w-7xl mx-auto mb-16"
        >
          <div className="relative w-full rounded-2xl overflow-hidden">
            {/* Image dimensions: 2752 x 1536 pixels */}
            {mapImageSize.w === 0 && (
              <img
                src="/uploads/Content%20website/SKy-view-Aframe.jpg"
                alt={getSEOAlt('/uploads/Content website/SKy-view-Aframe.jpg') || 'Aerial drone view of The Valley showing multiple A-frame cabins, village layout, paths, and mountain landscape at 1,550m altitude, Rhodope Mountains, Bulgaria'}
                title={getSEOTitle('/uploads/Content website/SKy-view-Aframe.jpg') || 'Aerial View of The Valley - A-Frame Village Layout'}
                className="hidden"
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setMapImageSize({ w: img.naturalWidth, h: img.naturalHeight });
                  setMapImageLoaded(true);
                }}
                onError={(e) => {
                  const src = e.target.src;
                  const basePath = '/uploads/Content%20website/SKy-view-Aframe';
                  const extensions = ['.jpg', '.jpeg', '.png', '.avif', '.webp'];
                  const currentExt = extensions.find(ext => src.includes(ext)) || '.jpg';
                  const currentIndex = extensions.indexOf(currentExt);
                  
                  if (currentIndex < extensions.length - 1) {
                    e.target.src = basePath + extensions[currentIndex + 1];
                  } else {
                    setMapImageError(true);
                  }
                }}
              />
            )}
            
            {/* Video - Autoplay when available */}
            {!videoError && !showImage && (
              <video
                ref={mapVideoRef}
                src="/uploads/Videos/The-Valley-From-the-Sky.mp4"
                poster="/uploads/Content%20website/SKy-view-Aframe.jpg"
                className="w-full h-auto block"
                autoPlay
                muted
                playsInline
                onLoadedData={() => {
                  setVideoLoaded(true);
                }}
                onError={() => {
                  setVideoError(true);
                  setShowImage(true);
                }}
                onEnded={() => {
                  setShowImage(true);
                }}
              />
            )}
            
            {/* Single SVG with embedded image and pins */}
            {mapImageSize.w > 0 && mapImageSize.h > 0 && (showImage || !videoLoaded || videoError) && !mapImageError && (
              <svg
                ref={svgRef}
                viewBox={`0 0 ${mapImageSize.w} ${mapImageSize.h}`}
                className="w-full h-auto block"
                preserveAspectRatio="xMidYMid meet"
              >
                <image
                  href="/uploads/Content%20website/SKy-view-Aframe.jpg"
                  x="0"
                  y="0"
                  width={mapImageSize.w}
                  height={mapImageSize.h}
                  preserveAspectRatio="none"
                />
                
                {/* Interactive Pins */}
                {MAP_PINS.map((pin) => (
                  <g 
                    key={pin.id}
                    className="hidden md:block cursor-pointer"
                    onMouseEnter={() => setHoveredHotspot(pin.id)}
                    onMouseLeave={() => setHoveredHotspot(null)}
                    onClick={() => {
                      if (pin.tabId) {
                        handleMapPinClick(pin.tabId);
                      }
                    }}
                  >
                    <circle
                      cx={pin.x}
                      cy={pin.y}
                      r="8"
                      fill="white"
                    />
                    <circle
                      cx={pin.x}
                      cy={pin.y}
                      r="8"
                      fill="white"
                      opacity="0.75"
                    >
                      <animate
                        attributeName="r"
                        values="8;16;8"
                        dur="2s"
                        repeatCount="indefinite"
                      />
                      <animate
                        attributeName="opacity"
                        values="0.75;0;0.75"
                        dur="2s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  </g>
                ))}
              </svg>
            )}
            
            {/* Tooltip Cards */}
            {mapImageSize.w > 0 && mapImageSize.h > 0 && (mapImageLoaded || showImage) && !mapImageError && (
              <div className="hidden md:block absolute inset-0 pointer-events-none">
                <AnimatePresence>
                  {MAP_PINS.map((pin) => 
                    hoveredHotspot === pin.id && (
                      <motion.div
                        key={pin.id}
                        initial={{ opacity: 0, scale: 0.8, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.8, y: 10 }}
                        transition={{ duration: 0.2 }}
                        className="absolute z-30 pointer-events-none"
                        style={{
                          left: `${(pin.x / mapImageSize.w) * 100}%`,
                          top: `${(pin.y / mapImageSize.h) * 100}%`,
                          transform: 'translate(-50%, calc(-100% - 20px))'
                        }}
                      >
                        <div className="bg-black/80 backdrop-blur-md border border-white/20 rounded-lg p-4 shadow-2xl w-64">
                          <h3 className="font-serif italic font-light text-xl text-neutral-400 mb-2">{pin.label}</h3>
                          <p className="text-sm text-neutral-400 leading-relaxed">{pin.subtitle}</p>
                        </div>
                        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 w-0 h-0 border-l-8 border-r-8 border-t-8 border-transparent border-t-black/80" />
                      </motion.div>
                    )
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
          
          {/* Caption Below */}
          <div className="mt-8 pt-8 border-t border-white/8">
            <p className="text-base md:text-lg text-[#e5e5e5] text-center font-serif italic max-w-3xl mx-auto">
              Aerial view of The Valley at 1,550m altitude, showing the scattered village layout across the mountain landscape
            </p>
          </div>
        </motion.div>
        
        {/* Location Pills - Minimal Bordered Blocks */}
        <div className="flex flex-wrap justify-center gap-4 md:gap-6 max-w-4xl mx-auto">
          {locationPills.map((pill, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              className="border border-white/8 rounded-full px-6 py-3"
            >
              <div className="text-center">
                <span className="text-white font-medium text-base">{pill.title}</span>
                <span className="text-[#b3b3b3] text-sm mx-2">•</span>
                <span className="text-[#e5e5e5] text-sm">{pill.sleeps}</span>
                <span className="text-[#b3b3b3] text-sm mx-2">•</span>
                <span className="text-[#b3b3b3] text-sm">{pill.bestFor}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default LayOfLandSection;
