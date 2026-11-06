import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import { localizePath } from '../../utils/localizedRoutes';
import {
  STAY_MATCHES,
  buildItinerary,
  getPlannerSteps,
  recommendStay,
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

export default function HomeTripPlanner() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();
  const handoff = useHomeBookingHandoff();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);

  const steps = getPlannerSteps(answers.party);
  const current = steps[step];
  const selected = answers[current?.id];

  const choose = (value) => {
    setAnswers((prev) => ({ ...prev, [current.id]: value }));
  };

  const restart = () => {
    setStep(0);
    setAnswers({});
    setResult(null);
  };

  const continueStep = () => {
    if (!selected) return;
    if (step < steps.length - 1) {
      setStep(step + 1);
      return;
    }
    const match = recommendStay({
      party: answers.party,
      mood: answers.mood,
      connectivity: answers.connectivity,
      sharing: answers.sharing,
      exclusivity: answers.exclusivity,
    });
    setResult({ ...match, nights: answers.nights, mood: answers.mood, connectivity: answers.connectivity });
  };

  const itinerary = result ? buildItinerary(result.stayId, result.nights, result.mood) : [];
  const stay = result ? STAY_MATCHES[result.stayId] : null;
  const isCombination = result?.stayId === 'combination';
  const unitLabel = (unit) => t(`planner.units.${unit.id}`, { count: unit.count });
  const resultTitle = !result
    ? ''
    : isCombination
      ? result.units.map(unitLabel).join(' + ')
      : t(`planner.results.${result.stayId}.title`);
  const partyGrid = current?.id === 'party';

  return (
    <section id="planner" className="bg-[#F3EFE6] py-14 md:py-20 lg:py-[6.5rem]" aria-labelledby="home-planner-title">
      <div className={`${wrapClass} grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-10 lg:gap-[4.5rem] items-start`}>
        <div className="max-w-md lg:sticky lg:top-28">
          <p className={`${eyebrowClass} mb-4`}>{t('planner.eyebrow')}</p>
          <h2 id="home-planner-title" className={titleClass}>{t('planner.title')}</h2>
          <p className={`${bodyClass} mt-5`}>{t('planner.body')}</p>
          <div className="mt-9 grid grid-cols-1 sm:grid-cols-2 gap-5 border-t border-[#D7D2C7] pt-7">
            <div>
              <h3 className="text-[13px] font-semibold text-[#1c1917] mb-2">{t('planner.promiseStayTitle')}</h3>
              <p className="text-xs text-stone-600 leading-relaxed">{t('planner.promiseStayBody')}</p>
            </div>
            <div>
              <h3 className="text-[13px] font-semibold text-[#1c1917] mb-2">{t('planner.promisePlanTitle')}</h3>
              <p className="text-xs text-stone-600 leading-relaxed">{t('planner.promisePlanBody')}</p>
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
                {resultTitle}
              </h3>
              {isCombination ? (
                <div className="mb-3">
                  <h4 className="text-sm font-semibold text-[#1c1917] mb-2">{t('planner.arrangement.title')}</h4>
                  <ul className="space-y-1 text-sm text-stone-700 leading-relaxed">
                    {result.units.map((unit) => (
                      <li key={unit.id}>
                        <span className="font-medium text-[#1c1917]">{unitLabel(unit)}</span>
                        {' · '}
                        {t('planner.arrangement.guests', { count: unit.guests })}
                        {' — '}
                        {t(`planner.arrangement.${unit.id}Note`)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-stone-700 leading-relaxed mb-3">
                  {t(`planner.results.${result.stayId}.body`)}
                </p>
              )}
              <p className="text-stone-700 leading-relaxed mb-3">{t(`planner.why.${result.whyKey}`)}</p>
              <p className="text-sm text-stone-600 mb-3">
                {t('planner.partySummary', { count: result.party })}
              </p>
              {result.alternative ? (
                <p className="text-sm text-stone-600 leading-relaxed mb-3">
                  {t(`planner.alternatives.${result.alternative}`)}
                </p>
              ) : null}
              {result.upgradeBuyout ? (
                <p className="text-sm text-stone-600 leading-relaxed mb-4">
                  <Link
                    to={localizePath(STAY_MATCHES.buyout.path, language)}
                    className="underline underline-offset-4 text-[#1c1917]"
                  >
                    {t('planner.upgradeBuyout')}
                  </Link>
                </p>
              ) : null}
              {result.offlineMismatch ? (
                <p className="text-sm text-stone-600 leading-relaxed mb-4">{t('planner.offlineMismatch')}</p>
              ) : null}
              {result.capacityExceeded ? (
                <p className="text-sm text-stone-600 leading-relaxed mb-4" role="status">
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
                    <p className="text-sm text-stone-700 leading-relaxed mt-1">
                      {t(`planner.itinerary.${day.body}`)}
                      {day.oneNight ? ` ${t('planner.itinerary.oneNight')}` : ''}
                    </p>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-stone-500 leading-relaxed mb-6">
                {isCombination ? t('planner.enquiryNote') : t('planner.disclaimer')}
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link to={localizePath(stay.path, language)} className={primaryCtaClass}>
                  {t('planner.explore')}
                </Link>
                <button
                  type="button"
                  className={secondaryCtaClass}
                  onClick={() => handoff(result.stayId, { adults: result.searchAdults, units: result.units })}
                >
                  {isCombination ? t('planner.askAboutDates') : t('planner.checkDates')}
                </button>
              </div>
              <button
                type="button"
                className="mt-5 text-sm text-stone-600 underline underline-offset-4"
                onClick={restart}
              >
                {t('planner.restart')}
              </button>
            </div>
          ) : (
            <div>
              <div className="flex gap-2 mb-6" aria-hidden="true">
                {steps.map((item, index) => (
                  <span
                    key={item.id}
                    className={`h-1 flex-1 ${index <= step ? 'bg-[#1c1917]' : 'bg-[#E5E5E0]'}`}
                  />
                ))}
              </div>
              <p className={`${eyebrowClass} mb-3`}>
                {t('planner.questionProgress', {
                  current: String(step + 1).padStart(2, '0'),
                  total: String(steps.length).padStart(2, '0'),
                })}
              </p>
              <h3 className="font-serif text-2xl sm:text-3xl text-[#1c1917] mb-2 tracking-tight">
                {t(`planner.steps.${current.id}.title`)}
              </h3>
              <p className="text-sm text-stone-600 mb-5">{t(`planner.steps.${current.id}.body`)}</p>
              <div
                className={partyGrid ? 'grid grid-cols-3 sm:grid-cols-4 gap-2' : 'grid grid-cols-1 gap-3'}
                role="group"
                aria-label={t(`planner.steps.${current.id}.title`)}
              >
                {current.options.map((value) => {
                  const pressed = selected === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={pressed}
                      onClick={() => choose(value)}
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
              <p className="mt-5 text-xs text-stone-500 leading-relaxed">{t('planner.noAccount')}</p>
              <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-between gap-3">
                <button
                  type="button"
                  className="min-h-11 text-sm text-stone-600 underline underline-offset-4 disabled:opacity-40"
                  onClick={() => setStep((value) => Math.max(0, value - 1))}
                  disabled={step === 0}
                >
                  {t('planner.back')}
                </button>
                <button
                  type="button"
                  className={`${primaryCtaClass} disabled:opacity-40 disabled:cursor-not-allowed`}
                  onClick={continueStep}
                  disabled={!selected}
                >
                  {step === steps.length - 1 ? t('planner.seeMatch') : t('planner.continue')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
