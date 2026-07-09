import { useTranslation } from 'react-i18next';

const RetreatIncludedSection = () => {
  const { t } = useTranslation('retreats');
  const items = t('included.items', { returnObjects: true });

  return (
    <section className="valley-section">
      <div className="valley-container">
        <h2 className="retreat-h2">{t('included.title')}</h2>
        <ul className="retreat-list">
          {Array.isArray(items) &&
            items.map((item) => (
              <li key={item}>{item}</li>
            ))}
        </ul>
      </div>
    </section>
  );
};

export default RetreatIncludedSection;
