import { motion } from 'framer-motion';
import { useInView } from 'framer-motion';
import { useRef } from 'react';

const ArchiveGallery = ({ images }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{ duration: 0.6 }}
      className="my-16 md:my-20"
    >
      <div className="mb-6">
        <h4 
          className="text-lg md:text-xl font-semibold mb-2"
          style={{ 
            color: 'var(--valley-text-heading)',
            fontFamily: 'var(--valley-font-primary)'
          }}
        >
          From the archive
        </h4>
        <p 
          className="valley-caption"
          style={{ color: 'var(--valley-text-muted)' }}
        >
          Real moments from the build.
        </p>
      </div>

      {/* Mobile: Horizontal Scroll */}
      <div className="md:hidden">
        <div 
          className="overflow-x-auto snap-x snap-mandatory scrollbar-hide -mx-4 px-4"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          <div className="flex gap-4">
            {images.map((image, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={isInView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.4, delay: index * 0.1 }}
                className="flex-shrink-0 w-[75vw] snap-center"
              >
                <div className="archive-polaroid">
                  <div className="archive-image-wrapper">
                    <img
                      src={image.src}
                      alt={image.alt || image.caption}
                      className="archive-image"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <p className="archive-caption">{image.caption}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* Desktop: Grid */}
      <div className="hidden md:grid md:grid-cols-3 gap-6">
        {images.map((image, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            transition={{ duration: 0.4, delay: index * 0.1 }}
          >
            <div className="archive-polaroid">
              <div className="archive-image-wrapper">
                <img
                  src={image.src}
                  alt={image.alt || image.caption}
                  className="archive-image"
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <p className="archive-caption">{image.caption}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
};

export default ArchiveGallery;
