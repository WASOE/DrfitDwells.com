import { WINTER_VILLAGE_DATES } from '../winterVillageConfig';

export default function WinterVillageDates({ onSelectDate }) {
  return (
    <section className="wv-dates" aria-labelledby="wv-dates-heading">
      <h2 className="wv-kicker" id="wv-dates-heading">
        {WINTER_VILLAGE_DATES.sectionLabel}
      </h2>
      <p className="wv-dates-intro">{WINTER_VILLAGE_DATES.intro}</p>

      <ul className="wv-date-strip">
        {WINTER_VILLAGE_DATES.items.map((item) => (
          <li key={item.id} className="wv-date-card">
            <p className="wv-date-card-when">{item.label}</p>
            <h3 className="wv-date-card-title">{item.title}</h3>
            <p className="wv-date-card-meta">
              {item.mode} · {item.duration}
            </p>
            <p className="wv-date-card-price">{item.fromPrice}</p>
            <button type="button" className="wv-btn wv-btn--ghost" onClick={() => onSelectDate(item.productId)}>
              {WINTER_VILLAGE_DATES.selectLabel}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
