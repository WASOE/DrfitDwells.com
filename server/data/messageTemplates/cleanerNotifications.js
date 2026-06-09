'use strict';

const {
  CLEANER_VARIABLE_SCHEMA,
  COPY_SOURCE_NOTE,
  whatsappNotes
} = require('./gmaApprovedCopy');

const CLEANER_TEMPLATE_KEYS = Object.freeze([
  'cleaner_checkout_prep_cabin',
  'cleaner_checkout_prep_valley',
  'cleaner_checkout_today_cabin',
  'cleaner_checkout_today_valley'
]);

const CABIN_PREP_EMAIL_SUBJECT_EN =
  'Cleaning prep: {{propertyName}} · checkout {{checkOutDate}} / Подготовка за почистване';

const CABIN_PREP_EMAIL_BODY_EN_SIMPLE = [
  '<section lang="en">',
  '  <p><strong>Checkout tomorrow</strong> — {{propertyName}} · {{unitLabel}}</p>',
  '  <p>Check-out date: <strong>{{checkOutDate}}</strong> by <strong>{{checkoutTime}}</strong>.</p>',
  '  <p>Next check-in (if same-day turn): {{checkInDate}}</p>',
  '  <p><strong>Cleaning notes:</strong> {{cleaningNotes}}</p>',
  '  <p><strong>Access:</strong> {{accessNote}}</p>',
  '  <p><strong>Meeting point:</strong> {{meetingPointLabel}}<br>',
  '  Google Maps: <a href="{{googleMapsUrl}}">{{googleMapsUrl}}</a></p>',
  '  <p>Park at the designated point and continue on foot. Arrival guide: <a href="{{guideUrl}}">{{guideUrl}}</a></p>',
  '</section>'
].join('\n');

const CABIN_PREP_EMAIL_BODY_BG = [
  '<section lang="bg">',
  '  <p><strong>Напускане утре</strong> — {{propertyName}} · {{unitLabel}}</p>',
  '  <p>Дата на напускане: <strong>{{checkOutDate}}</strong> до <strong>{{checkoutTime}}</strong>.</p>',
  '  <p>Следващо настаняване (ако е същия ден): {{checkInDate}}</p>',
  '  <p><strong>Бележки за почистване:</strong> {{cleaningNotes}}</p>',
  '  <p><strong>Достъп:</strong> {{accessNote}}</p>',
  '  <p><strong>Място за среща:</strong> {{meetingPointLabel}}<br>',
  '  Google Maps: <a href="{{googleMapsUrl}}">{{googleMapsUrl}}</a></p>',
  '  <p>Паркирайте на определеното място и продължете пеша. Наръчник: <a href="{{guideUrl}}">{{guideUrl}}</a></p>',
  '</section>'
].join('\n');

const VALLEY_PREP_EMAIL_BODY_EN = [
  '<section lang="en">',
  '  <p><strong>Checkout tomorrow</strong> — {{propertyName}} · {{unitLabel}}</p>',
  '  <p>Check-out date: <strong>{{checkOutDate}}</strong> by <strong>{{checkoutTime}}</strong>.</p>',
  '  <p>Next check-in (if same-day turn): {{checkInDate}}</p>',
  '  <p><strong>Cleaning notes:</strong> {{cleaningNotes}}</p>',
  '  <p><strong>Valley access:</strong> {{accessNote}}</p>',
  '  <p>Route via Eleshnitsa, Palatik and Chereshovo — ignore Google Maps if it sends you through Kraishte.</p>',
  '  <p>Last ~1 km to the unit is on foot, jeep, horse or ATV only.</p>',
  '  <p><strong>Meeting point:</strong> {{meetingPointLabel}}<br>',
  '  <a href="{{googleMapsUrl}}">{{googleMapsUrl}}</a></p>',
  '  <p>Guide: <a href="{{guideUrl}}">{{guideUrl}}</a></p>',
  '</section>'
].join('\n');

