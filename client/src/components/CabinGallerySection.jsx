import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { cabinAPI } from '../services/api';
import { getSEOAlt } from '../data/imageMetadata';
import './CabinGallerySection.css';

// Space tags (match CabinDetails)
const SPACE_TAGS = [
  { value: 'bedroom', label: 'Bedroom' },
  { value: 'living_room', label: 'Living room' },
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'dining', label: 'Dining' },
  { value: 'bathroom', label: 'Bathroom' },
  { value: 'outdoor', label: 'Outdoor' },
  { value: 'view', label: 'View' },
  { value: 'hot_tub_sauna', label: 'Hot tub/Sauna' },
  { value: 'amenities', label: 'Amenities' },
  { value: 'floorplan', label: 'Floorplan' },
  { value: 'map', label: 'Map' },
  { value: 'other', label: 'Other' },
];

const SPACE_ORDER = ['bedroom', 'living_room', 'kitchen', 'dining', 'bathroom', 'outdoor', 'view', 'hot_tub_sauna', 'amenities', 'floorplan', 'map', 'other'];

// Fallback images when API returns no images (same as current TheCabin hardcoded set)
const FALLBACK_IMAGES = [
  { url: '/uploads/Content%20website/drift-dwells-bulgaria-bucephalus-suite.avif', alt: 'Interior of Bucephalus cabin', tags: ['living_room'] },
  { url: '/uploads/Content%20website/drift-dwells-bulgaria-cabin-journal.avif', alt: 'Cozy reading nook', tags: ['living_room'] },
  { url: '/uploads/The Cabin/6c6a852c-e8e1-44af-8dda-c31fbc9dbda6.jpeg', alt: 'Cabin interior', tags: ['interior'] },
  { url: '/uploads/The Cabin/011f4645-32ce-4739-ac8e-16a900612ac7.jpeg', alt: 'Cabin exterior', tags: ['outdoor'] },
  { url: '/uploads/The Cabin/40ce9b09-4b86-4e9a-a4d4-e860ba84bcdf.jpeg', alt: 'Cabin view', tags: ['view'] },
];

const normalizeSrc = (u) => {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/')) return u;
  return `/uploads/cabins/${u}`;
};

