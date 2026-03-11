import { useMemo } from 'react';

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

// Helper to get primary tag (first tag or null)
function getPrimaryTag(img) {
  return Array.isArray(img.tags) && img.tags.length > 0 ? img.tags[0] : null;
}

// Smart selection for 5-photo cover collage
function selectCoverCollage(images) {
  if (!images || images.length === 0) return [];
  
  // Find cover image first
  const cover = images.find(img => img.isCover) || images[0];
  if (!cover) return [];
  
  // Priority spaces for diversity
  const prioritySpaces = ['outdoor', 'view', 'living_room', 'bedroom', 'bathroom', 'kitchen', 'dining'];
  
  // Group images by space
  const bySpace = {};
  images.forEach(img => {
    if (img._id === cover._id) return; // Skip cover
    const tag = getPrimaryTag(img);
    if (!bySpace[tag]) bySpace[tag] = [];
    bySpace[tag].push(img);
  });
  
  // Select diverse images
  const selected = [cover];
  const selectedSpaces = new Set([getPrimaryTag(cover)]);
  
  // Try to get 1 from each priority space
  for (const space of prioritySpaces) {
    if (selected.length >= 5) break;
    if (bySpace[space] && bySpace[space].length > 0 && !selectedSpaces.has(space)) {
      selected.push(bySpace[space][0]);
      selectedSpaces.add(space);
    }
  }
  
  // Fill remaining slots with any available images
  for (const img of images) {
    if (selected.length >= 5) break;
    if (img._id === cover._id) continue;
    if (!selected.find(s => s._id === img._id)) {
      selected.push(img);
    }
  }
  
  return selected.slice(0, 5);
}

export default function MosaicGallery({ images = [], onOpenLightbox }) {
  const { top5, indices } = useMemo(() => {
    if (!images || images.length === 0) return { top5: [], indices: [] };
    
    // Use smart selection if we have 5+ images with tags
    const hasTags = images.some(img => getPrimaryTag(img));
    const collage = hasTags && images.length >= 5 
      ? selectCoverCollage(images)
      : images.slice(0, 5);
    
    // Map back to original indices
    const selectedIndices = collage.map(img => 
      images.findIndex(orig => orig._id === img._id)
    ).filter(idx => idx >= 0);
    
    const normalized = collage.map(img => ({
      ...img,
      url: normalizeSrc(img.url || img)
    }));
    
    return { top5: normalized, indices: selectedIndices };
  }, [images]);

  if (!top5.length) return null;

  const hero = top5[0];
  const heroIndex = indices[0] >= 0 ? indices[0] : 0;
  const rest = top5.slice(1);
  const restIndices = indices.slice(1);

  return (
    <div className="relative">
      {/* Mobile: single hero with pill */}
      <div className="sm:hidden">
        <button
          aria-label="Open gallery"
          className="w-full h-56 overflow-hidden rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A]"
          onClick={() => onOpenLightbox(heroIndex)}
        >
          <img
            src={hero.url}
            alt={hero.alt || ''}
            className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
            loading="eager"
            decoding="async"
          />
        </button>
        {images.length > 1 && (
          <div
            className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-lg text-sm font-medium shadow-md hover:bg-gray-50 transition-colors cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onOpenLightbox(heroIndex);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpenLightbox(0);
              }
            }}
            aria-label="Show all photos"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            Show all photos
          </div>
        )}
      </div>

      {/* Desktop/Tablet: 1 large left + 4 small right, ALL ALIGNED (top/bottom match) */}
      <div className="hidden sm:grid sm:grid-cols-[2fr_1fr] sm:grid-rows-2 sm:gap-3 relative rounded-xl overflow-hidden">
        {/* Hero — spans 2 rows, defines height */}
        <button
          aria-label={`Open gallery: ${images.length} ${images.length === 1 ? 'photo' : 'photos'}`}
          className="col-span-1 row-span-2 min-h-0 overflow-hidden rounded-l-xl focus:outline-none focus:ring-2 focus:ring-[#81887A] focus:ring-offset-2 group relative aspect-[1.6/1]"
          onClick={() => onOpenLightbox(heroIndex)}
        >
          <img 
            src={hero.url} 
            alt={hero.alt || ''} 
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300" 
            loading="eager"
            decoding="async"
          />
        </button>

        {/* 4 small tiles — right column, 2x2, same total height as hero */}
        <div className="col-span-1 row-span-2 grid grid-cols-2 grid-rows-2 gap-3 min-h-0 min-w-0">
          {rest.map((img, i) => {
            const imgIndex = restIndices[i] >= 0 ? restIndices[i] : (heroIndex + i + 1);
            const isBottomRight = i === rest.length - 1;
            return (
              <button
                key={img._id || i}
                className={`min-h-0 overflow-hidden focus:outline-none focus:ring-2 focus:ring-[#81887A] group relative ${i === 1 && rest.length > 1 ? 'rounded-tr-xl' : ''} ${i === rest.length - 1 ? 'rounded-br-xl' : ''} ${rest.length === 1 ? 'rounded-r-xl' : ''}`}
                aria-label={`Open photo ${i + 2}`}
                onClick={() => onOpenLightbox(imgIndex)}
              >
                <img 
                  src={img.url} 
                  alt={img.alt || ''} 
                  className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300" 
                  loading="lazy" 
                  decoding="async"
                />
                {/* "Show all photos" overlay on bottom-right tile — Airbnb style */}
                {images.length > 1 && isBottomRight && (
                  <div
                    className="absolute inset-0 flex items-end justify-end p-3 bg-gradient-to-t from-black/40 to-transparent"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenLightbox(0);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onOpenLightbox(0);
                      }
                    }}
                    aria-label={`Show all ${images.length} photos`}
                  >
                    <span className="inline-flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-lg text-sm font-medium text-gray-900 shadow-md hover:bg-gray-50 transition-colors cursor-pointer">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                      </svg>
                      Show all photos
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

