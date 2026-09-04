import { WINTER_VILLAGE_CHRISTMAS_FEATURE } from '../winterVillageConfig';
import WinterVillageImage from './WinterVillageImage';

export default function WinterVillageChristmasFeature({ onChooseChristmas }) {
  return (
    <section className="wv-christmas wv-on-dark" aria-labelledby="wv-christmas-heading">
      <div className="wv-christmas-inner">
        <WinterVillageImage
          slot="christmasPlate"
          sizes="(min-width: 900px) 42vw, 100vw"
        />

        <div className="wv-christmas-body">
          <p className="wv-kicker">Christmas in the Valley</p>
          <h2
            id="wv-christmas-heading"
            className="wv-display wv-christmas-title"
          >
            {WINTER_VILLAGE_CHRISTMAS_FEATURE.headline}
          </h2>
          <p className="wv-lede">{WINTER_VILLAGE_CHRISTMAS_FEATURE.copy}</p>

          <ul className="wv-christmas-moments">
            {WINTER_VILLAGE_CHRISTMAS_FEATURE.moments.map((moment) => (
              <li key={moment}>{moment}</li>
            ))}
          </ul>

          <button type="button" className="wv-btn wv-btn--light" onClick={onChooseChristmas}>
            {WINTER_VILLAGE_CHRISTMAS_FEATURE.cta}
          </button>
        </div>
      </div>
    </section>
  );
}
