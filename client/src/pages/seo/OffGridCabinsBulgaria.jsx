import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import '../../i18n/ns/seo';
import { useTranslation } from 'react-i18next';
import { useBookingSearch } from '../../context/BookingSearchContext';
import { useLocalizedPath } from '../../hooks/useLocalizedPath';
import Seo from '../../components/Seo';
import { buildHreflangAlternates } from '../../utils/localizedRoutes';
import './seo-landing.css';

const OffGridCabinsBulgaria = () => {
  const { t } = useTranslation('seo');
  const { openModal } = useBookingSearch();
  const lp = useLocalizedPath();

  return (
    <>
      <Seo
        title={t('offGrid.metaTitle')}
        description={t('offGrid.metaDescription')}
        canonicalPath="/off-grid-cabins-bulgaria"
        ogImage="/uploads/Videos/The-cabin-header.winter-poster.jpg"
        hreflangAlternates={buildHreflangAlternates('/off-grid-cabins-bulgaria')}
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
              {t('offGrid.h1')}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="seo-landing-intro"
            >
              {t('offGrid.intro')}
            </motion.p>
          </div>
        </section>

        <section className="seo-landing-section">
          <div className="seo-landing-container">
            <h2 className="seo-landing-h2">{t('offGrid.cabinVsValley.title')}</h2>
            <div className="seo-landing-grid">
              <div className="seo-landing-card">
                <h3 className="seo-landing-h3">
                  <Link to={lp('/cabin')} className="seo-landing-link">
                    {t('offGrid.links.cabinCardTitle')}
                  </Link>
                </h3>
                <p>{t('offGrid.cabinVsValley.cabin')}</p>
              </div>
              <div className="seo-landing-card">
                <h3 className="seo-landing-h3">
                  <Link to={lp('/valley')} className="seo-landing-link">
                    {t('offGrid.links.valleyCardTitle')}
                  </Link>
                </h3>
                <p>{t('offGrid.cabinVsValley.valley')}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="seo-landing-section">
          <div className="seo-landing-container">
            <h2 className="seo-landing-h2">{t('offGrid.digitalDetox.title')}</h2>
            <p className="seo-landing-body">{t('offGrid.digitalDetox.body')}</p>
          </div>
        </section>

        <section className="seo-landing-section">
          <div className="seo-landing-container">
            <h2 className="seo-landing-h2">{t('offGrid.location.title')}</h2>
            <p className="seo-landing-body">{t('offGrid.location.body')}</p>
            <p>
              <Link to={lp('/rhodopes-cabin-retreat')} className="seo-landing-link">
                {t('offGrid.links.rhodopesGuide')}
              </Link>
            </p>
          </div>
        </section>

        <section className="seo-landing-cta">
          <div className="seo-landing-container text-center">
            <button type="button" onClick={openModal} className="seo-landing-btn">
              {t('offGrid.cta')}
            </button>
          </div>
        </section>
      </div>
    </>
  );
};

export default OffGridCabinsBulgaria;
