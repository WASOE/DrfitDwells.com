'use strict';

const { buildGuestTransactionalHtml } = require('../emailTemplates/guestLifecycleLayout');
const { htmlEscape } = require('../../utils/htmlEscape');

const SITE_ORIGIN = (process.env.EMAIL_PUBLIC_ASSET_ORIGIN || 'https://driftdwells.com').replace(/\/$/, '');
const CABIN_URL = 'https://driftdwells.com/cabin/';
const DEFAULT_PHOTO = 'https://driftdwells.com/uploads/Videos/The-cabin-header.winter-poster.jpg';

function resolveBrandLogoAbsoluteUrl() {
  const explicit = (process.env.EMAIL_BRAND_LOGO_URL || '').trim();
  if (explicit.startsWith('http')) return explicit;
  const path = (process.env.EMAIL_BRAND_LOGO_PATH || '/uploads/Logo/DRIFTS-01.png').trim();
  return `${SITE_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}

function photoUrl() {
  return (process.env.CABIN_PRIORITY_PHOTO_URL || DEFAULT_PHOTO).trim();
}

function privacyUrl(language) {
  return `${SITE_ORIGIN}${language === 'bg' ? '/bg' : ''}/privacy/`;
}

function monthLabel(language, month) {
  if (!month || month === 'flexible') return '';
  const names = {
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    bg: ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември']
  };
  const list = names[language === 'bg' ? 'bg' : 'en'];
  const idx = String(month).toLowerCase();
  const pos = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].indexOf(idx);
  return pos >= 0 ? list[pos] : '';
}

function buildCabinWelcomeEmail({ lead, unsubscribeUrl, language = 'en' }) {
  const lang = language === 'bg' ? 'bg' : 'en';
  const month = monthLabel(lang, lead?.preferredMonth);
  const isBg = lang === 'bg';
  const subject = isBg ? 'Вие сте в списъка с приоритети на The Cabin' : "You're on The Cabin priority list";
  const preheader = isBg
    ? 'Някои места си заслужава да почакаш. Ето какво следва.'
    : "Some places are worth waiting for. Here's what happens next.";

  const copy = isBg
    ? {
      eyebrow: 'THE CABIN · DRIFT & DWELLS',
      headline: 'Някои места си заслужава да почакаш.',
      onList: 'Вие сте в списъка.',
      thanks: 'Благодарим ви, че се присъединихте към списъка с приоритети на The Cabin.',
      intro: 'Скрита в гората край Бачево, The Cabin е малко място за двама. Тихи утрини, свеж планински въздух и време за откъсване.',
      winter: 'Зимата тук е различна. Горските условия правят достъпа по-труден, затова пускаме ограничен брой престои, вместо да държим целия календар отворен.',
      when: 'Когато бъдат пуснати нови дати за The Cabin, ще ви уведомим по имейл.',
      month: month ? `Отбелязахме, че предпочитате ${month}.` : '',
      cta: 'РАЗГЛЕДАЙТЕ THE CABIN',
      footnote1: 'Присъединяването към списъка с приоритети е безплатно. То не резервира дати и не гарантира свободни места.',
      footnote2: 'Надяваме се един ден да ви посрещнем в гората.',
      signature: 'Drift & Dwells',
      footer: 'Получавате този имейл, защото се присъединихте към списъка с приоритети на The Cabin.',
      unsubscribe: 'Отпишете се от известията за The Cabin'
    }
    : {
      eyebrow: 'THE CABIN · DRIFT & DWELLS',
      headline: 'Some places are worth waiting for.',
      onList: "You're on the list.",
      thanks: 'Thank you for joining The Cabin priority list.',
      intro: 'Hidden away in the forest near Bachevo, The Cabin is a little place for two. Quiet mornings, fresh mountain air, and time to disconnect.',
      winter: 'Winter is different here. Forest conditions make access more challenging, so we release a limited number of stays rather than keeping the entire calendar open.',
      when: "When new Cabin dates are released, we'll let you know by email.",
      month: month ? `We noted that you prefer ${month}.` : '',
      cta: 'EXPLORE THE CABIN',
      footnote1: "Joining the priority list is free. It doesn't reserve dates or guarantee availability.",
      footnote2: 'We hope to welcome you to the forest one day.',
      signature: 'Drift & Dwells',
      footer: 'You received this email because you joined The Cabin priority list.',
      unsubscribe: 'Unsubscribe from Cabin updates'
    };

  const bodyHtml = `
    <p style="margin:0 0 10px;font-size:11px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#81887A;">${htmlEscape(copy.eyebrow)}</p>
    <h1 class="email-heading">${htmlEscape(copy.headline)}</h1>
    <img src="${htmlEscape(photoUrl())}" alt="The Cabin in winter" width="536" style="display:block;width:100%;max-width:536px;height:auto;border-radius:12px;margin:6px 0 22px;border:0;" />
    <p style="margin:0 0 14px;font-weight:600;color:#1a1918;">${htmlEscape(copy.onList)}</p>
    <p>${htmlEscape(copy.thanks)}</p>
    <p>${htmlEscape(copy.intro)}</p>
    <p>${htmlEscape(copy.winter)}</p>
    <p>${htmlEscape(copy.when)}</p>
    ${copy.month ? `<p style="color:#6b6a64;font-size:15px;">${htmlEscape(copy.month)}</p>` : ''}
    <p style="margin:26px 0 24px;text-align:center;">
      <a class="btn" href="${CABIN_URL}" style="background:${'#81887A'};">${htmlEscape(copy.cta)}</a>
    </p>
    <p style="font-size:13px;color:#6b6a64;">${htmlEscape(copy.footnote1)}</p>
    <p style="font-size:13px;color:#6b6a64;">${htmlEscape(copy.footnote2)}</p>
    <p style="margin-top:20px;">${htmlEscape(copy.signature)}</p>
  `;

  const footerHtml = `
    <div class="footer">
      <p>${htmlEscape(copy.footer)}</p>
      <p><a href="${htmlEscape(unsubscribeUrl)}">${htmlEscape(copy.unsubscribe)}</a></p>
      <p><a href="${htmlEscape(privacyUrl(lang))}">${lang === 'bg' ? 'Политика за поверителност' : 'Privacy policy'}</a></p>
      <p class="footer-legal">© ${new Date().getFullYear()} Drift &amp; Dwells</p>
    </div>`;

  const html = buildGuestTransactionalHtml({
    title: subject,
    preheader,
    logoUrl: resolveBrandLogoAbsoluteUrl(),
    siteHomeUrl: SITE_ORIGIN,
    headerTagline: `<p style="margin:0;font-family:Inter,sans-serif;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#7a7870;">${htmlEscape(copy.eyebrow)}</p>`,
    bodyHtml,
    footerHtml
  });

  const text = [
    copy.headline,
    '',
    copy.onList,
    '',
    copy.thanks,
    '',
    copy.intro,
    '',
    copy.winter,
    '',
    copy.when,
    ...(copy.month ? ['', copy.month] : []),
    '',
    `${copy.cta}: ${CABIN_URL}`,
    '',
    copy.footnote1,
    copy.footnote2,
    '',
    copy.signature,
    '',
    '--',
    copy.footer,
    `${copy.unsubscribe}: ${unsubscribeUrl}`,
    `${lang === 'bg' ? 'Политика за поверителност' : 'Privacy policy'}: ${privacyUrl(lang)}`
  ].join('\n');

  return { subject, preheader, html, text };
}

module.exports = {
  buildCabinWelcomeEmail,
  monthLabel,
  photoUrl,
  privacyUrl,
  resolveBrandLogoAbsoluteUrl
};
