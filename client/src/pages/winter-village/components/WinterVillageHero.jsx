import { useWinterVillageLocale } from '../useWinterVillageLocale';
import WinterVillageImage from './WinterVillageImage';

/**
 * Hero with commercial hierarchy mirrored from /valley:
 * mobile = intro then product selector; desktop = copy left, white selector right.
 */
export default function WinterVillageHero({ onViewPackage, onExplorePackages }) {
  const { hero, products, productOrder } = useWinterVillageLocale();

  return (
    <section className="wv-hero" aria-labelledby="wv-hero-title">
      <div className="wv-hero-media" aria-hidden="true">
        <WinterVillageImage slot="hero" className="wv-plate--fill" priority sizes="100vw" />
      </div>
      <div className="wv-hero-scrim" aria-hidden="true" />

      <div className="wv-hero-inner">
        <div className="wv-hero-copy-col">
          <p className="wv-kicker wv-hero-eyebrow">{hero.eyebrow}</p>
          <h1 id="wv-hero-title" className="wv-display wv-display--xl wv-hero-title">
            {hero.headline}
          </h1>
          <p className="wv-lede wv-hero-copy">{hero.copy}</p>

          <div className="wv-hero-actions wv-hero-actions--desktop">
            <button type="button" className="wv-btn wv-btn--light" onClick={onExplorePackages}>
              {hero.primaryCta}
            </button>
            <p className="wv-hero-note">{hero.trustLine}</p>
          </div>
        </div>

        <div className="wv-hero-card-col">
          <div className="wv-hero-card" data-wv-hero-selector="true">
            <p className="wv-hero-card-title">{hero.selectorTitle}</p>

            <ul className="wv-hero-options">
              {productOrder.map((id) => {
                const product = products[id];
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
                      {hero.selectorCta}
                    </button>
                  </li>
                );
              })}
            </ul>

            <p className="wv-hero-card-footer">{hero.selectorFooter}</p>
          </div>

          <p className="wv-hero-note wv-hero-note--mobile">{hero.trustLine}</p>
        </div>
      </div>
    </section>
  );
}
