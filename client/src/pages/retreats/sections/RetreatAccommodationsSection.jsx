import { useTranslation } from 'react-i18next';

const RetreatAccommodationsSection = () => {
  const { t } = useTranslation('retreats');

  const cards = [
    { key: 'aframes', title: t('accommodations.aframes.title'), body: t('accommodations.aframes.description') },
    { key: 'lux', title: t('accommodations.lux.title'), body: t('accommodations.lux.description') },
    { key: 'stone', title: t('accommodations.stone.title'), body: t('accommodations.stone.description') }
  ];

  return (
    <section className="valley-section">
      <div className="valley-container">
        <h2 className="retreat-h2">{t('accommodations.title')}</h2>
        <div className="retreat-card-grid">
          {cards.map((card) => (
            <article key={card.key} className="retreat-card">
              <h3>{card.title}</h3>
              <p className="retreat-body text-sm">{card.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default RetreatAccommodationsSection;
