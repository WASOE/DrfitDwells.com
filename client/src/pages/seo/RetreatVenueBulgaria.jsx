import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useBookingSearch } from '../../context/BookingSearchContext';
import Seo from '../../components/Seo';
import './seo-landing.css';

const RetreatVenueBulgaria = () => {
  const { t } = useTranslation('seo');
  const { openModal } = useBookingSearch();

  return (
    <>
      <Seo
        title={t('retreatVenue.metaTitle')}
        description={t('retreatVenue.metaDescription')}
        canonicalPath="/retreat-venue-bulgaria"
        ogImage="/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.23 AM.jpeg"
        hreflangAlternates={[
          { href: '/retreat-venue-bulgaria', hreflang: 'en' },
          { href: '/retreat-venue-bulgaria', hreflang: 'x-default' }
        ]}
      />
      <div className="seo-landing">
        <section className="seo-landing-hero">
          <div className="seo-landing-container">
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="seo-landing-h1"
            >
              {t('retreatVenue.h1')}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="seo-landing-intro"
            >
              {t('retreatVenue.offer')}
            </motion.p>
          </div>
        </section>

        <section className="seo-landing-section">
          <div className="seo-landing-container">
            <h2 className="seo-landing-h2">How it works</h2>
            <p className="seo-landing-body">{t('retreatVenue.howItWorks')}</p>
            <p>
              <Link to="/valley" className="seo-landing-link">
                The Valley: workation & retreat setting
              </Link>
            </p>
          </div>
        </section>

        <section className="seo-landing-cta">
          <div className="seo-landing-container text-center">
            <button onClick={openModal} className="seo-landing-btn">
              {t('retreatVenue.cta')}
            </button>
          </div>
        </section>
      </div>
    </>
  );
};

export default RetreatVenueBulgaria;
