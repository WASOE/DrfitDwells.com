import { useId, useState } from 'react';
import { WINTER_VILLAGE_FAQ } from '../winterVillageConfig';

export default function WinterVillageFaq() {
  const baseId = useId();
  const [openId, setOpenId] = useState(WINTER_VILLAGE_FAQ[0]?.id ?? null);

  return (
    <section className="wv-faq" aria-labelledby="wv-faq-heading">
      <div className="wv-faq-inner">
        <div>
          <p className="wv-kicker">Before you ask</p>
          <h2 id="wv-faq-heading" className="wv-display wv-display--sm">
            The five things people want to know.
          </h2>
        </div>

        <div className="wv-faq-list">
          {WINTER_VILLAGE_FAQ.map((item) => {
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
                {open ? (
                  <p id={panelId} role="region" aria-labelledby={triggerId} className="wv-faq-answer">
                    {item.answer}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
