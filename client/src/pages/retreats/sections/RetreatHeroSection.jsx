import { useTranslation } from 'react-i18next';

const RetreatHeroSection = ({ onCheckAvailability }) => {
  const { t } = useTranslation('retreats');

  return (
    <section className="retreat-hero valley-section" id="retreat-hero">
      <div className="valley-container">
        <h1 className="retreat-h1">{t('hero.h1')}</h1>
        <p className="retreat-lead">{t('hero.subhead')}</p>
        <button type="button" className="retreat-btn mt-8" onClick={onCheckAvailability}>
          {t('hero.cta')}
        </button>
      </div>
    </section>
  );
};

export default RetreatHeroSection;
