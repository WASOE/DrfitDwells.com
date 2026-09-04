import { useId, useState } from 'react';
import { WINTER_VILLAGE_FAQ } from '../winterVillageConfig';

/**
 * Semantic FAQ: real H2, H3 questions, and answer regions always in the DOM for crawlability.
 */
export default function WinterVillageFaq() {
  const baseId = useId();
  const [openId, setOpenId] = useState(WINTER_VILLAGE_FAQ.items[0]?.id ?? null);

  return (
    <section className="wv-faq" aria-labelledby="wv-faq-heading">
      <div className="wv-faq-inner">
        <div>
          <p className="wv-kicker">{WINTER_VILLAGE_FAQ.eyebrow}</p>
          <h2 id="wv-faq-heading" className="wv-display wv-display--sm">
            {WINTER_VILLAGE_FAQ.headline}
          </h2>
        </div>

        <div className="wv-faq-list">
          {WINTER_VILLAGE_FAQ.items.map((item) => {
            const open = openId === item.id;
            const panelId = `${baseId}-${item.id}-panel`;
            const triggerId = `${baseId}-${item.id}-trigger`;

            return (
              <div key={item.id} className="wv-faq-item">
                <h3>
                  <button
                    type="button"
                    id={triggerId}
                    className="wv-faq-trigger"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => setOpenId(open ? null : item.id)}
                  >
                    <span>{item.question}</span>
                    <span className="wv-faq-sign" aria-hidden="true">
                      {open ? '−' : '+'}
                    </span>
                  </button>
                </h3>
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={triggerId}
                  hidden={!open}
                  className="wv-faq-answer-wrap"
                >
                  <p className="wv-faq-answer">{item.answer}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