const CabinGallerySection = ({ openModal }) => {
  const { t } = useTranslation('cabin');
  const [cabin, setCabin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxMode, setLightboxMode] = useState('grid');
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxFilter, setLightboxFilter] = useState('all');
  const [gridScrollPosition, setGridScrollPosition] = useState(0);
  const lightboxCloseBtnRef = useRef(null);
  const gridContainerRef = useRef(null);

  const getPrimaryTag = useCallback((img) => {
    return Array.isArray(img.tags) && img.tags.length > 0 ? img.tags[0] : null;
  }, []);

  const gallery = useMemo(() => {
    const raw = Array.isArray(cabin?.images) && cabin.images.length
      ? cabin.images.slice().sort((a, b) => {
          if (b.isCover !== a.isCover) return (b.isCover ? 1 : 0) - (a.isCover ? 1 : 0);
          const aTag = getPrimaryTag(a);
          const bTag = getPrimaryTag(b);
          if (aTag !== bTag) {
            const aIdx = aTag ? SPACE_ORDER.indexOf(aTag) : 999;
            const bIdx = bTag ? SPACE_ORDER.indexOf(bTag) : 999;
            if (aIdx !== bIdx) return aIdx - bIdx;
          }
          if (a.sort !== b.sort) return (a.sort || 0) - (b.sort || 0);
          return 0;
        })
      : [];
    if (raw.length > 0) return raw;
    return FALLBACK_IMAGES.map((img, i) => ({ ...img, _id: `fallback-${i}` }));
  }, [cabin?.images, getPrimaryTag]);

  const filteredGallery = useMemo(() => {
    if (!lightboxFilter || lightboxFilter === 'all') return gallery;
    return gallery.filter(img => getPrimaryTag(img) === lightboxFilter);
  }, [gallery, lightboxFilter, getPrimaryTag]);

  const spaceCounts = useMemo(() => {
    const counts = { all: gallery.length };
    gallery.forEach(img => {
      const tag = getPrimaryTag(img);
      if (tag) counts[tag] = (counts[tag] || 0) + 1;
    });
    return counts;
  }, [gallery, getPrimaryTag]);

  const imageIdToIndexMap = useMemo(() => {
    const map = new Map();
    gallery.forEach((img, idx) => {
      if (img._id) map.set(img._id, idx);
    });
    return map;
  }, [gallery]);

  const imagesBySpace = useMemo(() => {
    const grouped = {};
    filteredGallery.forEach(img => {
      const tag = getPrimaryTag(img) || 'other';
      if (!grouped[tag]) grouped[tag] = [];
      grouped[tag].push(img);
    });
    return grouped;
  }, [filteredGallery, getPrimaryTag]);

  const spacesToDisplay = useMemo(() => {
    const spaces = SPACE_ORDER.filter(tag => imagesBySpace[tag]?.length > 0);
    if (imagesBySpace['other']?.length > 0 && !SPACE_ORDER.includes('other')) spaces.push('other');
    return spaces;
  }, [imagesBySpace]);

  const openLightbox = useCallback((startIdx = 0, filterTag = null, mode = 'grid') => {
    if (lightboxOpen && lightboxMode === mode && lightboxFilter === (filterTag || 'all')) return;
    setLightboxFilter(filterTag && filterTag !== 'all' ? filterTag : 'all');
    if (typeof startIdx === 'number' && startIdx >= 0 && gallery.length > 0) {
      setLightboxIndex(Math.max(0, Math.min(startIdx, gallery.length - 1)));
    } else {
      setLightboxIndex(0);
    }
    setLightboxMode(mode);
    setLightboxOpen(true);
    document.body.classList.add('lightbox-open');
    requestAnimationFrame(() => lightboxCloseBtnRef.current?.focus());
  }, [gallery.length, lightboxOpen, lightboxMode, lightboxFilter]);

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    setLightboxMode('grid');
    document.body.classList.remove('lightbox-open');
  }, []);

  const openImageViewer = useCallback((imageIndex) => {
    if (gallery.length === 0) return;
    if (gridContainerRef.current) setGridScrollPosition(gridContainerRef.current.scrollTop);
    setLightboxIndex(Math.max(0, Math.min(imageIndex, gallery.length - 1)));
    setLightboxMode('viewer');
    setLightboxOpen(true);
    document.body.classList.add('lightbox-open');
    requestAnimationFrame(() => lightboxCloseBtnRef.current?.focus());
  }, [gallery.length]);

  const backToGrid = useCallback(() => {
    setLightboxMode('grid');
    requestAnimationFrame(() => {
      if (gridContainerRef.current && gridScrollPosition > 0) {
        gridContainerRef.current.scrollTop = gridScrollPosition;
      }
    });
  }, [gridScrollPosition]);

  const goToPrevious = useCallback(() => {
    if (filteredGallery.length === 0) return;
    const currentImg = gallery[lightboxIndex];
    if (!currentImg?._id) return;
    const currentInFiltered = filteredGallery.findIndex(img => img._id === currentImg._id);
    const prevInFiltered = currentInFiltered <= 0 ? filteredGallery.length - 1 : currentInFiltered - 1;
    const prevImg = filteredGallery[prevInFiltered];
    setLightboxIndex(prevImg?._id ? (imageIdToIndexMap.get(prevImg._id) ?? 0) : 0);
  }, [lightboxIndex, gallery, filteredGallery, imageIdToIndexMap]);

  const goToNext = useCallback(() => {
    if (filteredGallery.length === 0) return;
    const currentImg = gallery[lightboxIndex];
    if (!currentImg?._id) return;
    const currentInFiltered = filteredGallery.findIndex(img => img._id === currentImg._id);
    const nextInFiltered = currentInFiltered >= filteredGallery.length - 1 ? 0 : currentInFiltered + 1;
    const nextImg = filteredGallery[nextInFiltered];
    setLightboxIndex(nextImg?._id ? (imageIdToIndexMap.get(nextImg._id) ?? 0) : 0);
  }, [lightboxIndex, gallery, filteredGallery, imageIdToIndexMap]);

  const handleFilterChange = useCallback((tag) => {
    const newFiltered = tag === 'all' ? gallery : gallery.filter(img => getPrimaryTag(img) === tag);
    setLightboxFilter(tag);
    if (newFiltered.length > 0 && newFiltered[0]._id) {
      setLightboxIndex(imageIdToIndexMap.get(newFiltered[0]._id) ?? 0);
    }
    if (lightboxMode === 'viewer') setLightboxMode('grid');
    requestAnimationFrame(() => {
      if (gridContainerRef.current) gridContainerRef.current.scrollTop = 0;
    });
  }, [gallery, lightboxMode, getPrimaryTag, imageIdToIndexMap]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await cabinAPI.getAll();
        if (!active || !res?.data?.success) return;
        const cabins = res.data?.data?.cabins || res.data?.cabins || [];
        const found = cabins.find(
          c => c?.name && ['the cabin', 'bucephalus', 'the cabin (bucephalus)'].includes(c.name.trim().toLowerCase())
        ) || cabins[0];
        if (found) setCabin(found);
      } catch {
        setCabin(null);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') goToPrevious();
      if (e.key === 'ArrowRight') goToNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxOpen, closeLightbox, goToPrevious, goToNext]);

  // Preview images: show first 6 from full gallery for the page grid
  const previewImages = useMemo(() => gallery.slice(0, 6), [gallery]);

  return (
    <section className="cabin-gallery-section relative py-16 md:py-24 border-t border-[#F1ECE2]/10 overflow-hidden" style={{ backgroundColor: '#22201e' }}>
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="text-center mb-10 md:mb-14 max-w-2xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="font-serif italic text-3xl md:text-4xl lg:text-5xl text-[#F1ECE2] font-light mb-4 md:mb-5"
          >
            {t('vibe.title')}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="text-[#F1ECE2]/80 text-base md:text-lg font-light leading-relaxed"
          >
            {t('vibe.subtitle')}
          </motion.p>
        </div>

        {/* Filter chips - above grid */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="flex flex-wrap justify-center gap-2 mb-8 md:mb-10"
        >
          <button
            type="button"
            onClick={() => openLightbox(0, 'all', 'grid')}
            className="px-3 py-1.5 rounded-md text-sm font-normal text-[#F1ECE2]/80 hover:text-[#F1ECE2] border-b border-transparent hover:border-[#F1ECE2]/40 transition-colors"
          >
            All ({spaceCounts.all || gallery.length})
          </button>
          {SPACE_TAGS.map(tag => {
            const count = spaceCounts[tag.value] || 0;
            if (count === 0) return null;
            return (
              <button
                key={tag.value}
                type="button"
                onClick={() => openLightbox(0, tag.value, 'grid')}
                className="px-3 py-1.5 rounded-md text-sm font-normal text-[#F1ECE2]/80 hover:text-[#F1ECE2] border-b border-transparent hover:border-[#F1ECE2]/40 transition-colors"
              >
                {tag.label} ({count})
              </button>
            );
          })}
        </motion.div>

        {/* Image grid preview */}
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6 aspect-square max-h-[50vh] md:max-h-[60vh] animate-pulse">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="bg-white/10 rounded-xl" />
            ))}
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6 }}
            className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6 max-w-7xl mx-auto"
          >
            {previewImages.map((img, idx) => {
              const globalIndex = img._id ? (imageIdToIndexMap.get(img._id) ?? idx) : idx;
              const src = normalizeSrc(img.url);
              const alt = img.alt || getSEOAlt(src) || `Cabin photo ${idx + 1}`;
              return (
                <button
                  key={img._id || `preview-${idx}`}
                  onClick={() => openImageViewer(globalIndex)}
                  className="relative aspect-[4/3] overflow-hidden rounded-xl focus:outline-none focus:ring-2 focus:ring-white/50 group"
                  aria-label={alt}
                >
                  <div
                    className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110"
                    style={{ backgroundImage: `url(${src})` }}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                </button>
              );
            })}
          </motion.div>
        )}

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="text-center mt-10 md:mt-14"
        >
          <button
            onClick={openModal}
            className="bg-[#F1ECE2] text-[#22201e] px-8 sm:px-12 py-4 sm:py-5 font-semibold uppercase tracking-[0.25em] text-xs sm:text-sm hover:scale-[1.02] transition-transform shadow-lg border-none rounded-full min-h-[44px] touch-manipulation"
          >
            {t('vibe.cta')}
          </button>
        </motion.div>
      </div>

      {/* Lightbox - same UX as CabinDetails */}
      {lightboxOpen && gallery.length > 0 && (
        <div
          className="cabin-gallery-lightbox fixed inset-0 bg-white z-50 flex flex-col"
          data-lightbox-overlay="true"
          role="dialog"
          aria-modal="true"
          aria-label={lightboxMode === 'grid' ? 'Photo gallery' : 'Photo viewer'}
        >
          <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-gray-200 z-40 shadow-sm">
            <div className="relative flex items-center justify-between px-4 py-3 md:px-6">
              <div className="flex-shrink-0 w-32">
                {lightboxMode === 'viewer' && (
                  <button
                    onClick={backToGrid}
                    className="text-gray-600 hover:text-gray-900 text-sm flex items-center gap-1"
                    aria-label="Back to grid"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                    Back to grid
                  </button>
                )}
              </div>
              <div className="absolute left-1/2 -translate-x-1/2">
                <h2 className="text-gray-900 font-semibold text-lg md:text-xl text-center">
                  {lightboxFilter === 'all'
                    ? `All photos (${filteredGallery.length})`
                    : `${SPACE_TAGS.find(t => t.value === lightboxFilter)?.label || lightboxFilter} (${spaceCounts[lightboxFilter] || 0})`}
                </h2>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 w-32 justify-end">
                <button
                  ref={lightboxCloseBtnRef}
                  className="text-gray-600 text-2xl hover:text-gray-900 p-2 w-10 h-10 flex items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-[#81887A]"
                  onClick={closeLightbox}
                  aria-label="Close gallery"
                >
                  ×
                </button>
              </div>
            </div>
            {lightboxMode === 'grid' && (
              <div className="hidden md:block border-t border-gray-100">
                <div className="flex justify-center gap-1 px-4 py-3 overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => handleFilterChange('all')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                      lightboxFilter === 'all'
                        ? 'bg-[#22201e] text-[#F1ECE2]'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    All ({gallery.length})
                  </button>
                  {SPACE_TAGS.map(tag => {
                    const count = spaceCounts[tag.value] || 0;
                    if (count === 0) return null;
                    return (
                      <button
                        key={tag.value}
                        type="button"
                        onClick={() => handleFilterChange(tag.value)}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                          lightboxFilter === tag.value
                            ? 'bg-[#22201e] text-[#F1ECE2]'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                        }`}
                      >
                        {tag.label} ({count})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {lightboxMode === 'grid' && filteredGallery.length > 0 && (
            <div ref={gridContainerRef} className="flex-1 overflow-y-auto">
              <div className="max-w-7xl mx-auto px-4 py-6 md:py-8">
                {lightboxFilter === 'all' ? (
                  spacesToDisplay.map(spaceTag => {
                    const spaceImages = imagesBySpace[spaceTag] || [];
                    if (spaceImages.length === 0) return null;
                    const spaceLabel = SPACE_TAGS.find(t => t.value === spaceTag)?.label || spaceTag;
                    return (
                      <div key={spaceTag} className="mb-12 md:mb-16">
                        <h3 className="text-gray-900 text-lg md:text-xl font-semibold mb-4 md:mb-6">
                          {spaceLabel} • {spaceImages.length} {spaceImages.length === 1 ? 'photo' : 'photos'}
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-4">
                          {spaceImages.map((img, idx) => {
                            const globalIndex = img._id ? (imageIdToIndexMap.get(img._id) ?? 0) : idx;
                            return (
                              <button
                                key={img._id || `img-${spaceTag}-${idx}`}
                                onClick={() => openImageViewer(globalIndex)}
                                className="relative aspect-[4/3] overflow-hidden rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A] group"
                              >
                                <img
                                  src={normalizeSrc(img.url)}
                                  alt={img.alt || `${spaceLabel} photo ${idx + 1}`}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                  loading="lazy"
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 flex items-center justify-center">
                                  <span className="opacity-0 group-hover:opacity-100 text-sm font-medium bg-white/90 px-3 py-1.5 rounded-full transition-opacity">View</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-4">
                    {filteredGallery.map((img, idx) => {
                      const globalIndex = img._id ? (imageIdToIndexMap.get(img._id) ?? 0) : idx;
                      return (
                        <button
                          key={img._id || `img-${idx}`}
                          onClick={() => openImageViewer(globalIndex)}
                          className="relative aspect-[4/3] overflow-hidden rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A] group"
                        >
                          <img
                            src={normalizeSrc(img.url)}
                            alt={img.alt || `Photo ${idx + 1}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 flex items-center justify-center">
                            <span className="opacity-0 group-hover:opacity-100 text-sm font-medium bg-white/90 px-3 py-1.5 rounded-full transition-opacity">View</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {lightboxMode === 'viewer' && filteredGallery.length > 0 && (
            <div className="flex-1 flex items-center justify-center relative bg-gray-50">
              {filteredGallery.length > 1 && (
                <>
                  <button
                    className="absolute left-4 text-gray-700 text-4xl hover:text-gray-900 z-10 p-2 bg-white/80 hover:bg-white shadow-md rounded-full"
                    onClick={goToPrevious}
                    aria-label="Previous image"
                  >
                    ‹
                  </button>
                  <button
                    className="absolute right-4 text-gray-700 text-4xl hover:text-gray-900 z-10 p-2 bg-white/80 hover:bg-white shadow-md rounded-full"
                    onClick={goToNext}
                    aria-label="Next image"
                  >
                    ›
                  </button>
                </>
              )}
              <div className="relative max-w-7xl max-h-[90vh] mx-4">
                {(() => {
                  const currentImg = gallery[lightboxIndex];
                  const displayImg = currentImg && filteredGallery.some(i => i._id === currentImg._id)
                    ? currentImg
                    : filteredGallery[0];
                  const displayIndex = filteredGallery.findIndex(i => i._id === displayImg?._id);
                  if (!displayImg) return null;
                  return (
                    <>
                      <img
                        src={normalizeSrc(displayImg.url)}
                        alt={displayImg.alt || `Image ${(displayIndex >= 0 ? displayIndex : 0) + 1} of ${filteredGallery.length}`}
                        className="max-w-full max-h-[90vh] object-contain"
                        loading="eager"
                        draggable="false"
                      />
                      {(displayImg.alt || filteredGallery.length > 1) && (
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-gray-900/90 to-transparent p-6">
                          {displayImg.alt && <p className="text-white text-sm mb-2 font-medium">{displayImg.alt}</p>}
                          {filteredGallery.length > 1 && (
                            <p className="text-white/90 text-xs font-medium">
                              {(displayIndex >= 0 ? displayIndex : 0) + 1} / {filteredGallery.length}
                              {lightboxFilter !== 'all' && (
                                <span className="ml-2 text-white/70">
                                  • {SPACE_TAGS.find(t => t.value === lightboxFilter)?.label || lightboxFilter}
                                </span>
                              )}
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default CabinGallerySection;
