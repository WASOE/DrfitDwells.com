import {
  WINTER_VILLAGE_PRODUCTS,
  WINTER_VILLAGE_PRODUCT_ORDER,
  WINTER_VILLAGE_WAYS
} from '../winterVillageConfig';
import WinterVillageImage from './WinterVillageImage';

const SLOT_BY_PRODUCT = {
  stay: 'wayStay',
  'parent-child': 'wayParent',
  christmas: 'wayChristmas'
};

/**
 * Three winter experiences as editorial bands. CTAs select the package and scroll to details.
 */
export default function WinterVillageWays({ onChooseWay }) {
  return (
    <section className="wv-ways" aria-labelledby="wv-ways-heading">
      <div className="wv-ways-head">
        <p className="wv-kicker">{WINTER_VILLAGE_WAYS.eyebrow}</p>
        <h2 id="wv-ways-heading" className="wv-display">
          {WINTER_VILLAGE_WAYS.headline}
        </h2>
        <p className="wv-lede">{WINTER_VILLAGE_WAYS.copy}</p>
      </div>

      <ol className="wv-ways-list">
        {WINTER_VILLAGE_PRODUCT_ORDER.map((id, index) => {
          const product = WINTER_VILLAGE_PRODUCTS[id];
          return (
            <li
              key={id}
              className={`wv-way ${index % 2 === 1 ? 'wv-way--flip' : ''}`.trim()}
            >
              <div className="wv-way-media">
                <span className="wv-way-index" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <WinterVillageImage
                  slot={SLOT_BY_PRODUCT[id]}
                  sizes="(min-width: 900px) 42vw, 100vw"
                />
              </div>

              <div className="wv-way-body">
                <p className="wv-kicker">{product.kicker}</p>
                <h3 className="wv-way-title">{product.headline}</h3>
                <p className="wv-way-copy">{product.shortDescription}</p>

                <ul className="wv-way-facts">
                  <li>{product.commercialLine}</li>
                </ul>

                <div className="wv-way-actions">
                  <button
                    type="button"
                    className="wv-btn wv-btn--solid"
                    onClick={() => onChooseWay(id)}
                  >
                    {product.cardCta}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
