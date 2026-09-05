import { useWinterVillageLocale } from '../useWinterVillageLocale';
import WinterVillageImage from './WinterVillageImage';

/**
 * Planned winter preparation — replaces the deleted €15,000 / founding-presale story.
 */
export default function WinterVillageFounding() {
  const { prepare } = useWinterVillageLocale();

  return (
    <section className="wv-founding wv-on-dark" aria-labelledby="wv-prepare-heading">
      <div className="wv-founding-inner">
        <div className="wv-founding-head">
          <p className="wv-kicker">{prepare.eyebrow}</p>
          <h2 id="wv-prepare-heading" className="wv-display">
            {prepare.headline}
          </h2>
          <p className="wv-lede">{prepare.copy}</p>
          <p className="wv-founding-note">{prepare.transparencyNote}</p>
        </div>

        <ol className="wv-founding-list">
          {prepare.items.map((item, index) => (
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

      <div className="wv-founding-media wv-shell">
        <WinterVillageImage
          slot="preparePlate"
          sizes="(min-width: 900px) 78vw, 100vw"
        />
      </div>
    </section>
  );
}
