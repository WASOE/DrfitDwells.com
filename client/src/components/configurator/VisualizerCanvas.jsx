import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState, useMemo, memo } from 'react';

/**
 * Majestic visualizer canvas (70% left side)
 * Visual bleed: no borders on top, bottom, or left
 * Cross-fade animations on selection changes
 */
const VisualizerCanvas = ({ 
  activeMediaId, 
  mediaView, 
  selections,
  onMediaSelect,
  onMediaViewChange,
  visibleMedia,
  allMedia,
  isMobile = false
}) => {
  const [previousMediaId, setPreviousMediaId] = useState(activeMediaId);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [loadedImages, setLoadedImages] = useState(new Set());
  const [isImageLoading, setIsImageLoading] = useState(true);

  // Preload the active image (optimized to prevent unnecessary re-runs)
  useEffect(() => {
    const mediaObj = allMedia?.find(m => m.id === activeMediaId) || visibleMedia?.find(m => m.id === activeMediaId);
    if (!mediaObj?.image) return;
    
    // Use responsive image based on screen size
    const imageToLoad = mediaObj.images?.desktop || mediaObj.image;
    
    if (loadedImages.has(imageToLoad)) {
      setIsImageLoading(false);
      return;
    }
    
    setIsImageLoading(true);
    const img = new Image();
    img.src = imageToLoad;
    img.onload = () => {
      setLoadedImages(prev => {
        const next = new Set(prev);
        next.add(imageToLoad);
        return next;
      });
      setIsImageLoading(false);
    };
    img.onerror = () => {
      setIsImageLoading(false);
    };
  }, [activeMediaId]); // Only depend on activeMediaId to prevent loops

  // Preload visible media thumbnails (lazy, after main image) - only once
  useEffect(() => {
    if (!visibleMedia || visibleMedia.length === 0) return;
    
    const preloadThumbnails = () => {
      visibleMedia.forEach((media, index) => {
        // Use thumbnail version for preloading
        const thumbnailSrc = media.images?.thumbnail || media.image;
        if (thumbnailSrc && !loadedImages.has(thumbnailSrc)) {
          setTimeout(() => {
            const img = new Image();
            img.src = thumbnailSrc;
            img.onload = () => {
              setLoadedImages(prev => {
                const next = new Set(prev);
                next.add(thumbnailSrc);
                return next;
              });
            };
          }, index * 150); // Stagger loading more
        }
      });
    };
    
    // Delay thumbnail preloading to prioritize main image
    const timer = setTimeout(preloadThumbnails, 800);
    return () => clearTimeout(timer);
  }, [visibleMedia?.length]); // Only re-run if number of visible media changes

  // Track media changes for cross-fade
  useEffect(() => {
    if (activeMediaId !== previousMediaId) {
      setIsTransitioning(true);
      setTimeout(() => {
        setPreviousMediaId(activeMediaId);
        setIsTransitioning(false);
      }, 300);
    }
  }, [activeMediaId, previousMediaId]);

  const containerClasses = isMobile
    ? "relative w-full h-full"
    : "relative w-full h-full lg:h-screen";

  return (
    <div className={containerClasses}>
      <div className="absolute inset-0 bg-gradient-to-br from-gray-800 via-gray-900 to-black">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeMediaId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 flex items-center justify-center"
          >
            {/* Real cabin image */}
            {(() => {
              // Find the media object for the active media ID (check all media, not just visible)
              const mediaObj = allMedia?.find(m => m.id === activeMediaId) || visibleMedia?.find(m => m.id === activeMediaId);
              const imageSrc = mediaObj?.image;
              
              if (imageSrc) {
                // Use responsive images if available - select based on screen size
                const hasResponsive = mediaObj?.images;
                let imageToUse = imageSrc;
                
                if (hasResponsive) {
                  // Use mobile image on mobile, desktop on desktop
                  // We'll let the browser handle this via CSS media queries in the picture element
                  imageToUse = mediaObj.images.desktop; // Default to desktop
                }
                
                return (
                  <>
                    {isImageLoading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-800 via-gray-900 to-black">
                        <div className="text-white/40 text-sm uppercase tracking-widest">Loading...</div>
                      </div>
                    )}
                    {hasResponsive ? (
                      <picture>
                        <source
                          media="(max-width: 768px)"
                          srcSet={mediaObj.images.mobile}
                          type="image/webp"
                        />
                        <img
                          src={mediaObj.images.desktop}
                          alt={mediaObj?.label || 'Cabin visualization'}
                          className={`w-full h-full object-cover transition-opacity duration-300 ${isImageLoading ? 'opacity-0' : 'opacity-100'}`}
                          style={{ objectPosition: 'center' }}
                          loading="eager"
                          decoding="async"
                          fetchpriority="high"
                          onLoad={() => setIsImageLoading(false)}
                        />
                      </picture>
                    ) : (
                      <img
                        src={imageToUse}
                        alt={mediaObj?.label || 'Cabin visualization'}
                        className={`w-full h-full object-cover transition-opacity duration-300 ${isImageLoading ? 'opacity-0' : 'opacity-100'}`}
                        style={{ objectPosition: 'center' }}
                        loading="eager"
                        decoding="async"
                        fetchpriority="high"
                        onLoad={() => setIsImageLoading(false)}
                      />
                    )}
                  </>
                );
              }
              
              // Fallback placeholder if no image found
              return (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-white/20 text-sm uppercase tracking-widest mb-2">
                      {mediaView === 'exterior' ? 'Exterior Render' : 'Interior Render'}
                    </div>
                    <div className="text-white/10 text-xs">
                      {activeMediaId || 'Cabin Visualization'}
                    </div>
                  </div>
                </div>
              );
            })()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* View toggle - floating glass panel (desktop only) */}
      {!isMobile && (
        <div className="absolute top-6 left-6 z-10">
          <div className="backdrop-blur-md bg-white/80 rounded-full px-4 py-2 border border-white/20 shadow-lg">
            <div className="flex items-center gap-3 text-xs uppercase tracking-wider">
              <button
                onClick={() => {
                  if (onMediaViewChange && mediaView !== 'exterior') {
                    onMediaViewChange('exterior');
                    // Switch to first exterior image
                    const firstExterior = allMedia?.find(m => m.view === 'exterior');
                    if (firstExterior && onMediaSelect) {
                      onMediaSelect(firstExterior.id);
                    }
                  }
                }}
                className={`transition-colors cursor-pointer hover:text-black ${
                  mediaView === 'exterior' 
                    ? 'text-black font-medium' 
                    : 'text-gray-500'
                }`}
              >
                Exterior
              </button>
              <span className="text-gray-300">|</span>
              <button
                onClick={() => {
                  if (onMediaViewChange && mediaView !== 'interior') {
                    onMediaViewChange('interior');
                    // Switch to first interior image
                    const firstInterior = allMedia?.find(m => m.view === 'interior');
                    if (firstInterior && onMediaSelect) {
                      onMediaSelect(firstInterior.id);
                    }
                  }
                }}
                className={`transition-colors cursor-pointer hover:text-black ${
                  mediaView === 'interior' 
                    ? 'text-black font-medium' 
                    : 'text-gray-500'
                }`}
              >
                Interior
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Thumbnail strip - bottom (mobile: smaller, desktop: larger) */}
      {visibleMedia && visibleMedia.length > 0 && (
        <div className={`absolute ${isMobile ? 'bottom-4 left-4 right-4' : 'bottom-6 left-6 right-6'}`} style={{ zIndex: 40 }}>
          <div className={`backdrop-blur-md bg-white/90 ${isMobile ? 'rounded-xl px-3 py-2' : 'rounded-2xl px-4 py-3'} border border-white/20 shadow-lg`}>
            <div className="flex gap-2 md:gap-3 overflow-x-auto scrollbar-hide" style={{ WebkitOverflowScrolling: 'touch' }}>
              {visibleMedia.map((media, index) => (
                <motion.button
                  key={media.id}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => onMediaSelect?.(media.id)}
                  className={`relative flex-shrink-0 ${isMobile ? 'w-16 h-12 rounded-lg' : 'w-20 h-16 rounded-xl'} overflow-hidden border-2 transition-all touch-manipulation active:scale-95 ${
                    activeMediaId === media.id
                      ? 'border-black shadow-lg scale-105'
                      : 'border-white/40 active:border-white/60'
                  }`}
                >
                  {media.image ? (
                    <img
                      src={media.images?.thumbnail || media.image}
                      alt={media.label}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <>
                      <div className="absolute inset-0 bg-gradient-to-br from-gray-700 to-gray-900" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[9px] md:text-[10px] text-white/60 uppercase tracking-wider">
                          {media.label}
                        </span>
                      </div>
                    </>
                  )}
                </motion.button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default memo(VisualizerCanvas);
