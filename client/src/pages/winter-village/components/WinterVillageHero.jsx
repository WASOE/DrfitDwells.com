import { WINTER_VILLAGE_HERO } from '../winterVillageConfig';
import WinterVillageImage from './WinterVillageImage';

export default function WinterVillageHero({ onExplorePackages }) {
  return (
    <section className="wv-hero" aria-labelledby="wv-hero-title">
      <div className="wv-hero-media">
        <WinterVillageImage slot="hero" className="wv-plate--fill" priority sizes="100vw" />
      </div>
      <div className="wv-hero-scrim" aria-hidden="true" />

      <div className="wv-hero-inner">
        <p className="wv-kicker wv-hero-eyebrow">{WINTER_VILLAGE_HERO.eyebrow}</p>
        <h1 id="wv-hero-title" className="wv-display wv-display--xl wv-hero-title">
          {WINTER_VILLAGE_HERO.headline}
        </h1>
        <p className="wv-lede wv-hero-copy">{WINTER_VILLAGE_HERO.copy}</p>

        <div className="wv-hero-actions">
          <button type="button" className="wv-btn wv-btn--light" onClick={onExplorePackages}>
            {WINTER_VILLAGE_HERO.primaryCta}
          </button>
          <p className="wv-hero-note">{WINTER_VILLAGE_HERO.secondaryLine}</p>
        </div>
      </div>
    </section>
  );
}
