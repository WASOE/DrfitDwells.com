import { useTranslation } from 'react-i18next';

const RetreatLogisticsSection = () => {
  const { t } = useTranslation('retreats');

  return (
    <section className="valley-section">
      <div className="valley-container">
        <h2 className="retreat-h2">{t('logistics.title')}</h2>
        <p className="retreat-body">{t('logistics.body')}</p>
      </div>
    </section>
  );
};

export default RetreatLogisticsSection;
