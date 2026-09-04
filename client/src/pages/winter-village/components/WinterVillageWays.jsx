import {
  WINTER_VILLAGE_PRODUCTS,
  WINTER_VILLAGE_PRODUCT_ORDER
} from '../winterVillageConfig';
import WinterVillageImage from './WinterVillageImage';

const SLOT_BY_PRODUCT = {
  stay: 'wayStay',
  'parent-child': 'wayParent',
  christmas: 'wayChristmas'
};

/**
 * The three ways to spend the winter, as editorial bands rather than tabs.
 * Choosing one preselects it in the configurator further down the page.
 */
export default function WinterVillageWays({ onChooseWay }) {
  return (
    <section className="wv-ways" aria-labelledby="wv-ways-heading">
      <div className="wv-ways-head">
        <p className="wv-kicker">Three ways to spend it</p>
        <h2 id="wv-ways-heading" className="wv-display">
          Come quietly, come together, or come for Christmas.
        </h2>
        <p className="wv-lede">
          The same valley, the same fire, three different winters. Choose the one that sounds
          like your family and we will hold it for you when the presale opens.
        </p>
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
                  <li>{product.details}</li>
                  <li className="wv-way-price">{product.fromPrice}</li>
                </ul>

                <div className="wv-way-actions">
                  <button
                    type="button"
                    className="wv-btn wv-btn--solid"
                    onClick={() => onChooseWay(id)}
                  >
                    Choose this winter
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
