import { WINTER_VILLAGE_FOUNDING } from '../winterVillageConfig';
import { WinterVillageStill } from './WinterVillageCinematicMedia';

export default function WinterVillageFounding() {
  return (
    <section className="wv-founding" aria-labelledby="wv-founding-heading">
      <div className="wv-founding-intro">
        <p className="wv-kicker">{WINTER_VILLAGE_FOUNDING.targetLabel}</p>
        <h2 id="wv-founding-heading" className="wv-section-display">
          {WINTER_VILLAGE_FOUNDING.headline}
        </h2>
        <p className="wv-section-copy">{WINTER_VILLAGE_FOUNDING.copy}</p>
      </div>

      <div className="wv-founding-grid">
        {WINTER_VILLAGE_FOUNDING.items.map((item) => (
          <article key={item.title} className="wv-founding-statement">
            <WinterVillageStill
              src={item.image}
              alt=""
              className="wv-founding-statement-img"
              style={{ objectPosition: item.objectPosition }}
            />
            <div className="wv-founding-statement-shade" aria-hidden="true" />
            <p className="wv-founding-stamp">{WINTER_VILLAGE_FOUNDING.statusLabel}</p>
            <h3 className="wv-founding-title">{item.title}</h3>
          </article>
        ))}
      </div>
    </section>
  );
}
