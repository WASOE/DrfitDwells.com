import { useWinterVillageLocale } from '../useWinterVillageLocale';
import WinterVillageImage from './WinterVillageImage';

export default function WinterVillageChristmasFeature({ onChooseChristmas }) {
  const { christmasFeature } = useWinterVillageLocale();

  return (
    <section className="wv-christmas wv-on-dark" aria-labelledby="wv-christmas-heading">
      <div className="wv-christmas-inner">
        <WinterVillageImage
          slot="christmasPlate"
          sizes="(min-width: 900px) 42vw, 100vw"
        />

        <div className="wv-christmas-body">
          <p className="wv-kicker">{christmasFeature.eyebrow}</p>
          <h2 id="wv-christmas-heading" className="wv-display wv-christmas-title">
            {christmasFeature.headline}
          </h2>
          <p className="wv-lede">{christmasFeature.copy}</p>

          <ul className="wv-christmas-moments">
            {christmasFeature.moments.map((moment) => (
              <li key={moment}>{moment}</li>
            ))}
          </ul>

          <button type="button" className="wv-btn wv-btn--light" onClick={onChooseChristmas}>
            {christmasFeature.cta}
          </button>
        </div>
      </div>
    </section>
  );
}
