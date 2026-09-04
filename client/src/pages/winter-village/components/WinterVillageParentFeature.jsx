import { WINTER_VILLAGE_PARENT_FEATURE } from '../winterVillageConfig';
import WinterVillageImage from './WinterVillageImage';

export default function WinterVillageParentFeature({ onChooseWeekend }) {
  return (
    <section className="wv-parent" aria-labelledby="wv-parent-heading">
      <div className="wv-parent-inner">
        <p className="wv-kicker">{WINTER_VILLAGE_PARENT_FEATURE.eyebrow}</p>
        <h2 id="wv-parent-heading" className="wv-display">
          {WINTER_VILLAGE_PARENT_FEATURE.headline}
        </h2>
        <p className="wv-lede">{WINTER_VILLAGE_PARENT_FEATURE.copy}</p>

        <ol className="wv-flow wv-flow--stacked">
          {WINTER_VILLAGE_PARENT_FEATURE.flow.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>

        <p className="wv-parent-note">{WINTER_VILLAGE_PARENT_FEATURE.conditionsNote}</p>

        <div className="wv-parent-media">
          <WinterVillageImage slot="parentPlate" sizes="(min-width: 900px) 78vw, 100vw" />
        </div>

        {onChooseWeekend ? (
          <button type="button" className="wv-btn wv-btn--solid" onClick={onChooseWeekend}>
            {WINTER_VILLAGE_PARENT_FEATURE.cta}
          </button>
        ) : null}
      </div>
    </section>
  );
}
