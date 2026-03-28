import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import '../../i18n/ns/seo';
import { useTranslation } from 'react-i18next';
import { useBookingSearch } from '../../context/BookingSearchContext';
import { useLocalizedPath } from '../../hooks/useLocalizedPath';
import Seo from '../../components/Seo';
import { buildHreflangAlternates } from '../../utils/localizedRoutes';
import './seo-landing.css';

const RhodopesCabinRetreat = () => {
  const { t } = useTranslation('seo');
  const { openModal } = useBookingSearch();
  const lp = useLocalizedPath();
  const items = t('rhodopes.thingsToDo.items', { returnObjects: true }) || [];

  return (
    <>
      <Seo
        title={t('rhodopes.metaTitle')}
        description={t('rhodopes.metaDescription')}
        canonicalPath="/rhodopes-cabin-retreat"
        ogImage="/uploads/The Valley/WhatsApp Image 2025-10-17 at 10.20.23 AM.jpeg"
        hreflangAlternates={buildHreflangAlternates('/rhodopes-cabin-retreat')}
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
              {t('rhodopes.h1')}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="seo-landing-intro"
            >
              {t('rhodopes.whyRhodopes')}
            </motion.p>
          </div>
        </section>

        <section className="seo-landing-section">
          <div className="seo-landing-container">
            <h2 className="seo-landing-h2">{t('rhodopes.thingsToDo.title')}</h2>
            <ul className="seo-landing-list">
              {Array.isArray(items) && items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="seo-landing-section">
          <div className="seo-landing-container">
            <p>
              <Link to={lp('/off-grid-cabins-bulgaria')} className="seo-landing-link">
                {t('rhodopes.links.offGridOverview')}
              </Link>
            </p>
            <p>
              <Link to={lp('/cabin')} className="seo-landing-link">
                {t('rhodopes.links.bookCabin')}
              </Link>
            </p>
            <p>
              <Link to={lp('/valley')} className="seo-landing-link">
                {t('rhodopes.links.bookValley')}
              </Link>
            </p>
          </div>
        </section>

        <section className="seo-landing-cta">
          <div className="seo-landing-container text-center">
            <button type="button" onClick={openModal} className="seo-landing-btn">
              {t('rhodopes.cta')}
            </button>
          </div>
        </section>
      </div>
    </>
  );
};

export default RhodopesCabinRetreat;
