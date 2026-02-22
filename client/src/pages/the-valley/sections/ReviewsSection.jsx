import { motion } from 'framer-motion';
import AuthorityStrip from '../../../components/AuthorityStrip';

const ReviewsSection = ({ trustBadgesRef }) => {
  return (
    <section 
      ref={trustBadgesRef}
      className="valley-section"
    >
      <div className="valley-container">
        {/* Quote - Larger Text (Optional Serif) */}
        <div className="mb-10 max-w-3xl">
          <p className="valley-quote" style={{ fontSize: '1.75rem', lineHeight: '1.35' }}>
            "Time slows down. Nature takes over."
          </p>
        </div>

        {/* Ratings Row - Aligned Under Quote */}
        <div className="flex flex-col md:flex-row items-center justify-start gap-6 md:gap-8 pt-6 border-t border-[rgba(0,0,0,0.12)]">
          <div>
            <AuthorityStrip />
          </div>
          
          <div className="hidden md:block w-px h-12 bg-[rgba(0,0,0,0.12)]" />
          
          <p className="valley-caption">
            Rated by hundreds of guests across Airbnb, Booking, and direct stays
          </p>
        </div>
      </div>
    </section>
  );
};

export default ReviewsSection;
