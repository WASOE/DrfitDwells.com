import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import { localizePath } from '../../utils/localizedRoutes';
import {
  PLANNER_STEPS,
  STAY_MATCHES,
  buildItinerary,
  recommendStay,
} from '../../data/homepagePlanner';
import { useHomeBookingHandoff } from './useHomeBookingHandoff';
import { bodyClass, eyebrowClass, primaryCtaClass, secondaryCtaClass, sectionClass, titleClass, wrapClass } from './homeStyles';

export default function HomeTripPlanner() {
  const { t } = useTranslation('home');
  const { language } = useSiteLanguage();
  const handoff = useHomeBookingHandoff();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);

  const current = PLANNER_STEPS[step];
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
    if (step < PLANNER_STEPS.length - 1) {
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

  const itinerary = result ? buildItinerary(result.stayId, result.nights) : [];
  const stay = result ? STAY_MATCHES[result.stayId] : null;

  return (
    <section id="planner" className={`bg-white ${sectionClass}`} aria-labelledby="home-planner-title">
      <div className={`${wrapClass} grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-start`}>
        <div className="max-w-xl">
          <p className={`${eyebrowClass} mb-4`}>{t('planner.eyebrow')}</p>
          <h2 id="home-planner-title" className={titleClass}>{t('planner.title')}</h2>
          <p className={`${bodyClass} mt-5`}>{t('planner.body')}</p>
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-6 border-t border-[#E5E5E0] pt-6">
            <div>
              <h3 className="font-serif text-lg text-[#1c1917] mb-2">{t('planner.promiseStayTitle')}</h3>
              <p className="text-sm text-stone-600 leading-relaxed">{t('planner.promiseStayBody')}</p>
            </div>
            <div>
              <h3 className="font-serif text-lg text-[#1c1917] mb-2">{t('planner.promisePlanTitle')}</h3>
              <p className="text-sm text-stone-600 leading-relaxed">{t('planner.promisePlanBody')}</p>
            </div>
          </div>
        </div>

        <div className="bg-[#F9F9F7] border border-[#E5E5E0] p-5 sm:p-8 min-w-0" data-testid="home-planner">
          {result ? (
            <div>
              <p className={`${eyebrowClass} mb-3`}>{t('planner.resultEyebrow')}</p>
              <h3 className="font-serif text-3xl text-[#1c1917] mb-3">{t(`planner.results.${result.stayId}.title`)}</h3>
              <p className="text-stone-700 leading-relaxed mb-3">{t(`planner.results.${result.stayId}.body`)}</p>
              {result.offlineMismatch ? (
                <p className="text-sm text-stone-600 leading-relaxed mb-6">{t('planner.offlineMismatch')}</p>
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
              <p className="text-xs text-stone-500 leading-relaxed mb-6">{t('planner.disclaimer')}</p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link to={localizePath(stay.path, language)} className={primaryCtaClass}>
                  {t('planner.explore')}
                </Link>
                <button
                  type="button"
                  className={secondaryCtaClass}
                  onClick={() => handoff(result.stayId, result.searchAdults)}
                >
                  {t('planner.checkDates')}
                </button>
              </div>
              <button type="button" className="mt-5 text-sm text-stone-600 underline underline-offset-4" onClick={restart}>
                {t('planner.restart')}
              </button>
            </div>
          ) : (
            <div>
              <div className="flex gap-2 mb-6" aria-hidden="true">
                {PLANNER_STEPS.map((item, index) => (
                  <span
                    key={item.id}
                    className={`h-1 flex-1 ${index <= step ? 'bg-[#1c1917]' : 'bg-[#E5E5E0]'}`}
                  />
                ))}
              </div>
              <p className={`${eyebrowClass} mb-3`}>
                {t('planner.questionProgress', { current: String(step + 1).padStart(2, '0'), total: '04' })}
              </p>
              <h3 className="font-serif text-2xl sm:text-3xl text-[#1c1917] mb-2">{t(`planner.steps.${current.id}.title`)}</h3>
              <p className="text-sm text-stone-600 mb-5">{t(`planner.steps.${current.id}.body`)}</p>
              <div className="grid grid-cols-1 gap-3" role="group" aria-label={t(`planner.steps.${current.id}.title`)}>
                {current.options.map((value) => {
                  const pressed = selected === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={pressed}
                      onClick={() => choose(value)}
                      className={`min-h-12 px-4 py-3 text-left text-sm border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1c1917] ${
                        pressed ? 'border-[#1c1917] bg-white' : 'border-[#E5E5E0] bg-white hover:border-stone-400'
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
                <button type="button" className={`${primaryCtaClass} disabled:opacity-40 disabled:cursor-not-allowed`} onClick={continueStep} disabled={!selected}>
                  {step === PLANNER_STEPS.length - 1 ? t('planner.seeMatch') : t('planner.continue')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
