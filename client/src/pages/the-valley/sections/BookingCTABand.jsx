import { motion } from 'framer-motion';
import { useBookingSearch } from '../../../context/BookingSearchContext';

const BookingCTABand = () => {
  const { openModal } = useBookingSearch();

  return (
    <section 
      className="valley-section"
      style={{ 
        paddingTop: '6rem',
        paddingBottom: '6rem',
        borderTop: '1px solid rgba(0,0,0,0.12)'
      }}
    >
      <div 
        className="relative rounded-xl overflow-hidden min-h-[420px] sm:min-h-[480px] md:min-h-0 md:aspect-[21/9]"
        style={{
          backgroundColor: '#e8e8e8'
        }}
      >
        {/* Background Image */}
        <div 
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: 'url(/uploads/The%20Valley/WhatsApp%20Image%202025-10-17%20at%2010.20.23%20AM.jpeg)',
          }}
          role="img"
          aria-label="Panoramic view of The Valley mountain village at sunset"
        />
        
        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/60 via-white/70 to-white/80" />
        
        {/* Content */}
        <div className="relative z-10 flex items-center justify-center h-full">
          <div className="valley-container text-center py-12 md:py-16">
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="valley-h2 mb-4"
              style={{ fontSize: '2.75rem', fontWeight: 700, lineHeight: '1.15' }}
            >
              Ready to experience The Valley?
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="valley-intro mb-10 max-w-2xl mx-auto"
            >
              Check availability or compare stays.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="flex flex-col sm:flex-row gap-4 justify-center items-center"
            >
              <button
                onClick={openModal}
                className="bg-[#1a1a1a] text-white px-12 py-4 font-semibold uppercase tracking-wider text-sm hover:bg-[#2a2a2a] transition-colors min-h-[52px] shadow-lg"
              >
                Check availability
              </button>
              <button
                onClick={openModal}
                className="border border-[#1a1a1a]/30 text-[#1a1a1a] px-10 py-4 font-medium uppercase tracking-wider text-sm hover:bg-[#1a1a1a]/5 transition-colors min-h-[52px]"
              >
                Compare stays
              </button>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default BookingCTABand;
