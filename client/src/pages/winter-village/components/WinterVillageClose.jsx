import { WINTER_VILLAGE_CLOSE } from '../winterVillageConfig';
import WinterVillageImage from './WinterVillageImage';

export default function WinterVillageClose({ onChooseWinter }) {
  return (
    <section className="wv-close" aria-labelledby="wv-close-heading">
      <div className="wv-close-media">
        <WinterVillageImage slot="closePlate" className="wv-plate--fill" sizes="100vw" />
      </div>
      <div className="wv-close-scrim" aria-hidden="true" />

      <div className="wv-close-inner">
        <p className="wv-kicker">The first winter</p>
        <h2 id="wv-close-heading" className="wv-display wv-display--xl wv-close-title">
          {WINTER_VILLAGE_CLOSE.headline}
        </h2>
        <p className="wv-lede">{WINTER_VILLAGE_CLOSE.copy}</p>
        <button type="button" className="wv-btn wv-btn--light" onClick={onChooseWinter}>
          {WINTER_VILLAGE_CLOSE.cta}
        </button>
      </div>
    </section>
  );
}
