import { motion } from 'framer-motion';
import { useInView } from 'framer-motion';
import { useRef } from 'react';

const StatsSection = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  const stats = [
    { value: '1,000+', label: 'Guest nights' },
    { value: '4.95 Airbnb, 9.8 Booking', label: 'Average rating' }
  ];

  return (
    <section ref={ref} className="py-12 md:py-16">
      <div className="valley-container">
        <div className="max-w-[700px] mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            transition={{ duration: 0.6 }}
            className="proof-strip"
          >
            <div className="proof-strip-label">Proof</div>
            <div className="proof-strip-content">
              {stats.map((stat, index) => (
                <div key={stat.label} className="proof-stat">
                  <div className="proof-stat-value">{stat.value}</div>
                  <div className="proof-stat-label">{stat.label}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default StatsSection;
