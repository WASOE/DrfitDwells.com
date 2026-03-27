import { motion } from 'framer-motion';
import { useState, useRef, useEffect } from 'react';
import { Mountain, Flame, Trees, Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';
import { getSEOAlt } from '../../../data/imageMetadata';

const EditorialHookSection = () => {
  const editorialImages = [
    {
      path: '/uploads/Content website/drift-dwells-bulgaria-fireside-lounge.avif',
      encoded: '/uploads/Content%20website/drift-dwells-bulgaria-fireside-lounge.avif',
      alt: 'Communal fireside lounge interior at The Valley Stone House showing fireplace, comfortable seating, and cozy gathering space for guests, Rhodope Mountains',
      caption: 'The communal Stone House at The Valley, a shared gathering space for guests to connect, cook, and relax together.'
    },
    {
      path: '/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.23 AM.jpeg',
      encoded: '/uploads/The%20Valley/WhatsApp%20Image%202025-10-17%20at%2010.20.23%20AM.jpeg',
      alt: 'Panoramic landscape view of The Valley mountain village showing Stone House, A-frame cabins, and forest backdrop at 1,550m altitude, Rhodope Mountains, Bulgaria',
      caption: 'The Valley at 1,550m altitude, a mountain village where each stay is private but the land is shared.'
    },
    {
      path: '/uploads/The Valley/1768207815-2996ea84.jpg',
      encoded: '/uploads/The%20Valley/1768207815-2996ea84.jpg',
      alt: 'Panoramic summer view of The Valley mountain village at 1,550m altitude showing A-frame cabins, Stone House, and shared spaces, Rhodope Mountains, Bulgaria',
      caption: 'A small, walkable mountain village where each stay is private, but the land itself is shared.'
    }
  ];

  // Initialize currentSlide to middle image
  const [currentSlide, setCurrentSlide] = useState(Math.floor(editorialImages.length / 2));
  const carouselRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const scrollLeft = useRef(0);

  const highlights = [
    { icon: Mountain, title: 'Altitude and views', text: '1,550m above sea level. Panoramic mountain vistas.' },
    { icon: Flame, title: 'Fire, hot tub, stargazing', text: 'Communal fire pit, hot tub, exceptional stargazing.' },
    { icon: Trees, title: 'Adventure base', text: 'ATV trails, hiking routes, mountain exploration.' },
    { icon: Sparkles, title: 'Quiet, privacy, nature', text: 'Space, silence, autonomy. Everything works.' }
  ];

  // Initialize slider to center (middle image) without scrolling the page
  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel || editorialImages.length === 0) return;

    const initializeSlider = () => {
      const middleIndex = Math.floor(editorialImages.length / 2);
      const middleSlide = carousel.querySelector(`[data-slide="${middleIndex}"]`);
      const slideWidth = middleSlide?.offsetWidth || carousel.offsetWidth * 0.85;
      carousel.scrollLeft = middleIndex * slideWidth;
      setCurrentSlide(middleIndex);
    };

    const timer = setTimeout(initializeSlider, 100);
    return () => clearTimeout(timer);
  }, [editorialImages.length]);

  // Track carousel scroll position
  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    const handleScroll = () => {
      const scrollLeft = carousel.scrollLeft;
      const containerWidth = carousel.offsetWidth;
      const slideWidth = containerWidth * 0.85; // Mobile width percentage
      const slideIndex = Math.round(scrollLeft / slideWidth);
      setCurrentSlide(Math.min(Math.max(0, slideIndex), editorialImages.length - 1));
    };

    carousel.addEventListener('scroll', handleScroll);
    handleScroll(); // Initial call
    return () => carousel.removeEventListener('scroll', handleScroll);
  }, [editorialImages.length]);

  // Mouse drag functionality for desktop
  const handleMouseDown = (e) => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    setIsDragging(true);
    startX.current = e.pageX - carousel.offsetLeft;
    scrollLeft.current = carousel.scrollLeft;
    carousel.style.cursor = 'grabbing';
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const carousel = carouselRef.current;
    if (!carousel) return;
    const x = e.pageX - carousel.offsetLeft;
    const walk = (x - startX.current) * 2;
    carousel.scrollLeft = scrollLeft.current - walk;
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    const carousel = carouselRef.current;
    if (carousel) {
      carousel.style.cursor = 'grab';
    }
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
    const carousel = carouselRef.current;
    if (carousel) {
      carousel.style.cursor = 'grab';
    }
  };

  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;

    carousel.addEventListener('mousedown', handleMouseDown);
    carousel.addEventListener('mouseleave', handleMouseLeave);
    carousel.addEventListener('mouseup', handleMouseUp);
    carousel.addEventListener('mousemove', handleMouseMove);
    carousel.style.cursor = 'grab';

    return () => {
      carousel.removeEventListener('mousedown', handleMouseDown);
      carousel.removeEventListener('mouseleave', handleMouseLeave);
      carousel.removeEventListener('mouseup', handleMouseUp);
      carousel.removeEventListener('mousemove', handleMouseMove);
    };
  }, [isDragging]);

  // Navigation functions
  const goToSlide = (index) => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    const slide = carousel.querySelector(`[data-slide="${index}"]`);
    if (slide) {
      slide.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  };

  const nextSlide = () => {
    const next = (currentSlide + 1) % editorialImages.length;
    goToSlide(next);
  };

  const prevSlide = () => {
    const prev = (currentSlide - 1 + editorialImages.length) % editorialImages.length;
    goToSlide(prev);
  };

  return (
    <section className="valley-section">
      <div className="valley-container">
        {/* H2 - Section Title */}
        <h2 className="valley-h2 mb-5" style={{ fontSize: '48px', fontWeight: 800 }}>
          <style>{`
            @media (max-width: 768px) {
              .valley-h2 {
                font-size: 34px !important;
              }
            }
          `}</style>
          The Secret Valley
        </h2>

        {/* Editorial Lead Line */}
        <p className="font-['Montserrat'] text-[#1a1a1a] mb-8 max-w-[32ch] editorial-lead" style={{ fontSize: '22px', fontWeight: 500 }}>
          <style>{`
            @media (min-width: 1024px) {
              .editorial-lead {
                font-size: 28px !important;
              }
            }
          `}</style>
          A mountain village where each stay is private, but the land is shared.
        </p>

        {/* Body Text - Split Layout with Vertical Divider */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-12 relative">
          {/* Left: Story */}
          <div>
            <p className="font-['Montserrat'] text-[#1a1a1a] mb-6" style={{ fontSize: '16px', fontWeight: 400, lineHeight: '1.55', maxWidth: '56ch' }}>
              Several cabins, a stone house, and shared outdoor spaces. Private stays, shared land.
            </p>
            
            {/* GIF — aspect ratio on wrapper + cover avoids letterboxing from img box vs intrinsic AR mismatch */}
            <div
              className="relative w-full overflow-hidden rounded-xl bg-[#e8e8e8]"
              style={{ aspectRatio: '16 / 9' }}
            >
              <img
                src="/uploads/The%20Valley/Screencastfrom2024-09-3022-01-26-ezgif.com-video-to-gif-converter-1-1.gif"
                alt="The Valley animated overview showing mountain village layout, A-frame cabins, and natural landscape"
                className="absolute inset-0 h-full w-full object-cover object-center"
                loading="lazy"
              />
            </div>
          </div>
          
          {/* Vertical Divider (hidden on mobile) */}
          <div className="hidden lg:block absolute left-1/2 top-0 bottom-0 w-px bg-[rgba(0,0,0,0.12)]" />
          
          {/* Right: Highlights */}
          <div className="lg:pl-12">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {highlights.map((item, index) => {
                const Icon = item.icon;
                return (
                  <div key={index} className="flex items-start gap-4 pb-6 border-b border-[rgba(0,0,0,0.08)] last:pb-0 last:border-0">
                    <Icon className="w-5 h-5 text-[#81887A] flex-shrink-0 mt-0.5" strokeWidth={1.5} />
                    <div>
                      <h3 className="font-['Montserrat'] text-[#1a1a1a] mb-1.5 text-base" style={{ fontWeight: 600 }}>{item.title}</h3>
                      <p className="font-['Montserrat'] text-[#4a4a4a]" style={{ fontSize: '15px', fontWeight: 400, opacity: 0.7 }}>{item.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Modern Image Slider - Full Width Edge-to-Edge */}
        <div className="relative w-screen left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] mb-6">
          {/* Navigation Arrows */}
          <button
            onClick={prevSlide}
            className="absolute left-6 top-1/2 -translate-y-1/2 z-10 bg-white/90 hover:bg-white rounded-full p-2 shadow-lg transition-all duration-200 hover:scale-110 hidden md:flex items-center justify-center"
            aria-label="Previous slide"
          >
            <ChevronLeft className="w-6 h-6 text-[#1a1a1a]" />
          </button>
          <button
            onClick={nextSlide}
            className="absolute right-6 top-1/2 -translate-y-1/2 z-10 bg-white/90 hover:bg-white rounded-full p-2 shadow-lg transition-all duration-200 hover:scale-110 hidden md:flex items-center justify-center"
            aria-label="Next slide"
          >
            <ChevronRight className="w-6 h-6 text-[#1a1a1a]" />
          </button>

          {/* Carousel Container */}
          <div 
            ref={carouselRef}
            className="overflow-x-auto snap-x snap-mandatory scrollbar-hide select-none"
            style={{
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              WebkitOverflowScrolling: 'touch',
              cursor: 'grab'
            }}
          >
            <div className="flex gap-6 px-6 md:px-12 lg:px-24">
              {editorialImages.map((item, index) => (
                <motion.div
                  key={index}
                  data-slide={index}
                  initial={{ opacity: 0, scale: 0.95 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5 }}
                  className="flex-shrink-0 w-[85vw] md:w-[70vw] lg:w-[60vw] snap-center mx-auto"
                >
                  <div className="flex flex-col">
                    {/* Image */}
                    <div 
                      className="relative w-full rounded-xl overflow-hidden"
                      style={{ 
                        aspectRatio: '21 / 9',
                        backgroundColor: '#e8e8e8'
                      }}
                    >
                      <div 
                        className="absolute inset-0 bg-cover bg-center"
                        style={{
                          backgroundImage: `url(${item.encoded})`,
                        }}
                        role="img"
                        aria-label={getSEOAlt(item.path) || item.alt}
                      />
                      <div className="absolute inset-0 bg-black/5" />
                    </div>
                    
                    {/* Caption */}
                    <p className="valley-caption mt-3 text-center">
                      {item.caption}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Navigation Dots */}
          <div className="flex justify-center gap-2 mt-8 px-6">
            {editorialImages.map((_, index) => (
              <button
                key={index}
                onClick={() => {
                  const carousel = carouselRef.current;
                  if (carousel) {
                    const slide = carousel.querySelector(`[data-slide="${index}"]`);
                    slide?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                  }
                }}
                className={`h-2 rounded-full transition-all duration-300 ${
                  currentSlide === index 
                    ? 'bg-[#1a1a1a] w-8' 
                    : 'bg-gray-300 hover:bg-gray-400 w-2'
                }`}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </div>
        </div>
        
        {/* Divider */}
        <div className="valley-divider" />
      </div>
    </section>
  );
};

export default EditorialHookSection;
