import {
  WINTER_VILLAGE_HERO,
  WINTER_VILLAGE_PRODUCT_ORDER,
  WINTER_VILLAGE_PRODUCTS
} from '../winterVillageConfig';
import WinterVillageImage from './WinterVillageImage';

/**
 * Hero with commercial hierarchy mirrored from /valley:
 * mobile = intro then product selector; desktop = copy left, white selector right.
 */
export default function WinterVillageHero({ onViewPackage, onExplorePackages }) {
  return (
    <section className="wv-hero" aria-labelledby="wv-hero-title">
      <div className="wv-hero-media" aria-hidden="true">
        <WinterVillageImage slot="hero" className="wv-plate--fill" priority sizes="100vw" />
      </div>
      <div className="wv-hero-scrim" aria-hidden="true" />

      <div className="wv-hero-inner">
        <div className="wv-hero-copy-col">
          <p className="wv-kicker wv-hero-eyebrow">{WINTER_VILLAGE_HERO.eyebrow}</p>
          <h1 id="wv-hero-title" className="wv-display wv-display--xl wv-hero-title">
            {WINTER_VILLAGE_HERO.headline}
          </h1>
          <p className="wv-lede wv-hero-copy">{WINTER_VILLAGE_HERO.copy}</p>

          <div className="wv-hero-actions wv-hero-actions--desktop">
            <button type="button" className="wv-btn wv-btn--light" onClick={onExplorePackages}>
              {WINTER_VILLAGE_HERO.primaryCta}
            </button>
            <p className="wv-hero-note">{WINTER_VILLAGE_HERO.trustLine}</p>
          </div>
        </div>

        <div className="wv-hero-card-col">
          <div className="wv-hero-card" data-wv-hero-selector="true">
            <p className="wv-hero-card-title">{WINTER_VILLAGE_HERO.selectorTitle}</p>

            <ul className="wv-hero-options">
              {WINTER_VILLAGE_PRODUCT_ORDER.map((id) => {
                const product = WINTER_VILLAGE_PRODUCTS[id];
                return (
                  <li key={id} className="wv-hero-option">
                    <div className="wv-hero-option-meta">
                      <p className="wv-hero-option-name">{product.name}</p>
                      <p className="wv-hero-option-details">{product.details}</p>
                      <p className="wv-hero-option-price">{product.fromPrice}</p>
                    </div>
                    <button
                      type="button"
                      className="wv-btn wv-btn--solid wv-hero-option-cta"
                      onClick={() => onViewPackage(id)}
                    >
                      {WINTER_VILLAGE_HERO.selectorCta}
                    </button>
                  </li>
                );
              })}
            </ul>

            <p className="wv-hero-card-footer">{WINTER_VILLAGE_HERO.selectorFooter}</p>
          </div>

          <p className="wv-hero-note wv-hero-note--mobile">{WINTER_VILLAGE_HERO.trustLine}</p>
        </div>
      </div>
    </section>
  );
}