const VALLEY_PREP_EMAIL_BODY_BG = [
  '<section lang="bg">',
  '  <p><strong>Напускане утре</strong> — {{propertyName}} · {{unitLabel}}</p>',
  '  <p>Дата на напускане: <strong>{{checkOutDate}}</strong> до <strong>{{checkoutTime}}</strong>.</p>',
  '  <p>Следващо настаняване: {{checkInDate}}</p>',
  '  <p><strong>Бележки:</strong> {{cleaningNotes}}</p>',
  '  <p><strong>Достъп до Valley:</strong> {{accessNote}}</p>',
  '  <p>Маршрут през Еленшица, Палатик и Черешово — не следвайте Google Maps през Крайще.</p>',
  '  <p>Последният ~1 км е пеша, с джип, кон или ATV.</p>',
  '  <p><strong>Среща:</strong> {{meetingPointLabel}} — <a href="{{googleMapsUrl}}">{{googleMapsUrl}}</a></p>',
  '  <p>Наръчник: <a href="{{guideUrl}}">{{guideUrl}}</a></p>',
  '</section>'
].join('\n');

const CABIN_TODAY_EMAIL_BODY_EN = [
  '<section lang="en">',
  '  <p><strong>Checkout today</strong> — {{propertyName}} · {{unitLabel}}</p>',
  '  <p>Check-out: <strong>{{checkOutDate}}</strong> by <strong>{{checkoutTime}}</strong>.</p>',
  '  <p>Next check-in: {{checkInDate}}</p>',
  '  <p><strong>Cleaning notes:</strong> {{cleaningNotes}}</p>',
  '  <p><strong>Access:</strong> {{accessNote}}</p>',
  '  <p><strong>Meeting point:</strong> {{meetingPointLabel}} — <a href="{{googleMapsUrl}}">{{googleMapsUrl}}</a></p>',
  '  <p>Park and walk. Guide: <a href="{{guideUrl}}">{{guideUrl}}</a></p>',
  '</section>'
].join('\n');

const CABIN_TODAY_EMAIL_BODY_BG = [
  '<section lang="bg">',
  '  <p><strong>Напускане днес</strong> — {{propertyName}} · {{unitLabel}}</p>',
  '  <p>Напускане: <strong>{{checkOutDate}}</strong> до <strong>{{checkoutTime}}</strong>.</p>',
  '  <p>Следващо настаняване: {{checkInDate}}</p>',
  '  <p><strong>Бележки:</strong> {{cleaningNotes}}</p>',
  '  <p><strong>Достъп:</strong> {{accessNote}}</p>',
  '  <p><strong>Среща:</strong> {{meetingPointLabel}} — <a href="{{googleMapsUrl}}">{{googleMapsUrl}}</a></p>',
  '  <p>Паркиране и пеша част. Наръчник: <a href="{{guideUrl}}">{{guideUrl}}</a></p>',
  '</section>'
].join('\n');

const VALLEY_TODAY_EMAIL_BODY_EN = [
  '<section lang="en">',
  '  <p><strong>Checkout today</strong> — {{propertyName}} · {{unitLabel}}</p>',
  '  <p>Check-out: <strong>{{checkOutDate}}</strong> by <strong>{{checkoutTime}}</strong>.</p>',
  '  <p>Next check-in: {{checkInDate}}</p>',
  '  <p><strong>Cleaning notes:</strong> {{cleaningNotes}}</p>',
  '  <p><strong>Valley access:</strong> {{accessNote}}</p>',
  '  <p>Route: Eleshnitsa → Palatik → Chereshovo (not Kraishte). Last ~1 km on foot/jeep/horse/ATV.</p>',
  '  <p><strong>Meeting point:</strong> {{meetingPointLabel}} — <a href="{{googleMapsUrl}}">{{googleMapsUrl}}</a></p>',
  '</section>'
].join('\n');

