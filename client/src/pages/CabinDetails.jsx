import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { cabinAPI, bookingAPI } from '../services/api';
import { useBookingContext } from '../context/BookingContext';
import MosaicGallery from '../components/MosaicGallery';
import ReviewsSection from '../components/reviews/ReviewsSection';
import MapArrival from '../components/MapArrival';
import StickyBookingBar from '../components/StickyBookingBar';
import Seo from '../components/Seo';
import './CabinDetails.css';

// Constants
const SCROLL_DELAY_MS = 100;
const BOOKING_SUCCESS_REDIRECT_MS = 2000;
const LIGHTBOX_FOCUS_DELAY_MS = 0;
const DEFAULT_EXPERIENCES = [
  { key: 'atv_pickup', name: 'ATV pickup', price: 70, currency: 'BGN', unit: 'flat_per_stay', active: true, sortOrder: 0 },
  { key: 'horse_riding', name: 'Horse riding', price: 70, currency: 'BGN', unit: 'per_guest', active: true, sortOrder: 1 },
  { key: 'jeep_transfer', name: 'Jeep transfer', price: 60, currency: 'BGN', unit: 'flat_per_stay', active: true, sortOrder: 2 },
];

const CabinDetails = () => {
  // ===== A) Router & Context hooks (always first) =====
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setBasicInfo } = useBookingContext();
  
  // Check if we're returning to craft flow
  const returnTo = searchParams.get('returnTo');
  
  // ===== B) All State hooks (declare ALL unconditionally) =====
  const [cabin, setCabin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxMode, setLightboxMode] = useState('grid'); // 'grid' or 'viewer'
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxFilter, setLightboxFilter] = useState('all'); // 'all' or space tag
  const [gridScrollPosition, setGridScrollPosition] = useState(0); // Save scroll for back navigation
  const [isSaved, setIsSaved] = useState(false);
  const [selectedExpKeys, setSelectedExpKeys] = useState(new Set());

  // Form state
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    specialRequests: ''
  });

  const [formErrors, setFormErrors] = useState({});
  const [mobileDateDrawerOpen, setMobileDateDrawerOpen] = useState(false);

  // ===== C) All Refs (declare ALL unconditionally) =====
  const lightboxCloseBtnRef = useRef(null);
  const lastTriggerRef = useRef(null);
  const gridContainerRef = useRef(null);

  // ===== D) Derived data (pure variables, memoized for performance) =====
  const searchCriteria = useMemo(() => ({
    checkIn: searchParams.get('checkIn'),
    checkOut: searchParams.get('checkOut'),
    adults: Math.max(1, parseInt(searchParams.get('adults'), 10) || 2),
    children: Math.max(0, parseInt(searchParams.get('children'), 10) || 0)
  }), [searchParams]);

  // Space tag definitions (memoized to prevent unnecessary re-renders)
  const SPACE_TAGS = useMemo(() => [
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
    { value: 'other', label: 'Other' }
  ], []);

  // Space order for display (memoized)
  const SPACE_ORDER = useMemo(() => ['bedroom', 'living_room', 'kitchen', 'dining', 'bathroom', 'outdoor', 'view', 'hot_tub_sauna', 'amenities', 'floorplan', 'map', 'other'], []);

  // Helper to get primary tag
  const getPrimaryTag = useCallback((img) => {
    return Array.isArray(img.tags) && img.tags.length > 0 ? img.tags[0] : null;
  }, []);

  // ===== E) All useMemo/useCallback hooks (ALL before early returns) =====
  // Image gallery logic with fallback - organized by space
  const gallery = useMemo(() => {
    if (!cabin) return [];
    const arr = Array.isArray(cabin.images) && cabin.images.length
      ? cabin.images.slice().sort((a, b) => {
          // Cover first
          if (b.isCover !== a.isCover) return b.isCover - a.isCover;
          // Then by space order
          const aTag = getPrimaryTag(a);
          const bTag = getPrimaryTag(b);
          if (aTag !== bTag) {
            const aIdx = aTag ? SPACE_ORDER.indexOf(aTag) : 999;
            const bIdx = bTag ? SPACE_ORDER.indexOf(bTag) : 999;
            if (aIdx !== bIdx) return aIdx - bIdx;
          }
          // Then by spaceOrder within space
          if (aTag === bTag && (a.spaceOrder !== undefined || b.spaceOrder !== undefined)) {
            const aOrder = a.spaceOrder || 0;
            const bOrder = b.spaceOrder || 0;
            if (aOrder !== bOrder) return aOrder - bOrder;
          }
          // Then by global sort
          if (a.sort !== b.sort) return a.sort - b.sort;
          // Finally by creation date
          return new Date(a.createdAt) - new Date(b.createdAt);
        })
      : (cabin?.imageUrl ? [{ url: cabin.imageUrl, alt: cabin.name || '' }] : []);
    return arr;
  }, [cabin, getPrimaryTag]);

  // Filtered gallery for lightbox
  const filteredGallery = useMemo(() => {
    if (!lightboxFilter || lightboxFilter === 'all') {
      return gallery;
    }
    return gallery.filter(img => getPrimaryTag(img) === lightboxFilter);
  }, [gallery, lightboxFilter, getPrimaryTag]);

  // Get available spaces with counts
  const spaceCounts = useMemo(() => {
    const counts = { all: gallery.length };
    gallery.forEach(img => {
      const tag = getPrimaryTag(img);
      if (tag) {
        counts[tag] = (counts[tag] || 0) + 1;
      }
    });
    return counts;
  }, [gallery, getPrimaryTag]);

  // Create a map of image ID to global index for O(1) lookup
  const imageIdToIndexMap = useMemo(() => {
    const map = new Map();
    gallery.forEach((img, idx) => {
      if (img._id) {
        map.set(img._id, idx);
      }
    });
    return map;
  }, [gallery]);

  // Group images by space for grid view
  const imagesBySpace = useMemo(() => {
    const grouped = {};
    filteredGallery.forEach(img => {
      const tag = getPrimaryTag(img) || 'other';
      if (!grouped[tag]) {
        grouped[tag] = [];
      }
      grouped[tag].push(img);
    });
    return grouped;
  }, [filteredGallery, getPrimaryTag]);

  // Get spaces to display (including 'other' if it has images)
  const spacesToDisplay = useMemo(() => {
    const spaces = SPACE_ORDER.filter(tag => imagesBySpace[tag] && imagesBySpace[tag].length > 0);
    // Add 'other' if it has images and isn't already in SPACE_ORDER
    if (imagesBySpace['other'] && imagesBySpace['other'].length > 0 && !SPACE_ORDER.includes('other')) {
      spaces.push('other');
    }
    return spaces;
  }, [imagesBySpace]);

  // Normalize image URLs - memoized callback
  const normalizeSrc = useCallback((u) => {
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith('/')) return u;
    return `/uploads/cabins/${u}`;
  }, []);

  // JSON-LD for SEO (must be before early returns)
  const jsonLd = useMemo(() => {
    if (!cabin) return '{}';
    const hasAgg = typeof cabin?.averageRating === 'number' && 
                   typeof cabin?.reviewsCount === 'number' && 
                   cabin.reviewsCount > 0;
    const data = {
      '@context': 'https://schema.org',
      '@type': 'LodgingBusiness',
      name: cabin?.name || '',
      description: cabin?.description || '',
      address: {
        '@type': 'PostalAddress',
        addressLocality: cabin?.location || ''
      },
      url: typeof window !== 'undefined' ? window.location.href : undefined,
      priceRange: `€${cabin?.pricePerNight || 0}`,
      numberOfRooms: 1
    };
    if (hasAgg) {
      data.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: Number(cabin.averageRating.toFixed(2)),
        reviewCount: cabin.reviewsCount,
        bestRating: 5,
        worstRating: 1
      };
    }
    if (cabin?.images && cabin.images.length > 0) {
      data.image = cabin.images.slice(0, 5).map(img => 
        typeof img === 'string' ? img : img.url
      );
    }
    return JSON.stringify(data);
  }, [cabin]);

  // SEO meta tags
  const pageTitle = useMemo(() => {
    if (!cabin) return 'Drift & Dwells';
    const name = cabin.name || 'Cabin';
    const location = cabin.location || '';
    return `${name}${location ? ` in ${location}` : ''} | Drift & Dwells`;
  }, [cabin]);

  const pageDescription = useMemo(() => {
    if (!cabin) return 'Book your perfect stay in nature';
    return (cabin.description || '').substring(0, 160) || 'Experience off-grid luxury in the heart of nature';
  }, [cabin]);

  const pageImage = useMemo(() => {
    if (!cabin) return '';
    if (cabin.images && cabin.images.length > 0) {
      const firstImg = cabin.images[0];
      return typeof firstImg === 'string' ? firstImg : firstImg.url;
    }
    return cabin.imageUrl || '';
  }, [cabin]);

  // Experiences available (from cabin or defaults)
  const experiences = useMemo(() => {
    const fromCabin = Array.isArray(cabin?.experiences) ? cabin.experiences.filter(x => x?.active !== false) : [];
    const list = (fromCabin.length ? fromCabin : DEFAULT_EXPERIENCES).slice().sort((a,b)=> (a.sortOrder||0)-(b.sortOrder||0));
    return list;
  }, [cabin?.experiences]);

  // Highlights
  const highlights = useMemo(() => {
    const fallback = [
      'Firepit + starry sky in a protected valley',
      'Off-grid comfort: wood stove, steaming hot tub',
      '1km protected walk-in → true seclusion'
    ];
    return Array.isArray(cabin?.highlights) && cabin.highlights.length ? cabin.highlights.slice(0,5) : fallback;
  }, [cabin?.highlights]);

  // Experience selection helpers
  const toggleExperience = useCallback((key) => {
    setSelectedExpKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const experienceTotal = useMemo(() => {
    let guests = (searchCriteria.adults || 0) + (searchCriteria.children || 0);
    return experiences.reduce((sum, exp) => {
      if (!selectedExpKeys.has(exp.key)) return sum;
      const qty = exp.unit === 'per_guest' ? Math.max(guests, 1) : 1;
      return sum + (exp.price || 0) * qty;
    }, 0);
  }, [experiences, selectedExpKeys, searchCriteria.adults, searchCriteria.children]);

  // Calculate pricing - memoized
  const pricing = useMemo(() => {
    if (!cabin || !searchCriteria.checkIn || !searchCriteria.checkOut || !cabin.pricePerNight) {
      return null;
    }
    
    try {
      const checkIn = new Date(searchCriteria.checkIn);
      const checkOut = new Date(searchCriteria.checkOut);
      
      // Validate dates
      if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) {
        return null;
      }
      
      // Ensure check-out is after check-in
      if (checkOut <= checkIn) {
        return null;
      }
      
      const totalNights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
      const totalGuests = (searchCriteria.adults || 0) + (searchCriteria.children || 0);
      let totalPrice = totalNights * cabin.pricePerNight;
      if ((cabin.pricingModel || 'per_night') === 'per_person') {
        totalPrice *= Math.max(totalGuests, 1);
      }
      
      return { totalNights, totalPrice };
    } catch {
      return null;
    }
  }, [cabin, searchCriteria.checkIn, searchCriteria.checkOut, searchCriteria.adults, searchCriteria.children]);

  // Lightbox handlers (singletons)
  const openLightbox = useCallback((startIdx = 0, filterTag = null, mode = 'grid') => {
    // Prevent opening if already open with same state (avoid duplicate updates)
    if (lightboxOpen && lightboxMode === mode && lightboxFilter === (filterTag || 'all')) {
      return;
    }
    
    lastTriggerRef.current = document.activeElement;
    
    // Set filter
    const finalFilter = filterTag && filterTag !== 'all' ? filterTag : 'all';
    setLightboxFilter(finalFilter);
    
    // Set index if provided (validate bounds)
    if (typeof startIdx === 'number' && startIdx >= 0 && gallery.length > 0) {
      const validIdx = Math.max(0, Math.min(startIdx, gallery.length - 1));
      setLightboxIndex(validIdx);
    } else {
      setLightboxIndex(0);
    }
    
    // Set mode
    setLightboxMode(mode);
    
    // Open lightbox
    setLightboxOpen(true);
    document.body.classList.add('lightbox-open');
    
    // Update URL (consolidated logic)
    const url = new URL(window.location);
    url.searchParams.set('photos', finalFilter);
    if (mode === 'viewer' && typeof startIdx === 'number' && startIdx >= 0 && gallery.length > 0) {
      const validIdx = Math.max(0, Math.min(startIdx, gallery.length - 1));
      url.searchParams.set('index', validIdx.toString());
    } else {
      url.searchParams.delete('index');
    }
    window.history.replaceState({}, '', url);
    
    // Focus close button after render (immediate since delay is 0)
    if (LIGHTBOX_FOCUS_DELAY_MS > 0) {
      setTimeout(() => {
        lightboxCloseBtnRef.current?.focus();
      }, LIGHTBOX_FOCUS_DELAY_MS);
    } else {
      // Use requestAnimationFrame for immediate focus after DOM update
      requestAnimationFrame(() => {
        lightboxCloseBtnRef.current?.focus();
      });
    }
  }, [gallery, lightboxOpen, lightboxMode, lightboxFilter]);

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    setLightboxMode('grid'); // Reset to grid mode
    document.body.classList.remove('lightbox-open');
    
    // Clear photo parameter from URL when closing
    const url = new URL(window.location);
    url.searchParams.delete('photos');
    url.searchParams.delete('index');
    window.history.replaceState({}, '', url);
    
    if (lastTriggerRef.current && typeof lastTriggerRef.current.focus === 'function') {
      lastTriggerRef.current.focus();
    }
  }, []);

  // Switch from grid to viewer mode
  const openImageViewer = useCallback((imageIndex) => {
    // Validate index
    if (gallery.length === 0) return;
    const validIndex = Math.max(0, Math.min(imageIndex, gallery.length - 1));
    
    // Save current scroll position
    if (gridContainerRef.current) {
      setGridScrollPosition(gridContainerRef.current.scrollTop);
    }
    
    // Switch to viewer mode
    setLightboxIndex(validIndex);
    setLightboxMode('viewer');
    
    // Update URL
    const url = new URL(window.location);
    if (lightboxFilter !== 'all') {
      url.searchParams.set('photos', lightboxFilter);
    } else {
      url.searchParams.set('photos', 'all');
    }
    url.searchParams.set('index', validIndex.toString());
    window.history.replaceState({}, '', url);
  }, [lightboxFilter, gallery.length]);

  // Switch from viewer back to grid mode
  const backToGrid = useCallback(() => {
    setLightboxMode('grid');
    
    // Update URL (remove index param)
    const url = new URL(window.location);
    url.searchParams.delete('index');
    window.history.replaceState({}, '', url);
    
    // Restore scroll position
    requestAnimationFrame(() => {
      if (gridContainerRef.current && gridScrollPosition > 0) {
        gridContainerRef.current.scrollTop = gridScrollPosition;
      }
    });
  }, [gridScrollPosition]);

  // Navigate lightbox (filter-aware)
  const goToPrevious = useCallback(() => {
    if (filteredGallery.length === 0) return;
    const currentImg = gallery[lightboxIndex];
    if (!currentImg?._id) return;
    
    const currentInFiltered = filteredGallery.findIndex(img => img._id === currentImg._id);
    if (currentInFiltered === -1) {
      // Current image not in filter, jump to last of filtered
      const lastImg = filteredGallery[filteredGallery.length - 1];
      const lastIdx = lastImg?._id ? (imageIdToIndexMap.get(lastImg._id) ?? 0) : 0;
      setLightboxIndex(Math.max(0, lastIdx));
      return;
    }
    const prevInFiltered = currentInFiltered === 0 ? filteredGallery.length - 1 : currentInFiltered - 1;
    const prevImg = filteredGallery[prevInFiltered];
    const prevIdx = prevImg?._id ? (imageIdToIndexMap.get(prevImg._id) ?? 0) : 0;
    setLightboxIndex(prevIdx);
  }, [lightboxIndex, gallery, filteredGallery, imageIdToIndexMap]);

  const goToNext = useCallback(() => {
    if (filteredGallery.length === 0) return;
    const currentImg = gallery[lightboxIndex];
    if (!currentImg?._id) return;
    
    const currentInFiltered = filteredGallery.findIndex(img => img._id === currentImg._id);
    if (currentInFiltered === -1) {
      // Current image not in filter, jump to first of filtered
      const firstImg = filteredGallery[0];
      const firstIdx = firstImg?._id ? (imageIdToIndexMap.get(firstImg._id) ?? 0) : 0;
      setLightboxIndex(Math.max(0, firstIdx));
      return;
    }
    const nextInFiltered = currentInFiltered === filteredGallery.length - 1 ? 0 : currentInFiltered + 1;
    const nextImg = filteredGallery[nextInFiltered];
    const nextIdx = nextImg?._id ? (imageIdToIndexMap.get(nextImg._id) ?? 0) : 0;
    setLightboxIndex(nextIdx);
  }, [lightboxIndex, gallery, filteredGallery, imageIdToIndexMap]);

  // Handle filter change
  const handleFilterChange = useCallback((tag) => {
    // Calculate the new filtered gallery based on the tag (before state update)
    const newFiltered = tag === 'all' 
      ? gallery 
      : gallery.filter(img => getPrimaryTag(img) === tag);
    
    // Update filter state first - this triggers filteredGallery recalculation via useMemo
    setLightboxFilter(tag);
    
    // Update the index based on filter
    if (tag === 'all') {
      // For "All", check if current image is in the full gallery
      const currentImg = gallery[lightboxIndex];
      if (currentImg && lightboxIndex >= 0 && lightboxIndex < gallery.length) {
        // Current image is valid in full gallery, keep index
        // No need to update
      } else {
        // Current index invalid, go to first
        setLightboxIndex(0);
      }
    } else {
      // For specific tag, find first image with this tag using the map
      if (newFiltered.length > 0 && newFiltered[0]._id) {
        const firstIdx = imageIdToIndexMap.get(newFiltered[0]._id) ?? 0;
        setLightboxIndex(Math.max(0, firstIdx));
      } else {
        setLightboxIndex(0);
      }
    }
    
    // Switch to grid mode if in viewer mode
    if (lightboxMode === 'viewer') {
      setLightboxMode('grid');
    }
    
    // Scroll to top of grid when filter changes (use double RAF for reliability)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (gridContainerRef.current) {
          gridContainerRef.current.scrollTop = 0;
        }
      });
    });
    
    // Update URL
    const url = new URL(window.location);
    url.searchParams.set('photos', tag === 'all' ? 'all' : tag);
    url.searchParams.delete('index'); // Remove index when changing filter
    window.history.replaceState({}, '', url);
  }, [gallery, lightboxIndex, lightboxMode, getPrimaryTag, imageIdToIndexMap]);

  // ===== F) All useEffect hooks (ALL before early returns) =====
  // SEO: Update document head
  useEffect(() => {
    if (!cabin) return;
    
    // Update title
    document.title = pageTitle;
    
    // Update or create meta tags
    const updateMetaTag = (name, content, isProperty = false) => {
      const attr = isProperty ? 'property' : 'name';
      let meta = document.querySelector(`meta[${attr}="${name}"]`);
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute(attr, name);
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', content);
    };
    
    updateMetaTag('description', pageDescription);
    updateMetaTag('og:title', pageTitle, true);
    updateMetaTag('og:description', pageDescription, true);
    updateMetaTag('og:type', 'website', true);
    updateMetaTag('og:url', window.location.href, true);
    if (pageImage) {
      updateMetaTag('og:image', pageImage, true);
    }
    updateMetaTag('twitter:card', 'summary_large_image');
    updateMetaTag('twitter:title', pageTitle);
    updateMetaTag('twitter:description', pageDescription);
    if (pageImage) {
      updateMetaTag('twitter:image', pageImage);
    }
    
    // Canonical link
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', window.location.href);
  }, [cabin, pageTitle, pageDescription, pageImage]);

  // Initialize saved state from localStorage
  useEffect(() => {
    if (!id) return;
    try {
      const raw = localStorage.getItem('savedCabins');
      const ids = raw ? JSON.parse(raw) : [];
      setIsSaved(Array.isArray(ids) && ids.includes(id));
    } catch (err) {
      console.warn('Failed to read saved cabins from localStorage:', err);
      setIsSaved(false);
    }
  }, [id]);

  // Load cabin details
  useEffect(() => {
    let cancelled = false;
    
    const loadCabin = async () => {
      if (!id) return;
      
      try {
        setLoading(true);
        setError(null);
        const response = await cabinAPI.getById(id);
        
        if (cancelled) return;
        
        if (response.data.success) {
          setCabin(response.data.data.cabin);
        } else {
          setError('Cabin not found');
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Load cabin error:', err);
        setError(err.response?.data?.message || 'Error loading cabin details');
      } finally {
        if (!cancelled) {
        setLoading(false);
        }
      }
    };

      loadCabin();
    
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Keyboard navigation and focus trap for lightbox
  useEffect(() => {
    if (!lightboxOpen) return;
    
    const handleKeyDown = (e) => {
      switch (e.key) {
        case 'Escape':
          if (lightboxMode === 'viewer') {
            backToGrid();
          } else {
          closeLightbox();
          }
          break;
        case 'ArrowLeft':
          if (lightboxMode === 'viewer') {
          e.preventDefault();
          goToPrevious();
          }
          break;
        case 'ArrowRight':
          if (lightboxMode === 'viewer') {
          e.preventDefault();
          goToNext();
          }
          break;
        case 'Tab': {
          // Trap focus within overlay
          const overlay = document.querySelector('[data-lightbox-overlay="true"]');
          if (!overlay) return;
          const focusables = overlay.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          const list = Array.from(focusables).filter(el => 
            !el.hasAttribute('disabled') && 
            !el.hasAttribute('aria-hidden') &&
            el.offsetParent !== null // Visible
          );
          if (list.length === 0) return;
          const first = list[0];
          const last = list[list.length - 1];
          const active = document.activeElement;
          if (e.shiftKey) {
            if (active === first || !overlay.contains(active)) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (active === last || !overlay.contains(active)) {
              e.preventDefault();
              first.focus();
            }
          }
          break;
        }
        default:
          break;
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [lightboxOpen, lightboxMode, goToPrevious, goToNext, closeLightbox, backToGrid]);

  // Anchor to reviews if hash present
  useEffect(() => {
    if (window.location.hash === '#guest-reviews') {
      const el = document.getElementById('guest-reviews');
      if (el) {
        const timeoutId = setTimeout(() => {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, SCROLL_DELAY_MS);
        return () => clearTimeout(timeoutId);
      }
    }
  }, [cabin]); // Re-run when cabin loads

  // Handle deep link for photos - auto-open lightbox with filter
  useEffect(() => {
    const photoParam = searchParams.get('photos');
    const indexParam = searchParams.get('index');
    
    // Only auto-open if we have photos, lightbox is closed, and we have a valid photo param
    if (photoParam && gallery.length > 0 && !lightboxOpen) {
      const validTag = SPACE_TAGS.find(t => t.value === photoParam);
      const index = indexParam ? parseInt(indexParam, 10) : 0;
      const mode = indexParam && index >= 0 ? 'viewer' : 'grid';
      
      // Use a small delay to ensure state is ready
      const timeoutId = setTimeout(() => {
        if (validTag) {
          // Auto-open lightbox with filter
          openLightbox(index >= 0 ? index : 0, photoParam, mode);
        } else if (photoParam === 'all') {
          // Open lightbox showing all photos
          openLightbox(index >= 0 ? index : 0, null, mode);
        }
      }, 50);
      
      return () => clearTimeout(timeoutId);
    }
  }, [searchParams, gallery.length, lightboxOpen, openLightbox, SPACE_TAGS]); // Only run when gallery loads and lightbox not already open

  // ===== G) Event handlers with useCallback (MUST be before early returns) =====
  // Toast state for save feedback
  const [saveToast, setSaveToast] = useState(false);

  const toggleSave = useCallback(() => {
    if (!cabin?._id) return;
    
    try {
      const raw = localStorage.getItem('savedCabins');
      const saved = raw ? JSON.parse(raw) : [];
      
      if (!Array.isArray(saved)) {
        throw new Error('Invalid saved cabins format');
      }
      
      const idx = saved.indexOf(cabin._id);
      let next = saved;
      const wasSaved = idx !== -1;
      
      if (idx === -1) {
        next = [...saved, cabin._id];
        setIsSaved(true);
        setSaveToast(true);
        setTimeout(() => setSaveToast(false), 2000);
      } else {
        next = saved.filter(id => id !== cabin._id);
        setIsSaved(false);
      }
      
      localStorage.setItem('savedCabins', JSON.stringify(next));
    } catch (err) {
      console.warn('Failed to save cabin:', err);
      // Don't update state on error
    }
  }, [cabin?._id]);

  const handleShare = useCallback(async () => {
    const shareUrl = window.location.href;
    const title = cabin?.name ? `${cabin.name} – Drift & Dwells` : 'Drift & Dwells';
    const text = cabin?.location ? `Stay in ${cabin.location}` : 'Book your stay';

    try {
      if (navigator.share && navigator.canShare?.({ title, text, url: shareUrl })) {
        await navigator.share({ title, text, url: shareUrl });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        // Could show a toast here in the future
      } else {
        // Fallback: select text
        const textArea = document.createElement('textarea');
        textArea.value = shareUrl;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand('copy');
        } catch {
          // Ignore
        }
        document.body.removeChild(textArea);
      }
    } catch (err) {
      // User cancelled share or unsupported - silent fail is fine
      if (err.name !== 'AbortError') {
        console.warn('Share failed:', err);
      }
    }
  }, [cabin?.name, cabin?.location]);

  // ===== I) Pure function handlers (not hooks - can be after early returns) =====
  // Handle form input changes
  const handleInputChange = useCallback((field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Clear error when user starts typing
    if (formErrors[field]) {
      setFormErrors(prev => ({
        ...prev,
        [field]: null
      }));
    }
  }, [formErrors]);

  // Validate form
  const validateForm = useCallback(() => {
    const errors = {};

    if (!formData.firstName.trim()) {
      errors.firstName = 'First name is required';
    }
    if (!formData.lastName.trim()) {
      errors.lastName = 'Last name is required';
    }
    if (!formData.email.trim()) {
      errors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Please enter a valid email address';
    }
    if (!formData.phone.trim()) {
      errors.phone = 'Phone number is required';
    } else if (!/^[\d\s\-\+\(\)]+$/.test(formData.phone)) {
      errors.phone = 'Please enter a valid phone number';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }, [formData]);

  // Handle selecting cabin for craft flow return
  const handleSelectCabinForCraft = useCallback(() => {
    if (!id || !searchCriteria.checkIn || !searchCriteria.checkOut) {
      setError('Please ensure check-in and check-out dates are selected');
      return;
    }
    
    // Save basic booking info to context
    setBasicInfo({
      cabinId: id,
      checkIn: searchCriteria.checkIn,
      checkOut: searchCriteria.checkOut,
      adults: searchCriteria.adults,
      children: searchCriteria.children
    });
    
    // Navigate back to craft flow
    if (returnTo) {
      navigate(`/${returnTo}`);
    } else {
      navigate('/craft/step-4');
    }
  }, [id, searchCriteria, setBasicInfo, navigate, returnTo]);

  // Handle starting the crafted experience wizard
  const handleStartCraftedExperience = useCallback(() => {
    if (!id || !searchCriteria.checkIn || !searchCriteria.checkOut) {
      setError('Please ensure check-in and check-out dates are selected');
      return;
    }
    
    // Save basic booking info to context
    setBasicInfo({
      cabinId: id,
      checkIn: searchCriteria.checkIn,
      checkOut: searchCriteria.checkOut,
      adults: searchCriteria.adults,
      children: searchCriteria.children
    });
    
    // Navigate to the wizard
    navigate('/craft/step-1');
  }, [id, searchCriteria, setBasicInfo, navigate]);

  // Handle booking submission
  const handleBookingSubmit = useCallback(async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      // Scroll to first error
      const firstErrorField = Object.keys(formErrors)[0];
      if (firstErrorField) {
        const errorElement = document.querySelector(`[name="${firstErrorField}"]`);
        errorElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        errorElement?.focus();
      }
      return;
    }

    if (!id || !searchCriteria.checkIn || !searchCriteria.checkOut) {
      setError('Please ensure check-in and check-out dates are selected');
      return;
    }

    try {
      setBookingLoading(true);
      setError(null);
      
      const bookingData = {
        cabinId: id,
        checkIn: searchCriteria.checkIn,
        checkOut: searchCriteria.checkOut,
        adults: searchCriteria.adults,
        children: searchCriteria.children,
        experiences: Array.from(selectedExpKeys).map(key => {
          const exp = experiences.find(e => e.key === key);
          const qty = exp?.unit === 'per_guest' ? (searchCriteria.adults + searchCriteria.children) : 1;
          return { key, quantity: qty, priceAtBooking: exp?.price || 0, currency: exp?.currency || 'BGN' };
        }),
        guestInfo: {
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          email: formData.email.trim(),
          phone: formData.phone.trim()
        },
        specialRequests: formData.specialRequests.trim()
      };

      const response = await bookingAPI.create(bookingData);
      
      if (response.data.success) {
        const bookingId = response.data.data?.booking?._id;
        setBookingSuccess(true);
        // Redirect to success page after a short delay with booking id
        if (bookingId) {
          setTimeout(() => {
            navigate(`/booking-success/${bookingId}`);
          }, BOOKING_SUCCESS_REDIRECT_MS);
        } else {
          // Fallback if no booking ID
          setTimeout(() => {
            navigate('/');
          }, BOOKING_SUCCESS_REDIRECT_MS);
        }
      } else {
        setError(response.data.message || 'Error creating booking. Please try again.');
      }
    } catch (err) {
      console.error('Booking error:', err);
      setError(err.response?.data?.message || 'Error creating booking. Please try again.');
    } finally {
      setBookingLoading(false);
    }
  }, [validateForm, formErrors, id, searchCriteria, formData, navigate]);

  // Format date helper
  const formatDate = useCallback((dateString) => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return '';
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      });
    } catch {
      return '';
    }
  }, []);

  // ===== H) Early returns (ONLY after ALL hooks are declared) =====
  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        <div className="cabin-container py-20">
          <div className="text-center py-20">
            <div 
              className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-sage"
              aria-label="Loading cabin details"
              role="status"
            >
              <span className="sr-only">Loading...</span>
            </div>
            <p className="mt-6 text-sm text-gray-600">Loading cabin details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error && !cabin) {
    return (
      <div className="min-h-screen bg-white">
        <div className="cabin-container py-20">
          <div className="text-center py-20">
            <h2 className="section-title mb-6">Error</h2>
            <p className="text-base text-gray-600 mb-12" role="alert">{error}</p>
            <button
              onClick={() => navigate('/')}
              className="btn-pill"
              aria-label="Return to homepage"
            >
              back to home →
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!cabin) {
    return null;
  }

  // ===== I) Render (all hooks have been called by this point) =====
  return (
    <div className="min-h-screen bg-white cabin-details-page pb-32 md:pb-0">
      <Seo
        title={`${cabin.name} | Drift & Dwells`}
        description={pageDescription}
        canonicalPath={`/cabin/${id}`}
        ogImage={pageImage}
        ogType="product"
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      
      {/* Save Toast */}
      {saveToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-[fadeIn_0.2s_ease-out]">
          <span className="text-sm font-medium">Saved to Trip List</span>
        </div>
      )}
      
      {/* Error banner (for non-fatal errors) */}
      {error && cabin && (
        <div className="bg-red-50 border-b border-red-200" role="alert">
          <div className="cabin-container py-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        </div>
      )}

      {/* Hero Section - OUTSIDE grid */}
      <div className="cabin-container">
        {/* Back Button */}
        <button
          onClick={() => navigate(-1)}
          className="btn-underline mb-8 mt-8"
          aria-label="Go back to previous page"
        >
          ← back to search results
        </button>

        {/* Title and Trust Stack */}
        <div className="space-y-2 mb-6">
          <h1 className="cabin-title">
            {cabin.name || 'Cabin'}
          </h1>

          {/* Trust stack + actions — Premium inline layout */}
          <div className="trust-row flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {/* Rating + count + badges — Bold score, microcopy format */}
            {typeof cabin.averageRating === 'number' && cabin.averageRating > 0 && (
              <>
                <span className="flex items-center gap-1">
                  <span className="text-amber-500" aria-hidden="true">★</span>
                  <span className="rating-score" aria-label={`Average rating: ${cabin.averageRating.toFixed(2)} out of 5`}>
                    {cabin.averageRating.toFixed(2)}
                  </span>
                </span>
                {cabin.reviewsCount > 0 && (
                  <>
                    <span className="text-gray-400">•</span>
                    <a 
                      href="#guest-reviews" 
                      className="text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline transition-colors"
                      aria-label={`${cabin.reviewsCount} ${cabin.reviewsCount === 1 ? 'review' : 'reviews'}`}
                    >
                      {cabin.reviewsCount} {cabin.reviewsCount === 1 ? 'review' : 'reviews'}
                    </a>
                  </>
                )}
                {/* Badges — Tiny muted pills after rating */}
                {cabin.badges?.superhost?.enabled && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="inline-flex items-center gap-0.5 bg-gray-50 px-1.5 py-0.5 rounded text-xs text-gray-500">
                      {cabin.badges.superhost.label?.trim() || 'Superhost'}
                    </span>
                  </>
                )}
                {cabin.badges?.guestFavorite?.enabled && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="inline-flex items-center gap-0.5 bg-gray-50 px-1.5 py-0.5 rounded text-xs text-gray-500">
                      {cabin.badges.guestFavorite.label?.trim() || 'Guest favorite'}
                    </span>
                  </>
                )}
              </>
            )}

            {/* Host */}
            {cabin.hostName?.trim() && (
              <>
                <span className="text-gray-400">•</span>
                <span className="text-gray-600">
                  Hosted by <span className="font-medium">{cabin.hostName.trim()}</span>
                </span>
              </>
            )}

            {/* Response time */}
            {(() => {
              const h = Number(cabin?.avgResponseTimeHours);
              let text = 'Avg reply 1–2h';
              if (!isNaN(h)) {
                if (h <= 1) text = 'Avg reply <1h';
                else if (h <= 2) text = 'Avg reply 1–2h';
                else if (h <= 6) text = 'Avg reply 2–6h';
              }
              return (
                <>
                  <span className="text-gray-400">•</span>
                  <span className="text-gray-600">{text}</span>
                </>
              );
            })()}

            {/* Actions */}
            <span className="ml-auto flex items-center gap-3">
              <button
                className={`inline-flex items-center gap-1 text-gray-700 hover:text-black transition-all focus:outline-none focus:ring-2 focus:ring-sage focus:ring-offset-2 rounded ${
                  isSaved ? 'animate-[spring_0.3s_ease-out]' : ''
                }`}
                onClick={toggleSave}
                aria-pressed={isSaved}
                aria-label={isSaved ? 'Remove from saved' : 'Save cabin'}
                style={{
                  transform: isSaved ? 'scale(1.1)' : 'scale(1)',
                  transition: 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)'
                }}
              >
                <svg 
                  width="16" 
                  height="16" 
                  viewBox="0 0 24 24" 
                  fill={isSaved ? 'currentColor' : 'none'} 
                  stroke="currentColor" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className={isSaved ? 'text-red-500' : ''}
                >
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                </svg>
                <span>{isSaved ? 'Saved' : 'Save'}</span>
              </button>
              <button
                className="inline-flex items-center gap-1 text-gray-700 hover:text-black transition-colors focus:outline-none focus:ring-2 focus:ring-sage focus:ring-offset-2 rounded" 
                onClick={handleShare}
                aria-label="Share cabin link"
              >
                <svg 
                  width="16" 
                  height="16" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="18" cy="5" r="3"></circle>
                  <circle cx="6" cy="12" r="3"></circle>
                  <circle cx="18" cy="19" r="3"></circle>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                </svg>
                <span>Share</span>
              </button>
            </span>
          </div>
            </div>

        {/* Cabin Image Gallery */}
        {gallery.length > 0 && (
          <div className="mt-6">
            <MosaicGallery
              images={gallery}
              onOpenLightbox={(index) => openLightbox(index, null, 'grid')}
            />
            {/* Preload hero image */}
            {gallery[0] && (
              <link rel="preload" as="image" href={normalizeSrc(gallery[0].url)} />
            )}
          </div>
        )}

        {/* Location and Description */}
        <div className="space-y-4 mt-6">
          {cabin.location && (
            <p className="text-sm text-gray-600 flex items-center">
              <span className="w-1.5 h-1.5 bg-sage rounded-full mr-2 flex-shrink-0" aria-hidden="true"></span>
                {cabin.location}
              </p>
          )}
          {cabin.description && (
            <p className="text-base text-gray-700 leading-relaxed">
                {cabin.description}
              </p>
          )}
        </div>

        {/* Why you'll love it (highlights) — Premium 2-column */}
        {highlights && highlights.length > 0 && (
          <div className="mt-12 md:mt-16">
            <h2 className="section-title mb-4">Why you'll love it</h2>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-y-2.5 gap-x-6 text-gray-700 text-base max-w-[65ch] md:max-w-none" style={{ lineHeight: '1.35' }}>
              {highlights.map((h, i) => (
                <li key={`hl-${i}`} className="flex items-start gap-2.5">
                  <span className="text-[#81887A] text-sm mt-[0.1em] flex-shrink-0" aria-hidden="true" style={{ fontSize: '15px' }}>✓</span>
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Craft Your Perfect Experience - Right under description */}
        <div className="mt-8 md:mt-10 p-5 bg-gradient-to-br from-sage/10 via-sage/5 to-white border-2 border-sage/30 rounded-xl shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 bg-sage/20 rounded-lg flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sage">
                <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
                <path d="M2 17l10 5 10-5"></path>
                <path d="M2 12l10 5 10-5"></path>
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-base font-bold text-gray-900 mb-1">
                Craft Your Perfect Experience
              </h3>
              <p className="text-xs text-gray-600 leading-relaxed mb-4">
                Let us personalize your stay with a guided experience tailored to your needs.
              </p>
              {returnTo ? (
                <button
                  type="button"
                  onClick={handleSelectCabinForCraft}
                  className="w-full bg-sage text-white py-3 px-4 rounded-lg text-sm font-semibold hover:bg-sage-dark transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
                  disabled={!searchCriteria.checkIn || !searchCriteria.checkOut}
                >
                  Select This Cabin →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartCraftedExperience}
                  className="w-full bg-sage text-white py-3 px-4 rounded-lg text-sm font-semibold hover:bg-sage-dark transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
                  disabled={!searchCriteria.checkIn || !searchCriteria.checkOut}
                >
                  Start Crafted Experience →
                </button>
              )}
            </div>
          </div>
            </div>

        {/* Amenities */}
        {cabin.amenities && cabin.amenities.length > 0 && (
          <div className="space-y-4 mt-12 md:mt-16">
            <h2 className="section-title" id="amenities">
              Amenities
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {cabin.amenities.map((amenity, index) => (
                <div key={`amenity-${index}`} className="flex items-center text-sm text-gray-600">
                  <span className="w-1.5 h-1.5 bg-sage rounded-full mr-2 flex-shrink-0" aria-hidden="true"></span>
                  <span>{amenity}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
      </div>

      {/* Two-column section: Reviews + Booking */}
      <section className="cabin-container details-grid mt-12 md:mt-16 mb-24" id="details">
        {/* LEFT: reviews column */}
        <div className="reviews-col">
          <h2 className="section-title" id="guest-reviews">
            Guest Reviews
          </h2>
          <ReviewsSection 
            cabinId={cabin._id}
            averageRating={cabin.averageRating}
            reviewCount={cabin.reviewsCount}
            hideHeading={true}
          />

          {/* Map & Arrival Section */}
          <MapArrival cabin={cabin} />
          </div>

        {/* RIGHT: booking aside */}
        <aside className="aside-sticky" aria-label="Booking information">
          <div className="booking-card rounded-2xl border border-gray-200 shadow-md bg-white">
            <h3 className="text-xl font-bold text-gray-900 mb-6">
                Booking Summary
            </h3>
              
            {pricing && (
              <div className="space-y-3 text-sm">
                {searchCriteria.checkIn && (
                  <div className="flex justify-between items-center py-2">
                    <span className="text-gray-600">Check-in</span>
                    <span className="font-medium text-gray-900">{formatDate(searchCriteria.checkIn)}</span>
                </div>
                )}
                {searchCriteria.checkOut && (
                  <div className="flex justify-between items-center py-2">
                    <span className="text-gray-600">Check-out</span>
                    <span className="font-medium text-gray-900">{formatDate(searchCriteria.checkOut)}</span>
                </div>
                )}
                <div className="flex justify-between items-center py-2">
                  <span className="text-gray-600">Guests</span>
                  <span className="font-medium text-gray-900">
                    {searchCriteria.adults} {searchCriteria.adults === 1 ? 'Adult' : 'Adults'}
                    {searchCriteria.children > 0 && (
                      <span>, {searchCriteria.children} {searchCriteria.children === 1 ? 'Child' : 'Children'}</span>
                    )}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-gray-600">Nights</span>
                  <span className="font-medium text-gray-900">{pricing.totalNights}</span>
                </div>
                {cabin.pricePerNight && (
                  <div className="flex justify-between items-center py-2">
                    <span className="text-gray-600">Price per night</span>
                    <span className="font-medium text-gray-900 tabular-nums">
                      €{cabin.pricePerNight.toLocaleString()} / night
                      {(cabin.pricingModel || 'per_night') === 'per_person' ? ' per person' : ''}
                    </span>
                  </div>
                )}
                {/* Experience add-ons */}
                {experiences.length > 0 && (
                  <div className="py-3">
                    <div className="text-sm font-semibold text-gray-900 mb-2">Experience add-ons</div>
                    <div className="flex flex-wrap gap-2">
                      {experiences.map(exp => {
                        const selected = selectedExpKeys.has(exp.key);
                        const guests = (searchCriteria.adults || 0) + (searchCriteria.children || 0);
                        const qty = exp.unit === 'per_guest' ? Math.max(guests, 1) : 1;
                        const showQty = exp.unit === 'per_guest' && guests > 1;
                        return (
                          <div key={exp.key} className="relative group">
                            <button
                              type="button"
                              onClick={() => toggleExperience(exp.key)}
                              className={`px-3 py-1.5 rounded-full text-sm inline-flex items-center gap-2 border ${selected ? 'bg-[#81887A] text-white border-[#81887A]' : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'}`}
                              aria-pressed={selected}
                            >
                              <span>{exp.name}</span>
                              {showQty && <span className="text-xs opacity-70">×{qty}</span>}
                              <span className="opacity-80">· {exp.price} {exp.currency}</span>
                            </button>
                            {/* Tooltip */}
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                              {exp.name}
                              {exp.unit === 'per_guest' && ` (per guest)`}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
                )}

                <div className="border-t border-gray-200 pt-3 mt-3">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-sm">Total</span>
                    <span className="font-semibold text-base text-gray-900 tabular-nums">€{(pricing.totalPrice + (experienceTotal || 0)).toLocaleString()}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    {pricing.totalNights} {pricing.totalNights === 1 ? 'night' : 'nights'}
                    {experienceTotal > 0 && (
                      <span className="text-green-700 font-medium"> • Includes add-ons: €{experienceTotal.toLocaleString()}</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {!pricing && (
              <p className="text-sm text-gray-500 py-4">
                Please select check-in and check-out dates to see pricing.
              </p>
            )}

            {/* Booking Form */}
            {bookingSuccess ? (
              <div className="mt-6 p-4 text-center" role="alert">
                <h2 className="text-base font-semibold mb-3">
                  Booking Submitted!
                </h2>
                <p className="text-sm text-gray-600">
                  Your booking request has been submitted successfully. 
                  We'll contact you shortly to confirm your reservation.
                </p>
              </div>
            ) : (
              <form onSubmit={handleBookingSubmit} className="mt-6 space-y-4" noValidate>
                <h2 className="text-base font-semibold mb-4">
                  Guest Information
                </h2>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="firstName" className="label-editorial">
                      First Name *
                    </label>
                    <input
                      id="firstName"
                      name="firstName"
                      type="text"
                      value={formData.firstName}
                      onChange={(e) => handleInputChange('firstName', e.target.value)}
                      className={`input-editorial ${formErrors.firstName ? 'border-red-500' : ''}`}
                      placeholder="First name"
                      aria-invalid={!!formErrors.firstName}
                      aria-describedby={formErrors.firstName ? 'firstName-error' : undefined}
                      required
                    />
                    {formErrors.firstName && (
                      <p id="firstName-error" className="text-red-500 text-xs mt-1" role="alert">
                        {formErrors.firstName}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="lastName" className="label-editorial">
                      Last Name *
                    </label>
                    <input
                      id="lastName"
                      name="lastName"
                      type="text"
                      value={formData.lastName}
                      onChange={(e) => handleInputChange('lastName', e.target.value)}
                      className={`input-editorial ${formErrors.lastName ? 'border-red-500' : ''}`}
                      placeholder="Last name"
                      aria-invalid={!!formErrors.lastName}
                      aria-describedby={formErrors.lastName ? 'lastName-error' : undefined}
                      required
                    />
                    {formErrors.lastName && (
                      <p id="lastName-error" className="text-red-500 text-xs mt-1" role="alert">
                        {formErrors.lastName}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="email" className="label-editorial">
                    Email *
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    className={`input-editorial ${formErrors.email ? 'border-red-500' : ''}`}
                    placeholder="Email"
                    aria-invalid={!!formErrors.email}
                    aria-describedby={formErrors.email ? 'email-error' : undefined}
                    required
                  />
                  {formErrors.email && (
                    <p id="email-error" className="text-red-500 text-xs mt-1" role="alert">
                      {formErrors.email}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="phone" className="label-editorial">
                    Phone Number *
                  </label>
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => handleInputChange('phone', e.target.value)}
                    className={`input-editorial ${formErrors.phone ? 'border-red-500' : ''}`}
                    placeholder="Phone number"
                    aria-invalid={!!formErrors.phone}
                    aria-describedby={formErrors.phone ? 'phone-error' : undefined}
                    required
                  />
                  {formErrors.phone && (
                    <p id="phone-error" className="text-red-500 text-xs mt-1" role="alert">
                      {formErrors.phone}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="specialRequests" className="label-editorial">
                    Special Requests
                  </label>
                  <textarea
                    id="specialRequests"
                    name="specialRequests"
                    value={formData.specialRequests}
                    onChange={(e) => handleInputChange('specialRequests', e.target.value)}
                    className="input-editorial h-20 resize-none"
                    placeholder="Any special requests or notes..."
                  />
                </div>

                <div className="relative py-3" aria-hidden="true">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-300" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-4 bg-white text-gray-500 font-light">or</span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={bookingLoading || !pricing}
                  className="w-full h-11 rounded-xl bg-[#81887A] text-white font-semibold hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#81887A] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                  aria-label={bookingLoading ? 'Submitting booking request' : (pricing ? 'Request to book' : 'Select dates')}
                >
                  {bookingLoading ? 'Submitting...' : (pricing ? 'Request to book →' : 'Select dates')}
                </button>

                <p className="text-xs text-gray-500 text-center font-light leading-relaxed pt-2">
                  By submitting this form, you agree to our terms and conditions. 
                  We'll contact you within 24 hours to confirm your booking.
                </p>
              </form>
            )}
          </div>
        </aside>
      </section>

      {/* Lightbox — Grid Mode & Viewer Mode */}
      {lightboxOpen && gallery.length > 0 && (
        <div 
          className="fixed inset-0 bg-white z-50 flex flex-col"
          data-lightbox-overlay="true"
          role="dialog"
          aria-modal="true"
          aria-label={lightboxMode === 'grid' ? 'Photo gallery grid' : 'Photo viewer'}
        >
          {/* Sticky Header */}
          <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-gray-200 z-40 shadow-sm">
            <div className="relative flex items-center justify-between px-4 py-3 md:px-6">
              {/* Left: Back button (only in viewer mode) */}
              <div className="flex-shrink-0 w-32">
                {lightboxMode === 'viewer' && (
                  <button
                    onClick={backToGrid}
                    className="text-gray-600 hover:text-gray-900 text-sm flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-[#81887A] rounded px-2 py-1 transition-colors whitespace-nowrap"
                    aria-label="Back to grid"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M19 12H5M12 19l-7-7 7-7"/>
                    </svg>
                    Back to grid
                  </button>
                )}
              </div>

              {/* Center: Title */}
              <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center gap-4">
                <h2 className="text-gray-900 font-semibold text-lg md:text-xl whitespace-nowrap text-center">
                  {lightboxFilter === 'all' 
                    ? `All photos (${filteredGallery.length})`
                    : `${SPACE_TAGS.find(t => t.value === lightboxFilter)?.label || lightboxFilter} (${spaceCounts[lightboxFilter] || 0})`
                  }
                </h2>
              </div>

              {/* Right: Actions */}
              <div className="flex items-center gap-2 flex-shrink-0 w-32 justify-end">
                <button
                  className="text-gray-600 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#81887A] rounded-full p-2 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleShare();
                  }}
                  aria-label="Share"
                  title="Share"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="18" cy="5" r="3"></circle>
                    <circle cx="6" cy="12" r="3"></circle>
                    <circle cx="18" cy="19" r="3"></circle>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                  </svg>
                </button>
                <button
                  ref={lightboxCloseBtnRef}
                  className="text-gray-600 text-2xl hover:text-gray-900 z-30 focus:outline-none focus:ring-2 focus:ring-[#81887A] rounded-full p-2 w-10 h-10 flex items-center justify-center transition-colors"
                  onClick={closeLightbox}
                  aria-label="Close gallery"
                >
                  ×
                </button>
              </div>
            </div>

            {/* Center: Filter Chips (Desktop) */}
            {lightboxMode === 'grid' && (
              <div className="hidden md:block border-t border-gray-100">
                <div className="flex items-center justify-center gap-2.5 px-4 md:px-6 py-2.5 overflow-x-auto scrollbar-hide">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleFilterChange('all');
                  }}
                  className={`px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200 whitespace-nowrap flex-shrink-0 min-w-fit focus:outline-none focus:ring-2 focus:ring-[#81887A] focus:ring-offset-2 ${
                    lightboxFilter === 'all'
                      ? 'bg-[#81887A] text-white shadow-md shadow-[#81887A]/20'
                      : 'bg-white text-gray-700 border border-gray-200 hover:border-gray-300 hover:bg-gray-50 shadow-sm'
                  }`}
                  aria-pressed={lightboxFilter === 'all'}
                >
                  All ({spaceCounts.all || gallery.length})
                </button>
                {SPACE_TAGS.map(tag => {
                  const count = spaceCounts[tag.value] || 0;
                  if (count === 0) return null;
                  return (
                    <button
                      key={tag.value}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFilterChange(tag.value);
                      }}
                      className={`px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200 whitespace-nowrap flex-shrink-0 min-w-fit focus:outline-none focus:ring-2 focus:ring-[#81887A] focus:ring-offset-2 ${
                        lightboxFilter === tag.value
                          ? 'bg-[#81887A] text-white shadow-md shadow-[#81887A]/20'
                          : 'bg-white text-gray-700 border border-gray-200 hover:border-gray-300 hover:bg-gray-50 shadow-sm'
                      }`}
                      aria-pressed={lightboxFilter === tag.value}
                    >
                      {tag.label} ({count})
                    </button>
                  );
                })}
                </div>
              </div>
            )}
          </div>

          {/* Mobile: Filter Chips (Scrollable) */}
          {lightboxMode === 'grid' && (
            <div className="md:hidden sticky top-[60px] bg-white/95 backdrop-blur-sm border-b border-gray-200 z-30 px-4 py-3 overflow-x-auto shadow-sm scrollbar-hide">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    handleFilterChange('all');
                  }}
                  className={`px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200 whitespace-nowrap flex-shrink-0 min-w-fit focus:outline-none focus:ring-2 focus:ring-[#81887A] focus:ring-offset-2 ${
                    lightboxFilter === 'all'
                      ? 'bg-[#81887A] text-white shadow-md shadow-[#81887A]/20'
                      : 'bg-white text-gray-700 border border-gray-200 hover:border-gray-300 hover:bg-gray-50 shadow-sm'
                  }`}
                  aria-pressed={lightboxFilter === 'all'}
                >
                  All ({spaceCounts.all || gallery.length})
                </button>
                {SPACE_TAGS.map(tag => {
                  const count = spaceCounts[tag.value] || 0;
                  if (count === 0) return null;
                  return (
                    <button
                      key={tag.value}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFilterChange(tag.value);
                      }}
                      className={`px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200 whitespace-nowrap flex-shrink-0 min-w-fit focus:outline-none focus:ring-2 focus:ring-[#81887A] focus:ring-offset-2 ${
                        lightboxFilter === tag.value
                          ? 'bg-[#81887A] text-white shadow-md shadow-[#81887A]/20'
                          : 'bg-white text-gray-700 border border-gray-200 hover:border-gray-300 hover:bg-gray-50 shadow-sm'
                      }`}
                      aria-pressed={lightboxFilter === tag.value}
                    >
                      {tag.label} ({count})
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Focus trap */}
          <span 
            tabIndex="0" 
            aria-hidden="true" 
            onFocus={() => lightboxCloseBtnRef.current?.focus()} 
            className="sr-only"
          />

          {/* Grid Mode */}
          {lightboxMode === 'grid' && filteredGallery.length > 0 && (
            <div 
              ref={gridContainerRef}
              data-grid-container
              className="flex-1 overflow-y-auto"
              onClick={(e) => {
                // Only close if clicking the backdrop (not images)
                if (e.target === e.currentTarget) {
                  closeLightbox();
                }
              }}
            >
              <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
                {lightboxFilter === 'all' ? (
                  // Grouped by space with headers
                  spacesToDisplay.map(spaceTag => {
                    const spaceImages = imagesBySpace[spaceTag] || [];
                    if (spaceImages.length === 0) return null;
                    
                    const spaceLabel = SPACE_TAGS.find(t => t.value === spaceTag)?.label || spaceTag;
                    
                    return (
                      <div key={spaceTag} id={`space-${spaceTag}`} className="mb-12 md:mb-16">
                        <h3 
                          className="text-gray-900 text-lg md:text-xl font-semibold mb-4 md:mb-6"
                          id={`space-header-${spaceTag}`}
                        >
                          {spaceLabel} • {spaceImages.length} {spaceImages.length === 1 ? 'photo' : 'photos'}
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-2 md:gap-4">
                          {spaceImages.map((img, idx) => {
                            const globalIndex = img._id ? (imageIdToIndexMap.get(img._id) ?? 0) : 0;
                            return (
                              <button
                                key={img._id || `img-${spaceTag}-${idx}`}
                                onClick={() => openImageViewer(globalIndex)}
                                className="relative aspect-[4/3] overflow-hidden rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A] group shadow-sm hover:shadow-md transition-shadow"
                                aria-label={`${img.alt || spaceLabel} photo ${idx + 1}`}
                              >
                                <img
                                  src={normalizeSrc(img.url)}
                                  alt={img.alt || `${spaceLabel} photo ${idx + 1}`}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                  loading="lazy"
                                  decoding="async"
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                                  <span className="opacity-0 group-hover:opacity-100 text-gray-900 text-sm font-medium transition-opacity bg-white/90 px-3 py-1.5 rounded-full">
                                    View
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  // Single space grid (no headers)
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-2 md:gap-4">
                    {filteredGallery.map((img, idx) => {
                      const globalIndex = img._id ? (imageIdToIndexMap.get(img._id) ?? 0) : 0;
                      return (
                        <button
                          key={img._id || `img-filtered-${idx}`}
                          onClick={() => openImageViewer(globalIndex)}
                          className="relative aspect-[4/3] overflow-hidden rounded-lg focus:outline-none focus:ring-2 focus:ring-[#81887A] group shadow-sm hover:shadow-md transition-shadow"
                          aria-label={`${img.alt || 'Photo'} ${idx + 1}`}
                        >
                          <img
                            src={normalizeSrc(img.url)}
                            alt={img.alt || `Photo ${idx + 1}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                            decoding="async"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                            <span className="opacity-0 group-hover:opacity-100 text-gray-900 text-sm font-medium transition-opacity bg-white/90 px-3 py-1.5 rounded-full">
                              View
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Empty state for grid */}
          {lightboxMode === 'grid' && filteredGallery.length === 0 && (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-gray-500 text-lg">No photos found for this filter.</p>
            </div>
          )}

          {/* Viewer Mode */}
          {lightboxMode === 'viewer' && filteredGallery.length > 0 && (
            <div className="flex-1 flex items-center justify-center relative bg-gray-50">
              {filteredGallery.length > 1 && (
            <>
              <button
                    className="absolute left-4 text-gray-700 text-4xl hover:text-gray-900 z-10 focus:outline-none focus:ring-2 focus:ring-[#81887A] rounded-full p-2 bg-white/80 hover:bg-white shadow-md transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  goToPrevious();
                }}
                    aria-label={`Previous image${lightboxFilter !== 'all' ? ` in ${SPACE_TAGS.find(t => t.value === lightboxFilter)?.label || lightboxFilter}` : ''}`}
              >
                ‹
              </button>
              <button
                    className="absolute right-4 text-gray-700 text-4xl hover:text-gray-900 z-10 focus:outline-none focus:ring-2 focus:ring-[#81887A] rounded-full p-2 bg-white/80 hover:bg-white shadow-md transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  goToNext();
                }}
                    aria-label={`Next image${lightboxFilter !== 'all' ? ` in ${SPACE_TAGS.find(t => t.value === lightboxFilter)?.label || lightboxFilter}` : ''}`}
              >
                ›
              </button>
            </>
          )}

          <div 
            className="relative max-w-7xl max-h-[90vh] mx-4"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => {
              const touch = e.touches[0];
              const startX = touch.clientX;
              const startY = touch.clientY;
              
              const handleTouchEnd = (e2) => {
                const touch2 = e2.changedTouches[0];
                if (!touch2) return;
                
                const deltaX = touch2.clientX - startX;
                const deltaY = touch2.clientY - startY;
                
                if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
                  if (deltaX > 0) {
                    goToPrevious();
                  } else {
                    goToNext();
                  }
                }
              };
              
              document.addEventListener('touchend', handleTouchEnd, { once: true });
            }}
          >
                {(() => {
                  const currentImg = gallery[lightboxIndex];
                  if (!currentImg || filteredGallery.length === 0) {
                    // Fallback if current image is invalid
                    const fallbackImg = filteredGallery[0] || gallery[0];
                    return fallbackImg ? (
                      <>
                        <img
                          src={normalizeSrc(fallbackImg.url || '')}
                          alt={fallbackImg.alt || 'Image'}
                          className="max-w-full max-h-[90vh] object-contain"
                          loading="eager"
                          draggable="false"
                        />
                        {fallbackImg.alt && (
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-gray-900/90 via-gray-900/70 to-transparent p-6">
                            <p className="text-white text-sm mb-2 font-medium">{fallbackImg.alt}</p>
                          </div>
                        )}
                      </>
                    ) : null;
                  }
                  
                  // Use map for faster lookup
                  const currentImgId = currentImg._id;
                  const currentInFiltered = currentImgId 
                    ? filteredGallery.findIndex(img => img._id === currentImgId)
                    : -1;
                  const displayImg = currentInFiltered >= 0 ? filteredGallery[currentInFiltered] : (filteredGallery[0] || currentImg);
                  const displayIndex = currentInFiltered >= 0 ? currentInFiltered : 0;
                  
                  return (
                    <>
                      <img
                        src={normalizeSrc(displayImg?.url || '')}
                        alt={displayImg?.alt || `Image ${displayIndex + 1} of ${filteredGallery.length}`}
                        className="max-w-full max-h-[90vh] object-contain"
                        loading="eager"
                        draggable="false"
                      />
                      
                      {(displayImg?.alt || filteredGallery.length > 1) && (
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-gray-900/90 via-gray-900/70 to-transparent p-6">
                          {displayImg?.alt && (
                            <p className="text-white text-sm mb-2 font-medium">{displayImg.alt}</p>
                          )}
                          {filteredGallery.length > 1 && (
                            <p className="text-white/90 text-xs font-medium">
                              {displayIndex + 1} / {filteredGallery.length}
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

          {/* Empty state for viewer */}
          {lightboxMode === 'viewer' && filteredGallery.length === 0 && (
            <div className="flex-1 flex items-center justify-center bg-gray-50">
              <p className="text-gray-500 text-lg">No photos found for this filter.</p>
            </div>
          )}
        </div>
      )}

      <StickyBookingBar
        className="md:hidden"
        label={
          pricing
            ? `€${(pricing.totalPrice + (experienceTotal || 0)).toLocaleString()} total`
            : 'Select dates to see pricing'
        }
        subLabel={
          pricing
            ? `${pricing.totalNights} ${pricing.totalNights === 1 ? 'night' : 'nights'}`
            : undefined
        }
        buttonLabel={searchCriteria.checkIn && searchCriteria.checkOut ? 'Request to book' : 'Select dates'}
        onButtonClick={() => {
          if (!searchCriteria.checkIn || !searchCriteria.checkOut) {
            setMobileDateDrawerOpen(true);
          } else {
            document.getElementById('details')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }}
      />
    </div>
  );
};

export default CabinDetails;
