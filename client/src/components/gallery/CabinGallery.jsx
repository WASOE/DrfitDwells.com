import { useState, useEffect, useRef, useCallback } from 'react';
import './lightbox.css';

// Safe URL normalization helper
function normalizeSrc(u) {
  if (!u) return '';
  // Absolute http(s)
  if (/^https?:\/\//i.test(u)) return u;
  // Already rooted (/uploads/…)
  if (u.startsWith('/')) return u;
  // Bare filename -> assume uploads/cabins (admin upload default)
  return `/uploads/cabins/${u}`;
}

const CabinGallery = ({ images, cabinName }) => {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isZoomed, setIsZoomed] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  
  const lightboxRef = useRef(null);
  const imageRef = useRef(null);
  const closeButtonRef = useRef(null);

  // Build gallery array from images or fallback to imageUrl
  const gallery = images && images.length > 0 
    ? images.map(img => ({
        url: normalizeSrc(img.url || img),
        alt: img.alt || cabinName || 'Cabin image'
      }))
    : [];

  // Preload neighbor images for lightbox
  const preloadImage = useCallback((index) => {
    if (gallery[index]) {
      const img = new Image();
      img.src = gallery[index].url;
    }
  }, [gallery]);

  // Handle lightbox open
  const openLightbox = (index) => {
    setCurrentIndex(index);
    setLightboxOpen(true);
    setIsZoomed(false);
    setDragOffset({ x: 0, y: 0 });
    
    // Prevent body scroll
    document.body.classList.add('lightbox-open');
    
    // Preload neighbors
    if (gallery[index - 1]) preloadImage(index - 1);
    if (gallery[index + 1]) preloadImage(index + 1);
  };

  // Handle lightbox close
  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    setIsZoomed(false);
    setDragOffset({ x: 0, y: 0 });
    
    // Restore body scroll
    document.body.classList.remove('lightbox-open');
  }, []);

  // Navigation functions
  const goToPrevious = useCallback(() => {
    if (gallery.length === 0) return;
    const newIndex = currentIndex === 0 ? gallery.length - 1 : currentIndex - 1;
    setCurrentIndex(newIndex);
    setIsZoomed(false);
    setDragOffset({ x: 0, y: 0 });
    
    // Preload neighbors
    if (gallery[newIndex - 1]) preloadImage(newIndex - 1);
    if (gallery[newIndex + 1]) preloadImage(newIndex + 1);
  }, [currentIndex, gallery, preloadImage]);

  const goToNext = useCallback(() => {
    if (gallery.length === 0) return;
    const newIndex = currentIndex === gallery.length - 1 ? 0 : currentIndex + 1;
    setCurrentIndex(newIndex);
    setIsZoomed(false);
    setDragOffset({ x: 0, y: 0 });
    
    // Preload neighbors
    if (gallery[newIndex - 1]) preloadImage(newIndex - 1);
    if (gallery[newIndex + 1]) preloadImage(newIndex + 1);
  }, [currentIndex, gallery, preloadImage]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!lightboxOpen) return;
      
      switch (e.key) {
        case 'Escape':
          closeLightbox();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          goToPrevious();
          break;
        case 'ArrowRight':
          e.preventDefault();
          goToNext();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [lightboxOpen, goToPrevious, goToNext, closeLightbox]);

  // Focus management
  useEffect(() => {
    if (lightboxOpen && closeButtonRef.current) {
      closeButtonRef.current.focus();
    }
  }, [lightboxOpen]);

  // Cleanup body scroll on unmount
  useEffect(() => {
    return () => {
      document.body.classList.remove('lightbox-open');
    };
  }, []);

  // Touch/drag handling for panning when zoomed
  const handleTouchStart = (e) => {
    if (!isZoomed) return;
    const touch = e.touches[0];
    setDragStart({ x: touch.clientX, y: touch.clientY });
  };

  const handleTouchMove = (e) => {
    if (!isZoomed || !dragStart) return;
    e.preventDefault();
    const touch = e.touches[0];
    setDragOffset({
      x: touch.clientX - dragStart.x,
      y: touch.clientY - dragStart.y
    });
  };

  const handleTouchEnd = () => {
    setDragStart(null);
  };

  // Mouse drag handling
  const handleMouseDown = (e) => {
    if (!isZoomed) return;
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e) => {
    if (!isZoomed || !dragStart) return;
    setDragOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setDragStart(null);
  };

  // Zoom toggle
  const toggleZoom = (e) => {
    if (e.detail === 2 || e.type === 'dblclick') {
      e.preventDefault();
      setIsZoomed(!isZoomed);
      setDragOffset({ x: 0, y: 0 });
    }
  };

  // Simple srcset - only use the actual image URL
  const generateSrcSet = (url) => {
    if (!url) return '';
    return `${url} 1x`;
  };

  if (gallery.length === 0) {
    return (
      <div className="cabin-gallery-empty">
        <div className="aspect-video bg-gray-200 rounded-lg flex items-center justify-center">
          <span className="text-gray-500">No images available</span>
        </div>
      </div>
    );
  }

  return (
    <div className="cabin-gallery">
      {/* Desktop: 5-up mosaic */}
      <div className="hidden lg:grid lg:grid-cols-5 lg:gap-2 lg:h-96">
        {/* Large cover image */}
        <div 
          className="col-span-2 row-span-2 cursor-pointer group relative overflow-hidden rounded-lg"
          onClick={() => openLightbox(0)}
        >
          <img
            src={gallery[0].url}
            alt={gallery[0].alt}
            loading="lazy"
            decoding="async"
            srcSet={generateSrcSet(gallery[0].url)}
            sizes="(max-width: 1024px) 50vw, 40vw"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
          <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-300" />
        </div>
        
        {/* Four small tiles */}
        {gallery.slice(1, 5).map((image, index) => (
          <div
            key={index + 1}
            className="cursor-pointer group relative overflow-hidden rounded-lg"
            onClick={() => openLightbox(index + 1)}
          >
            <img
              src={image.url}
              alt={image.alt}
              loading="lazy"
              decoding="async"
              srcSet={generateSrcSet(image.url)}
              sizes="(max-width: 1024px) 25vw, 20vw"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
            <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-300" />
          </div>
        ))}
        
        {/* +X photos overlay */}
        {gallery.length > 5 && (
          <div className="absolute bottom-2 right-2 bg-black bg-opacity-75 text-white px-2 py-1 rounded text-sm">
            +{gallery.length - 5} photos
          </div>
        )}
      </div>

      {/* Tablet: 2 columns */}
      <div className="hidden sm:grid sm:grid-cols-2 sm:gap-2 sm:h-80 lg:hidden">
        <div 
          className="cursor-pointer group relative overflow-hidden rounded-lg"
          onClick={() => openLightbox(0)}
        >
          <img
            src={gallery[0].url}
            alt={gallery[0].alt}
            loading="lazy"
            decoding="async"
            srcSet={generateSrcSet(gallery[0].url)}
            sizes="(max-width: 640px) 100vw, 50vw"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
          <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-300" />
        </div>
        
        <div className="grid grid-cols-2 gap-2">
          {gallery.slice(1, 5).map((image, index) => (
            <div
              key={index + 1}
              className="cursor-pointer group relative overflow-hidden rounded-lg"
              onClick={() => openLightbox(index + 1)}
            >
              <img
                src={image.url}
                alt={image.alt}
                loading="lazy"
                decoding="async"
                srcSet={generateSrcSet(image.url)}
                sizes="(max-width: 640px) 50vw, 25vw"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-300" />
            </div>
          ))}
        </div>
        
        {/* +X photos overlay */}
        {gallery.length > 5 && (
          <div className="absolute bottom-2 right-2 bg-black bg-opacity-75 text-white px-2 py-1 rounded text-sm">
            +{gallery.length - 5} photos
          </div>
        )}
      </div>

      {/* Mobile: single image */}
      <div className="sm:hidden relative">
        <div 
          className="cursor-pointer group relative overflow-hidden rounded-lg"
          onClick={() => openLightbox(0)}
        >
          <img
            src={gallery[0].url}
            alt={gallery[0].alt}
            loading="lazy"
            decoding="async"
            srcSet={generateSrcSet(gallery[0].url)}
            sizes="100vw"
            className="w-full aspect-video object-cover group-hover:scale-105 transition-transform duration-300"
          />
          <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-300" />
        </div>
        
        {/* +X photos badge */}
        {gallery.length > 1 && (
          <div className="absolute bottom-2 right-2 bg-black bg-opacity-75 text-white px-2 py-1 rounded text-sm">
            +{gallery.length - 1} photos
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxOpen && (
        <div 
          className="lightbox-overlay"
          onClick={closeLightbox}
          ref={lightboxRef}
        >
          <div className="lightbox-container">
            {/* Close button */}
            <button
              ref={closeButtonRef}
              className="lightbox-close"
              onClick={closeLightbox}
              aria-label="Close lightbox"
            >
              ×
            </button>

            {/* Previous button */}
            {gallery.length > 1 && (
              <button
                className="lightbox-nav lightbox-prev"
                onClick={(e) => {
                  e.stopPropagation();
                  goToPrevious();
                }}
                aria-label="Previous image"
              >
                ‹
              </button>
            )}

            {/* Next button */}
            {gallery.length > 1 && (
              <button
                className="lightbox-nav lightbox-next"
                onClick={(e) => {
                  e.stopPropagation();
                  goToNext();
                }}
                aria-label="Next image"
              >
                ›
              </button>
            )}

            {/* Image container */}
            <div 
              className="lightbox-image-container"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onDoubleClick={toggleZoom}
            >
              <img
                ref={imageRef}
                src={gallery[currentIndex].url}
                alt={gallery[currentIndex].alt}
                className={`lightbox-image ${isZoomed ? 'lightbox-image-zoomed' : ''}`}
                style={{
                  transform: isZoomed 
                    ? `scale(2) translate(${dragOffset.x / 2}px, ${dragOffset.y / 2}px)`
                    : 'scale(1)'
                }}
                draggable={false}
              />
            </div>

            {/* Caption and counter */}
            <div className="lightbox-caption">
              <div className="lightbox-caption-text">
                {gallery[currentIndex].alt}
              </div>
              <div className="lightbox-counter">
                {currentIndex + 1} / {gallery.length}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CabinGallery;
