import { useWinterVillageLocale } from '../useWinterVillageLocale';
import WinterVillageImage from './WinterVillageImage';

export default function WinterVillageClose({ onChooseWinter }) {
  const { close } = useWinterVillageLocale();

  return (
    <section className="wv-close" aria-labelledby="wv-close-heading">
      <div className="wv-close-media">
        <WinterVillageImage slot="closePlate" className="wv-plate--fill" sizes="100vw" />
      </div>
      <div className="wv-close-scrim" aria-hidden="true" />

      <div className="wv-close-inner">
        <p className="wv-kicker">{close.eyebrow}</p>
        <h2 id="wv-close-heading" className="wv-display wv-display--xl wv-close-title">
          {close.headline}
        </h2>
        <p className="wv-lede">{close.copy}</p>
        <button type="button" className="wv-btn wv-btn--light" onClick={onChooseWinter}>
          {close.cta}
        </button>
      </div>
    </section>
  );
}
