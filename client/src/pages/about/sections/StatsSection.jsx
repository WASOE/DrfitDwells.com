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
      <div className="max-w-[700px] mx-auto px-4 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6 }}
          className="border border-gray-200 rounded-lg p-6 md:p-8 bg-[#faf9f7]"
        >
          <p className="text-xs uppercase tracking-[0.15em] text-gray-400 font-medium mb-5"
            style={{ fontFamily: 'var(--valley-font-primary, Georgia, serif)' }}
          >
            Proof
          </p>
          <div className="grid grid-cols-2 gap-8 text-center">
            {stats.map((stat) => (
              <div key={stat.label}>
                <p
                  className="text-2xl md:text-[1.75rem] font-semibold text-gray-900 mb-1"
                  style={{ fontFamily: 'var(--valley-font-primary, Georgia, serif)' }}
                >
                  {stat.value}
                </p>
                <p
                  className="text-xs uppercase tracking-[0.12em] text-gray-400 font-medium"
                  style={{ fontFamily: 'var(--valley-font-primary, Georgia, serif)' }}
                >
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default StatsSection;
