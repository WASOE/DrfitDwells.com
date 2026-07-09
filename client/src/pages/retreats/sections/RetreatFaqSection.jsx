import { useTranslation } from 'react-i18next';

const RetreatFaqSection = () => {
  const { t } = useTranslation('retreats');
  const items = t('faq.items', { returnObjects: true });

  return (
    <section className="valley-section">
      <div className="valley-container">
        <h2 className="retreat-h2">{t('faq.title')}</h2>
        {Array.isArray(items) &&
          items.map((item) => (
            <div key={item.q} className="retreat-faq-item">
              <h3>{item.q}</h3>
              <p>{item.a}</p>
            </div>
          ))}
      </div>
    </section>
  );
};

export default RetreatFaqSection;
