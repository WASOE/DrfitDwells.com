import { WINTER_VILLAGE_CHRISTMAS_FEATURE, WINTER_VILLAGE_MEDIA } from '../winterVillageConfig';
import { WinterVillageStill } from './WinterVillageCinematicMedia';

export default function WinterVillageChristmasFeature({ onChooseChristmas }) {
  return (
    <section className="wv-christmas" aria-labelledby="wv-christmas-heading">
      <div className="wv-christmas-media">
        <WinterVillageStill
          src={WINTER_VILLAGE_MEDIA.campfire}
          alt="Night fire at The Valley — Christmas in the snow"
          className="wv-christmas-img"
        />
        <div className="wv-christmas-wash" aria-hidden="true" />
      </div>

      <div className="wv-christmas-copy">
        <p className="wv-kicker wv-kicker--light">Christmas in the Valley</p>
        <h2 id="wv-christmas-heading" className="wv-section-display wv-section-display--light">
          {WINTER_VILLAGE_CHRISTMAS_FEATURE.headline}
        </h2>
        <p className="wv-section-copy wv-section-copy--light">{WINTER_VILLAGE_CHRISTMAS_FEATURE.copy}</p>

        <ul className="wv-christmas-moments">
          {WINTER_VILLAGE_CHRISTMAS_FEATURE.moments.map((moment) => (
            <li key={moment}>{moment}</li>
          ))}
        </ul>

        <button type="button" className="wv-btn wv-btn--light" onClick={onChooseChristmas}>
          {WINTER_VILLAGE_CHRISTMAS_FEATURE.cta}
        </button>
      </div>
    </section>
  );
}
