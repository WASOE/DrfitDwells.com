import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useBookingSearch } from '../../../context/BookingSearchContext';
import { useSeason } from '../../../context/SeasonContext';
import { VALLEY_PAGE_SEASON_IMAGES } from '../data';
import '../../../i18n/ns/booking';
import '../../../i18n/ns/valley';

const BookingCTABand = ({
  onPrimaryClick,
  onSecondaryClick,
  primaryLabel,
  secondaryLabel
}) => {
  const { openModal } = useBookingSearch();
  const { season } = useSeason();
  const { t: tv } = useTranslation('valley');
  const { t: tb } = useTranslation('booking');

  const handlePrimary = onPrimaryClick || openModal;
  const handleSecondary = onSecondaryClick || openModal;
  const resolvedPrimaryLabel = primaryLabel || tb('cta.checkAvailability');
  const resolvedSecondaryLabel = secondaryLabel || tv('bookingBand.compareStays');
  const ctaImage =
    VALLEY_PAGE_SEASON_IMAGES.bookingCta[season === 'winter' ? 'winter' : 'summer'];

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
            backgroundImage: `url(${ctaImage.encoded})`,
          }}
          role="img"
          aria-label={ctaImage.alt}
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
              {tv('bookingBand.headline')}
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="valley-intro mb-10 max-w-2xl mx-auto"
            >
              {tv('bookingBand.intro')}
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="flex flex-col sm:flex-row gap-4 justify-center items-center"
            >
              <button
                onClick={handlePrimary}
                className="bg-[#1a1a1a] text-white px-12 py-4 font-semibold uppercase tracking-wider text-sm hover:bg-[#2a2a2a] transition-colors min-h-[52px] shadow-lg"
              >
                {resolvedPrimaryLabel}
              </button>
              <button
                onClick={handleSecondary}
                className="border border-[#1a1a1a]/30 text-[#1a1a1a] px-10 py-4 font-medium uppercase tracking-wider text-sm hover:bg-[#1a1a1a]/5 transition-colors min-h-[52px]"
              >
                {resolvedSecondaryLabel}
              </button>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default BookingCTABand;
