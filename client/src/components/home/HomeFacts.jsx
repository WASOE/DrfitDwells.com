import { useTranslation } from 'react-i18next';
import { HOME_IMAGES } from '../../data/homepageMedia';
import HomePicture from './HomePicture';
import { eyebrowClass, titleClass, wrapClass } from './homeStyles';

const ROWS = ['sleeps', 'units', 'heating', 'power', 'connection', 'hotTub', 'access', 'parking', 'transfer', 'minimum'];

export default function HomeFacts() {
  const { t } = useTranslation('home');

  return (
    <section id="places" className="bg-[#FFFDF8] py-14 md:py-20 lg:py-24" aria-labelledby="home-facts-title">
      <div className={wrapClass}>
        <div className="max-w-3xl mb-8">
          <p className={`${eyebrowClass} mb-4`}>{t('facts.eyebrow')}</p>
          <h2 id="home-facts-title" className={titleClass}>{t('facts.title')}</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div className="relative h-56 md:h-72 overflow-hidden bg-stone-200">
            <HomePicture image={HOME_IMAGES.cabinExterior} alt={t('facts.cabinImageAlt')} className="absolute inset-0 h-full w-full object-cover" sizes="(min-width: 768px) 50vw, 100vw" />
          </div>
          <div className="relative h-56 md:h-72 overflow-hidden bg-stone-200">
            <HomePicture image={HOME_IMAGES.valleyAframes} alt={t('facts.valleyImageAlt')} className="absolute inset-0 h-full w-full object-cover object-center" sizes="(min-width: 768px) 50vw, 100vw" />
          </div>
        </div>
        <div className="overflow-x-auto border border-[#E5E5E0]">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">{t('facts.title')}</caption>
            <thead className="bg-[#F6F1E8] text-[#1c1917]">
              <tr>
                <th scope="col" className="p-4 font-semibold w-[28%]">{t('facts.topic')}</th>
                <th scope="col" className="p-4 font-semibold">{t('facts.cabin')}</th>
                <th scope="col" className="p-4 font-semibold">{t('facts.valley')}</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row} className="border-t border-[#E5E5E0]">
                  <th scope="row" className="p-4 align-top text-stone-600 font-medium">{t(`facts.rows.${row}.label`)}</th>
                  <td className="p-4 align-top text-stone-900">{t(`facts.rows.${row}.cabin`)}</td>
                  <td className="p-4 align-top text-stone-900">{t(`facts.rows.${row}.valley`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-stone-700 max-w-3xl">{t('facts.note')}</p>
      </div>
    </section>
  );
}
