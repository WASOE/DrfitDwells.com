import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  partyCountsForWho,
  resolvePartyFromWho,
} from '../../data/homepagePlanner';
import { setupsForParty } from '../../data/homepageSetups';
import { useHomeBookingHandoff } from './useHomeBookingHandoff';
import { bodyClass, eyebrowClass, primaryCtaClass, titleClass, wrapClass } from './homeStyles';

const WHO = ['solo', 'couple', 'family', 'group'];

export default function HomeTripPlanner() {
  const { t } = useTranslation('home');
  const handoff = useHomeBookingHandoff();
  const [who, setWho] = useState(null);
  const [party, setParty] = useState(null);

  const counts = who ? partyCountsForWho(who) : [];
  const needsCount = who && !resolvePartyFromWho(who);
  const setups = useMemo(() => (party ? setupsForParty(party) : []), [party]);

  const chooseWho = (value) => {
    const exact = resolvePartyFromWho(value);
    setWho(value);
    setParty(exact ? Number(exact) : null);
  };

  return (
    <section id="planner" className="bg-[#F3EFE6] py-14 md:py-20 lg:py-24" aria-labelledby="home-planner-title">
      <div className={wrapClass}>
        <div className="max-w-3xl mb-8 md:mb-10">
          <p className={`${eyebrowClass} mb-4`}>{t('planner.eyebrow')}</p>
          <h2 id="home-planner-title" className={titleClass}>{t('planner.title')}</h2>
          <p className={`${bodyClass} mt-4`}>{t('planner.body')}</p>
        </div>

        <div className="bg-white border border-[#DED9D0] p-5 sm:p-8" data-testid="home-planner">
          <p className="text-sm font-semibold text-[#1c1917] mb-3">{t('planner.steps.who.title')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" role="group" aria-label={t('planner.steps.who.title')}>
            {WHO.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={who === value}
                onClick={() => chooseWho(value)}
                className={`min-h-12 px-4 py-3 text-left text-sm border ${
                  who === value ? 'border-[#1c1917] bg-[#F9F8F6]' : 'border-[#E5E5E0] bg-white'
                }`}
              >
                {t(`planner.steps.who.options.${value}`)}
              </button>
            ))}
          </div>

          {needsCount ? (
            <div className="mt-6">
              <p className="text-sm font-semibold text-[#1c1917] mb-3">{t('planner.steps.party.title')}</p>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2" role="group" aria-label={t('planner.steps.party.title')}>
                {counts.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={String(party) === value}
                    onClick={() => setParty(Number(value))}
                    className={`min-h-11 px-2 py-2 text-sm border ${
                      String(party) === value ? 'border-[#1c1917] bg-[#F9F8F6]' : 'border-[#E5E5E0]'
                    }`}
                  >
                    {t(`planner.steps.party.options.${value}`)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {setups.length > 0 ? (
            <div className="mt-8">
              <h3 className="font-serif text-2xl text-[#1c1917] mb-2">{t('planner.setupsTitle', { count: party })}</h3>
              <p className="text-sm text-stone-700 mb-5">{t('planner.setupsNote')}</p>
              <ul className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {setups.map((item) => (
                  <li key={item.id} className="border border-[#E5E5E0] p-5 flex flex-col min-w-0">
                    <h4 className="font-serif text-xl text-[#1c1917]">{t(`planner.setups.${item.id}.title`)}</h4>
                    <p className="mt-2 text-sm text-stone-800 leading-relaxed">{t(`planner.setups.${item.id}.line`)}</p>
                    <p className="mt-3 text-sm text-[#1c1917]">
                      {t('planner.sleeps', { count: item.sleeps })}
                      {' · '}
                      {item.quote ? t('planner.quotePrice') : t('planner.nightly', { price: item.nightly })}
                    </p>
                    <button
                      type="button"
                      className={`${primaryCtaClass} mt-5`}
                      onClick={() => handoff(item.stayId, { adults: party })}
                    >
                      {item.quote ? t('planner.requestQuote') : t('planner.checkThese')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
