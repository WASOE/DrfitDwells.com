import { WINTER_VILLAGE_FOUNDING } from '../winterVillageConfig';

/**
 * The presale rationale. Typographic on purpose: none of these four things exist yet,
 * so photographing them would be a promise we cannot keep.
 */
export default function WinterVillageFounding() {
  return (
    <section className="wv-founding wv-on-dark" aria-labelledby="wv-founding-heading">
      <div className="wv-founding-inner">
        <div className="wv-founding-head">
          <p className="wv-kicker">The founding presale</p>
          <h2 id="wv-founding-heading" className="wv-display">
            {WINTER_VILLAGE_FOUNDING.headline}
          </h2>
          <p className="wv-lede">{WINTER_VILLAGE_FOUNDING.copy}</p>

          <p className="wv-founding-target">
            <strong>€15,000</strong>
            <span className="wv-kicker wv-kicker--on-dark">Winter build target</span>
          </p>
        </div>

        <ol className="wv-founding-list">
          {WINTER_VILLAGE_FOUNDING.items.map((item, index) => (
            <li key={item.title} className="wv-founding-item">
              <span className="wv-founding-num" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <h3 className="wv-founding-title">{item.title}</h3>
                <p className="wv-founding-status">{WINTER_VILLAGE_FOUNDING.statusLabel}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
