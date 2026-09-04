import { WINTER_VILLAGE_CLOSE, WINTER_VILLAGE_MEDIA } from '../winterVillageConfig';
import { WinterVillageStill } from './WinterVillageCinematicMedia';

export default function WinterVillageClose({ onChooseWinter }) {
  return (
    <section className="wv-close" aria-labelledby="wv-close-heading">
      <WinterVillageStill src={WINTER_VILLAGE_MEDIA.closeStill} alt="" className="wv-close-img" />
      <div className="wv-close-shade" aria-hidden="true" />
      <div className="wv-close-copy">
        <h2 id="wv-close-heading" className="wv-section-display wv-section-display--light">
          {WINTER_VILLAGE_CLOSE.headline}
        </h2>
        <p className="wv-section-copy wv-section-copy--light">{WINTER_VILLAGE_CLOSE.copy}</p>
        <button type="button" className="wv-btn wv-btn--light" onClick={onChooseWinter}>
          {WINTER_VILLAGE_CLOSE.cta}
        </button>
      </div>
    </section>
  );
}
