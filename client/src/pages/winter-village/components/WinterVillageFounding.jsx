import { WINTER_VILLAGE_PREPARE } from '../winterVillageConfig';

/**
 * Planned winter preparation — replaces the deleted €15,000 / founding-presale story.
 */
export default function WinterVillageFounding() {
  return (
    <section className="wv-founding wv-on-dark" aria-labelledby="wv-prepare-heading">
      <div className="wv-founding-inner">
        <div className="wv-founding-head">
          <p className="wv-kicker">{WINTER_VILLAGE_PREPARE.eyebrow}</p>
          <h2 id="wv-prepare-heading" className="wv-display">
            {WINTER_VILLAGE_PREPARE.headline}
          </h2>
          <p className="wv-lede">{WINTER_VILLAGE_PREPARE.copy}</p>
          <p className="wv-founding-note">{WINTER_VILLAGE_PREPARE.transparencyNote}</p>
        </div>

        <ol className="wv-founding-list">
          {WINTER_VILLAGE_PREPARE.items.map((item, index) => (
            <li key={item.title} className="wv-founding-item">
              <span className="wv-founding-num" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <h3 className="wv-founding-title">{item.title}</h3>
                <p className="wv-founding-status">{item.copy}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
