import { WINTER_VILLAGE_PARENT_FEATURE } from '../winterVillageConfig';
import WinterVillageImage from './WinterVillageImage';

export default function WinterVillageParentFeature() {
  return (
    <section className="wv-parent" aria-labelledby="wv-parent-heading">
      <div className="wv-parent-inner">
        <p className="wv-kicker">Parent &amp; Child Weekend</p>
        <h2 id="wv-parent-heading" className="wv-display">
          {WINTER_VILLAGE_PARENT_FEATURE.headline}
        </h2>
        <p className="wv-lede">{WINTER_VILLAGE_PARENT_FEATURE.copy}</p>

        <ul className="wv-flow">
          {WINTER_VILLAGE_PARENT_FEATURE.flow.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>

        <div className="wv-parent-media">
          <WinterVillageImage slot="parentPlate" sizes="(min-width: 900px) 78vw, 100vw" />
        </div>
      </div>
    </section>
  );
}
