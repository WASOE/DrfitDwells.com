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
            className="absolute bottom-3 right-3 bg-white/90 backdrop-blur px-3 py-1 rounded-full text-sm shadow hover:bg-white transition-colors cursor-pointer"
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
            Show all photos
          </div>
        )}
      </div>

      {/* Desktop/Tablet: 5-up mosaic — Premium styling */}
      <div className="hidden sm:grid sm:grid-cols-3 gap-2 relative">
        {/* Hero spans 2 cols - fixed aspect ratio */}
        <button
          aria-label={`Open gallery: ${images.length} ${images.length === 1 ? 'photo' : 'photos'}`}
          className="col-span-2 aspect-[4/3] overflow-hidden rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#81887A] focus:ring-offset-2 shadow-md hover:shadow-lg transition-all duration-300 group relative"
          onClick={() => onOpenLightbox(heroIndex)}
        >
          <img 
            src={hero.url} 
            alt={hero.alt || ''} 
            className="w-full h-full object-cover group-hover:scale-[1.01] transition-transform duration-300" 
            loading="eager"
            decoding="async"
          />
          {/* Show all photos overlay - always visible, fades in on hover */}
          {images.length > 1 && (
            <div className="absolute bottom-3 right-3 opacity-100 group-hover:opacity-100 transition-opacity">
              <div
                className="bg-white/95 backdrop-blur-sm px-3 py-1.5 rounded-lg text-xs font-medium text-gray-900 shadow-md hover:bg-white hover:shadow-lg transition-all border border-gray-200/50 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenLightbox(heroIndex);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onOpenLightbox(0);
                  }
                }}
                aria-label={`Show all ${images.length} photos`}
              >
                Show all photos
              </div>
            </div>
          )}
        </button>

        {/* 4 small tiles (or fewer) - 1:1 aspect, aligned to hero baseline */}
        <div className="grid grid-cols-2 grid-rows-2 gap-2 self-start">
          {rest.map((img, i) => {
            const imgIndex = restIndices[i] >= 0 ? restIndices[i] : (heroIndex + i + 1);
            return (
              <button
                key={img._id || i}
                className="aspect-square overflow-hidden rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#81887A] shadow-sm hover:shadow-md transition-all duration-300 group"
                aria-label={`Open photo ${i+2}`}
                onClick={() => onOpenLightbox(imgIndex)}
              >
                <img 
                  src={img.url} 
                  alt={img.alt || ''} 
                  className="w-full h-full object-cover group-hover:scale-[1.01] transition-transform duration-300" 
                  loading="lazy" 
                  decoding="async"
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

