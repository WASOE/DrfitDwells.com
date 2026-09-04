import { WINTER_VILLAGE_MEDIA, WINTER_VILLAGE_PARENT_FEATURE } from '../winterVillageConfig';
import { WinterVillageStill } from './WinterVillageCinematicMedia';

export default function WinterVillageParentFeature() {
  return (
    <section className="wv-parent" aria-labelledby="wv-parent-heading">
      <div className="wv-parent-media">
        <WinterVillageStill
          src={WINTER_VILLAGE_MEDIA.fireside}
          alt="Fireside lounge at The Valley"
          className="wv-parent-img"
        />
      </div>
      <div className="wv-parent-copy">
        <p className="wv-kicker">Parent & Child Weekend</p>
        <h2 id="wv-parent-heading" className="wv-section-display">
          {WINTER_VILLAGE_PARENT_FEATURE.headline}
        </h2>
        <p className="wv-section-copy">{WINTER_VILLAGE_PARENT_FEATURE.copy}</p>
        <p className="wv-parent-flow" aria-label="Package flow">
          {WINTER_VILLAGE_PARENT_FEATURE.flow.join(' · ')}
        </p>
      </div>
    </section>
  );
}