const VALLEY_TODAY_EMAIL_BODY_BG = [
  '<section lang="bg">',
  '  <p><strong>Напускане днес</strong> — {{propertyName}} · {{unitLabel}}</p>',
  '  <p>Напускане: <strong>{{checkOutDate}}</strong> до <strong>{{checkoutTime}}</strong>.</p>',
  '  <p>Следващо настаняване: {{checkInDate}}</p>',
  '  <p><strong>Бележки:</strong> {{cleaningNotes}}</p>',
  '  <p>Маршрут: Еленшица → Палатик → Черешово. Последен ~1 км пеша/джип/кон/ATV.</p>',
  '  <p><strong>Среща:</strong> {{meetingPointLabel}} — <a href="{{googleMapsUrl}}">{{googleMapsUrl}}</a></p>',
  '</section>'
].join('\n');

const CABIN_PREP_WA_BODY = [
  'Checkout tomorrow — {{propertyName}}',
  '{{unitLabel}}',
  '',
  'Check-out: {{checkOutDate}} by {{checkoutTime}}',
  'Next check-in: {{checkInDate}}',
  'Notes: {{cleaningNotes}}',
  '',
  'Access: {{accessNote}}',
  'Meeting point: {{meetingPointLabel}}',
  '{{googleMapsUrl}}',
  'Park and walk. Guide: {{guideUrl}}',
  '',
  '---',
  '',
  'Напускане утре — {{propertyName}}',
  '{{unitLabel}}',
  '',
  'Напускане: {{checkOutDate}} до {{checkoutTime}}',
  'Бележки: {{cleaningNotes}}',
  '',
  'Достъп: {{accessNote}}',
  '{{meetingPointLabel}}',
  '{{googleMapsUrl}}'
].join('\n');

const VALLEY_PREP_WA_BODY = [
  'Checkout tomorrow — {{propertyName}} (Valley)',
  '',
  'Check-out: {{checkOutDate}} by {{checkoutTime}}',
  'Notes: {{cleaningNotes}}',
  '',
  'Valley access: last ~1 km on foot, jeep, horse or ATV.',
  'Route via Eleshnitsa, Palatik, Chereshovo — not Kraishte.',
  '{{meetingPointLabel}}',
  '{{googleMapsUrl}}',
  '{{guideUrl}}',
  '',
  '---',
  '',
  'Напускане утре — {{propertyName}} (Valley)',
  'Маршрут: Еленшица, Палатик, Черешово. Последен км пеша/джип/кон/ATV.',
  '{{meetingPointLabel}}',
  '{{googleMapsUrl}}'
].join('\n');

const CABIN_TODAY_WA_BODY = [
  'Checkout TODAY — {{propertyName}} · {{unitLabel}}',
  '{{checkOutDate}} by {{checkoutTime}}',
  'Notes: {{cleaningNotes}}',
  'Access: {{accessNote}}',
  '{{meetingPointLabel}}',
  '{{googleMapsUrl}}',
  '',
  '---',
  '',
  'Напускане ДНЕС — {{propertyName}}',
  '{{checkOutDate}} до {{checkoutTime}}',
  '{{meetingPointLabel}}'
].join('\n');

const VALLEY_TODAY_WA_BODY = [
  'Checkout TODAY — Valley · {{propertyName}}',
  '{{checkOutDate}} by {{checkoutTime}}',
  'Notes: {{cleaningNotes}}',
  'Eleshnitsa / Palatik / Chereshovo route. Last km foot/jeep/horse/ATV.',
  '{{meetingPointLabel}}',
  '{{googleMapsUrl}}',
  '',
  '---',
  '',
  'Напускане ДНЕС — Valley',
  '{{checkOutDate}} · {{meetingPointLabel}}'
].join('\n');

