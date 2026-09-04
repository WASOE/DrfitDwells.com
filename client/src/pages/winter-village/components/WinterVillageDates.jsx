import { WINTER_VILLAGE_DATES } from '../winterVillageConfig';

export default function WinterVillageDates({ onSelectDate }) {
  return (
    <section className="wv-dates wv-on-dark" aria-labelledby="wv-dates-heading">
      <div className="wv-dates-inner">
        <div>
          <p className="wv-kicker">Winter 2026 / 27</p>
          <h2 id="wv-dates-heading" className="wv-display">
            {WINTER_VILLAGE_DATES.sectionLabel}
          </h2>
        </div>
        <p className="wv-dates-intro">{WINTER_VILLAGE_DATES.intro}</p>

        <ul className="wv-date-strip">
          {WINTER_VILLAGE_DATES.items.map((item) => (
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
                {WINTER_VILLAGE_DATES.selectLabel}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
