import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import { localizePath } from '../../utils/localizedRoutes';
import {
  PLANNER_STEPS,
  STAY_MATCHES,
  buildItinerary,
  partyCountsForWho,
  recommendStay,
  resolvePartyFromWho,
} from '../../data/homepagePlanner';
import { useHomeBookingHandoff } from './useHomeBookingHandoff';
import {
  bodyClass,
  eyebrowClass,
  primaryCtaClass,
  secondaryCtaClass,
  titleClass,
  wrapClass,
} from './homeStyles';

function buildActiveSteps(who) {
  const needsExactParty = !resolvePartyFromWho(who);
  return PLANNER_STEPS.filter((step) => step.id !== 'party' || needsExactParty);
}

export default function HomeTripPlanner() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();
  const handoff = useHomeBookingHandoff();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);

  const activeSteps = useMemo(() => buildActiveSteps(answers.who), [answers.who]);
  const current = activeSteps[step] || activeSteps[0];
  const selected = answers[current?.id];
  const partyOptions =
    current?.id === 'party' ? partyCountsForWho(answers.who) : current?.options || [];
  const optionGrid = current?.id === 'party' || current?.id === 'who';

  const restart = () => {
    setStep(0);
    setAnswers({});
    setResult(null);
  };

  const onOptionClick = (value) => {
    if (current.id === 'who') {
      const exact = resolvePartyFromWho(value);
      setAnswers({
        who: value,
        ...(exact ? { party: exact } : {}),
      });
      if (exact) {
        // Solo / couple: skip the exact-count step.
        setStep(1);
      }
      return;
    }

    setAnswers((prev) => ({ ...prev, [current.id]: value }));
  };

  const continueStep = () => {
    if (current.id === 'who') {
      if (!answers.who) return;
      setStep(1);
      return;
    }

    if (current.id === 'party' && !answers.party) return;
    if (current.id !== 'party' && current.id !== 'who' && !selected) return;

    if (step < activeSteps.length - 1) {
      setStep(step + 1);
      return;
    }

    const match = recommendStay({
      party: answers.party,
      mood: answers.mood,
      connectivity: answers.connectivity,
    });
    setResult({ ...match, nights: answers.nights });
  };

  const canContinue =
    current?.id === 'who'
      ? Boolean(answers.who)
      : current?.id === 'party'
        ? Boolean(answers.party)
        : Boolean(selected);

  const itinerary = result ? buildItinerary(result.stayId, result.nights) : [];
  const stay = result ? STAY_MATCHES[result.stayId] : null;
  const progressTotal = activeSteps.length;
  const progressCurrent = Math.min(step + 1, progressTotal);

  return (
    <section id="planner" className="bg-[#F3EFE6] py-14 md:py-20 lg:py-[6.5rem]" aria-labelledby="home-planner-title">
      <div className={`${wrapClass} grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-10 lg:gap-[4.5rem] items-start`}>
        <div className="max-w-md lg:sticky lg:top-28">
          <p className={`${eyebrowClass} mb-4`}>{t('planner.eyebrow')}</p>
          <h2 id="home-planner-title" className={titleClass}>{t('planner.title')}</h2>
          <p className={`${bodyClass} mt-5`}>{t('planner.body')}</p>
          <div className="mt-9 grid grid-cols-1 sm:grid-cols-2 gap-5 border-t border-[#D7D2C7] pt-7">
            <div>
              <h3 className="text-sm font-semibold text-[#1c1917] mb-2">{t('planner.promiseStayTitle')}</h3>
              <p className="text-sm text-stone-700 leading-relaxed">{t('planner.promiseStayBody')}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#1c1917] mb-2">{t('planner.promisePlanTitle')}</h3>
              <p className="text-sm text-stone-700 leading-relaxed">{t('planner.promisePlanBody')}</p>
            </div>
          </div>
        </div>

        <div
          className="bg-white border border-[#DED9D0] shadow-[0_12px_30px_rgba(28,25,23,0.07)] p-6 sm:p-8 min-w-0 min-h-[390px]"
          data-testid="home-planner"
        >
          {result ? (
            <div>
              <p className={`${eyebrowClass} mb-3`}>{t('planner.resultEyebrow')}</p>
              <h3 className="font-serif text-3xl sm:text-4xl text-[#1c1917] mb-3 tracking-tight">
                {t(`planner.results.${result.stayId}.title`)}
              </h3>
              <p className="text-[17px] text-stone-800 leading-relaxed mb-3">
                {t(`planner.results.${result.stayId}.body`)}
              </p>
              <p className="text-sm text-stone-700 mb-3">
                {t('planner.partySummary', { count: result.party })}
              </p>
              {result.offlineMismatch ? (
                <p className="text-sm text-stone-700 leading-relaxed mb-4">{t('planner.offlineMismatch')}</p>
              ) : null}
              {result.capacityExceeded ? (
                <p className="text-sm text-stone-700 leading-relaxed mb-4" role="status">
                  {t('planner.capacityExceeded', {
                    count: result.party,
                    max: result.capacityMax,
                  })}
                </p>
              ) : null}
              <h4 className={`${eyebrowClass} mb-4`}>{t('planner.itineraryTitle')}</h4>
              <ol className="space-y-4 mb-6">
                {itinerary.map((day) => (
                  <li key={day.label} className="border-t border-[#E5E5E0] pt-3">
                    <p className="text-sm font-semibold text-[#1c1917]">{t(`planner.days.${day.label}`)}</p>
                    <p className="text-sm text-stone-800 leading-relaxed mt-1">
                      {t(`planner.itinerary.${day.body}`)}
                      {day.oneNight ? ` ${t('planner.itinerary.oneNight')}` : ''}
                    </p>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-stone-600 leading-relaxed mb-6">{t('planner.disclaimer')}</p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  className={primaryCtaClass}
                  onClick={() => handoff(result.stayId, { adults: result.searchAdults })}
                >
                  {t('planner.checkDates')}
                </button>
                <Link to={localizePath(stay.path, language)} className={secondaryCtaClass}>
                  {t('planner.explore')}
                </Link>
              </div>
              <button
                type="button"
                className="mt-5 text-sm text-stone-700 underline underline-offset-4"
                onClick={restart}
              >
                {t('planner.restart')}
              </button>
            </div>
          ) : (
            <div>
              <div className="flex gap-2 mb-6" aria-hidden="true">
                {activeSteps.map((item, index) => (
                  <span
                    key={item.id}
                    className={`h-1 flex-1 ${index <= step ? 'bg-[#1c1917]' : 'bg-[#E5E5E0]'}`}
                  />
                ))}
              </div>
              <p className={`${eyebrowClass} mb-3`}>
                {t('planner.questionProgress', {
                  current: String(progressCurrent).padStart(2, '0'),
                  total: String(progressTotal).padStart(2, '0'),
                })}
              </p>
              <h3 className="font-serif text-2xl sm:text-3xl text-[#1c1917] mb-2 tracking-tight">
                {t(`planner.steps.${current.id}.title`)}
              </h3>
              <p className="text-[15px] text-stone-700 mb-5 leading-relaxed">
                {t(`planner.steps.${current.id}.body`)}
              </p>
              <div
                className={
                  optionGrid
                    ? current.id === 'party'
                      ? 'grid grid-cols-3 sm:grid-cols-4 gap-2'
                      : 'grid grid-cols-1 sm:grid-cols-2 gap-3'
                    : 'grid grid-cols-1 gap-3'
                }
                role="group"
                aria-label={t(`planner.steps.${current.id}.title`)}
              >
                {partyOptions.map((value) => {
                  const pressed =
                    current.id === 'party' ? answers.party === value : selected === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={pressed}
                      onClick={() => onOptionClick(value)}
                      className={`min-h-12 px-3 py-3 text-left text-sm border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1c1917] ${
                        pressed
                          ? 'border-[#1c1917] bg-[#F9F8F6]'
                          : 'border-[#E5E5E0] bg-white hover:border-stone-400'
                      }`}
                    >
                      {t(`planner.steps.${current.id}.options.${value}`)}
                    </button>
                  );
                })}
              </div>
              <p className="mt-5 text-xs text-stone-600 leading-relaxed">{t('planner.noAccount')}</p>
              <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-between gap-3">
                <button
                  type="button"
                  className="min-h-11 text-sm text-stone-700 underline underline-offset-4 disabled:opacity-40"
                  onClick={() => setStep((value) => Math.max(0, value - 1))}
                  disabled={step === 0}
                >
                  {t('planner.back')}
                </button>
                {(current.id !== 'who' || !resolvePartyFromWho(answers.who)) && (
                  <button
                    type="button"
                    className={`${primaryCtaClass} disabled:opacity-40 disabled:cursor-not-allowed`}
                    onClick={continueStep}
                    disabled={!canContinue}
                  >
                    {step === activeSteps.length - 1 ? t('planner.seeMatch') : t('planner.continue')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