const COPY_BY_KEY = Object.freeze({
  cleaner_checkout_prep_cabin: {
    propertyKind: 'cabin',
    emailSubjectEn: CABIN_PREP_EMAIL_SUBJECT_EN,
    emailSubjectBg: 'Подготовка за почистване: {{propertyName}} · {{checkOutDate}}',
    emailBodyEn: CABIN_PREP_EMAIL_BODY_EN_SIMPLE,
    emailBodyBg: CABIN_PREP_EMAIL_BODY_BG,
    whatsappBody: CABIN_PREP_WA_BODY
  },
  cleaner_checkout_prep_valley: {
    propertyKind: 'valley',
    emailSubjectEn: 'Cleaning prep (Valley): {{propertyName}} · {{checkOutDate}}',
    emailSubjectBg: 'Подготовка Valley: {{propertyName}} · {{checkOutDate}}',
    emailBodyEn: VALLEY_PREP_EMAIL_BODY_EN,
    emailBodyBg: VALLEY_PREP_EMAIL_BODY_BG,
    whatsappBody: VALLEY_PREP_WA_BODY
  },
  cleaner_checkout_today_cabin: {
    propertyKind: 'cabin',
    emailSubjectEn: 'Checkout today: {{propertyName}} · {{checkOutDate}}',
    emailSubjectBg: 'Напускане днес: {{propertyName}} · {{checkOutDate}}',
    emailBodyEn: CABIN_TODAY_EMAIL_BODY_EN,
    emailBodyBg: CABIN_TODAY_EMAIL_BODY_BG,
    whatsappBody: CABIN_TODAY_WA_BODY
  },
  cleaner_checkout_today_valley: {
    propertyKind: 'valley',
    emailSubjectEn: 'Checkout today (Valley): {{propertyName}} · {{checkOutDate}}',
    emailSubjectBg: 'Напускане днес Valley: {{propertyName}} · {{checkOutDate}}',
    emailBodyEn: VALLEY_TODAY_EMAIL_BODY_EN,
    emailBodyBg: VALLEY_TODAY_EMAIL_BODY_BG,
    whatsappBody: VALLEY_TODAY_WA_BODY
  }
});

function buildCleanerTemplateRow({ key, channel, locale, propertyKind, emailSubject, emailBodyMarkup, whatsappTemplateName, whatsappBody }) {
  const shared = {
    key,
    version: 1,
    channel,
    locale,
    propertyKind,
    status: 'draft',
    variableSchema: CLEANER_VARIABLE_SCHEMA,
    approvedBy: null,
    approvedAt: null
  };
  if (channel === 'email') {
    return {
      ...shared,
      emailSubject,
      emailBodyMarkup,
      whatsappTemplateName: null,
      whatsappLocale: null,
      notes: COPY_SOURCE_NOTE
    };
  }
  return {
    ...shared,
    emailSubject: null,
    emailBodyMarkup: null,
    whatsappTemplateName,
    whatsappLocale: locale,
    notes: whatsappNotes(whatsappTemplateName, whatsappBody)
  };
}

function buildAllCleanerTemplates() {
  const rows = [];
  for (const key of CLEANER_TEMPLATE_KEYS) {
    const copy = COPY_BY_KEY[key];
    rows.push(
      buildCleanerTemplateRow({
        key,
        channel: 'email',
        locale: 'en',
        propertyKind: copy.propertyKind,
        emailSubject: copy.emailSubjectEn,
        emailBodyMarkup: copy.emailBodyEn
      }),
      buildCleanerTemplateRow({
        key,
        channel: 'email',
        locale: 'bg',
        propertyKind: copy.propertyKind,
        emailSubject: copy.emailSubjectBg,
        emailBodyMarkup: copy.emailBodyBg
      }),
      buildCleanerTemplateRow({
        key,
        channel: 'whatsapp',
        locale: 'en',
        propertyKind: copy.propertyKind,
        whatsappTemplateName: `${key}_v1_en`,
        whatsappBody: copy.whatsappBody
      }),
      buildCleanerTemplateRow({
        key,
        channel: 'whatsapp',
        locale: 'bg',
        propertyKind: copy.propertyKind,
        whatsappTemplateName: `${key}_v1_bg`,
        whatsappBody: copy.whatsappBody
      })
    );
  }
  return rows;
}

const ALL_CLEANER_TEMPLATES = Object.freeze(buildAllCleanerTemplates());

module.exports = {
  CLEANER_TEMPLATE_KEYS,
  buildAllCleanerTemplates,
  ALL_CLEANER_TEMPLATES
};
