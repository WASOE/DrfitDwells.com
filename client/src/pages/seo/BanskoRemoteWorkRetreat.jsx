import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useBookingSearch } from '../../context/BookingSearchContext';
import Seo from '../../components/Seo';
import { buildHreflangAlternates } from '../../utils/localizedRoutes';
import './seo-landing.css';

const BanskoRemoteWorkRetreat = () => {
  const { t } = useTranslation('seo');
  const { openModal } = useBookingSearch();

  return (
    <>
      <Seo
        title={t('bansko.metaTitle')}
        description={t('bansko.metaDescription')}
        canonicalPath="/bansko-remote-work-retreat"
        ogImage="/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.23 AM.jpeg"
        hreflangAlternates={buildHreflangAlternates('/bansko-remote-work-retreat')}
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
              {t('bansko.h1')}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="seo-landing-intro"
            >
              {t('bansko.whyBansko')}
            </motion.p>
          </div>
        </section>

        <section className="seo-landing-section">
          <div className="seo-landing-container">
            <h2 className="seo-landing-h2">{t('bansko.twoPaths.title')}</h2>
            <div className="seo-landing-grid">
              <div className="seo-landing-card">
                <h3 className="seo-landing-h3">{t('bansko.twoPaths.community')}</h3>
              </div>
              <div className="seo-landing-card">
                <h3 className="seo-landing-h3">{t('bansko.twoPaths.disconnect')}</h3>
              </div>
            </div>
            <p>
              <Link to="/valley" className="seo-landing-link">
                The Valley: remote work retreat in Bulgaria
              </Link>
            </p>
            <p>
              <Link to="/off-grid-cabins-bulgaria" className="seo-landing-link">
                Off-grid reset: choose your cabin
              </Link>
            </p>
          </div>
        </section>

        <section className="seo-landing-cta">
          <div className="seo-landing-container text-center">
            <button onClick={openModal} className="seo-landing-btn">
              {t('bansko.cta')}
            </button>
          </div>
        </section>
      </div>
    </>
  );
};

export default BanskoRemoteWorkRetreat;
