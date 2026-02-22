import { motion } from 'framer-motion';
import { useInView } from 'framer-motion';
import { useRef } from 'react';
import { Link } from 'react-router-dom';

const OutcomesSection = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  const outcomes = [
    {
      id: 'cabin',
      title: 'The Cabin',
      image: '/uploads/The%20Cabin/011f4645-32ce-4739-ac8e-16a900612ac7.jpeg',
      alt: 'The Cabin',
      description: 'The original. Quiet, iconic, made for deep rest.',
      link: '/cabin',
      linkText: 'Explore The Cabin'
    },
    {
      id: 'valley',
      title: 'The Valley',
      image: '/uploads/The%20Valley/Lux-cabin-exterior-watermark-remover-20260113071503.jpg',
      alt: 'The Valley',
      description: 'Our next chapter. More space, more nature, more experiences.',
      link: '/the-valley',
      linkText: 'Explore The Valley'
    }
  ];

  return (
    <section ref={ref} className="valley-section">
      <div className="valley-container">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
            {outcomes.map((outcome, index) => (
              <motion.div
                key={outcome.id}
                initial={{ opacity: 0, y: 30 }}
                animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                className="premium-card"
              >
                <div 
                  className="relative w-full bg-[#f4f2ee] overflow-hidden" 
                  style={{ aspectRatio: '3 / 2' }}
                >
                  <img
                    src={outcome.image}
                    alt={outcome.alt}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <div className="p-8 md:p-10">
                  <h3 
                    className="text-2xl md:text-3xl font-semibold mb-4"
                    style={{ 
                      color: 'var(--valley-text-heading)',
                      fontFamily: 'var(--valley-font-primary)'
                    }}
                  >
                    {outcome.title}
                  </h3>
                  <p className="valley-body mb-6 text-lg">
                    {outcome.description}
                  </p>
                  <Link
                    to={outcome.link}
                    className="inline-flex items-center justify-center rounded-full bg-[var(--valley-text-heading)] text-white px-6 py-3 valley-label transition-all hover:bg-[var(--valley-accent)] hover:scale-105"
                    style={{ 
                      color: 'white',
                      textTransform: 'uppercase'
                    }}
                  >
                    {outcome.linkText}
                  </Link>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default OutcomesSection;
