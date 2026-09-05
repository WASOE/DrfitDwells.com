import { useWinterVillageLocale } from '../useWinterVillageLocale';
import WinterVillageImage from './WinterVillageImage';

export default function WinterVillageParentFeature({ onChooseWeekend }) {
  const { parentFeature } = useWinterVillageLocale();

  return (
    <section className="wv-parent" aria-labelledby="wv-parent-heading">
      <div className="wv-parent-inner">
        <p className="wv-kicker">{parentFeature.eyebrow}</p>
        <h2 id="wv-parent-heading" className="wv-display">
          {parentFeature.headline}
        </h2>
        <p className="wv-lede">{parentFeature.copy}</p>

        <ol className="wv-flow wv-flow--stacked">
          {parentFeature.flow.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>

        <p className="wv-parent-note">{parentFeature.conditionsNote}</p>

        <div className="wv-parent-media">
          <WinterVillageImage slot="parentPlate" sizes="(min-width: 900px) 78vw, 100vw" />
        </div>

        {onChooseWeekend ? (
          <button type="button" className="wv-btn wv-btn--solid" onClick={onChooseWeekend}>
            {parentFeature.cta}
          </button>
        ) : null}
      </div>
    </section>
  );
}
