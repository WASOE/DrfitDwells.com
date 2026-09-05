import { useWinterVillageLocale } from '../useWinterVillageLocale';
import WinterVillageImage from './WinterVillageImage';

export default function WinterVillageDates({ onSelectDate }) {
  const { dates } = useWinterVillageLocale();

  return (
    <section className="wv-dates wv-on-dark" aria-labelledby="wv-dates-heading">
      <div className="wv-dates-inner">
        <div>
          <p className="wv-kicker">{dates.eyebrow}</p>
          <h2 id="wv-dates-heading" className="wv-display">
            {dates.sectionLabel}
          </h2>
        </div>
        <p className="wv-dates-intro">{dates.intro}</p>

        <div className="wv-dates-media">
          <WinterVillageImage
            slot="datesPlate"
            sizes="(min-width: 900px) 78vw, 100vw"
          />
        </div>

        <ul className="wv-date-strip">
          {dates.items.map((item) => (
            <li key={item.id} className="wv-date">
              <div>
                <p className="wv-date-when">{item.label}</p>
                <h3 className="wv-date-title">{item.title}</h3>
              </div>

              <ul className="wv-date-facts">
                <li>{item.mode}</li>
                <li>{item.duration}</li>
                <li>{item.fromPrice}</li>
              </ul>

              <button
                type="button"
                className="wv-btn wv-btn--ghost wv-date-action"
                onClick={() => onSelectDate(item.productId)}
              >
                {item.selectLabel}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
