import { useTranslation } from 'react-i18next';

const RetreatWhySection = () => {
  const { t } = useTranslation('retreats');

  return (
    <section className="valley-section">
      <div className="valley-container">
        <h2 className="retreat-h2">{t('why.title')}</h2>
        <p className="retreat-body">{t('why.body')}</p>
      </div>
    </section>
  );
};

export default RetreatWhySection;
