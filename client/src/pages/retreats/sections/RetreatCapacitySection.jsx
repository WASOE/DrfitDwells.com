import { useTranslation } from 'react-i18next';

const RetreatCapacitySection = ({ maxGuests }) => {
  const { t } = useTranslation('retreats');

  return (
    <section className="valley-section">
      <div className="valley-container">
        <h2 className="retreat-h2">{t('capacity.title')}</h2>
        <p className="retreat-body">{t('capacity.body')}</p>
        {maxGuests != null && maxGuests > 0 ? (
          <p className="retreat-body mt-4 text-sm text-stone-600">
            {maxGuests} guests maximum across included accommodations (when quoted).
          </p>
        ) : null}
      </div>
    </section>
  );
};

export default RetreatCapacitySection;
