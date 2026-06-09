'use strict';

/**
 * Approved GMA bilingual copy (source: GMA_bilingual_message_copy_for_Cursor.md).
 * Used by seed data and gmaReplaceTemplateCopy.cjs. Templates remain draft.
 */

const COPY_SOURCE_NOTE =
  'Approved copy from GMA_bilingual_message_copy_for_Cursor.md. Status must remain draft until human approval.';

const GUEST_TEMPLATE_VARIABLE_SCHEMA = Object.freeze({
  type: 'object',
  required: [
    'guestFirstName',
    'propertyName',
    'checkInDate',
    'checkOutDate',
    'arrivalWindow',
    'meetingPointLabel',
    'googleMapsUrl',
    'guideUrl'
  ],
  properties: {
    guestFirstName: { type: 'string' },
    propertyName: { type: 'string' },
    checkInDate: { type: 'string' },
    checkOutDate: { type: 'string' },
    arrivalWindow: { type: 'string' },
    meetingPointLabel: { type: 'string' },
    googleMapsUrl: { type: 'string' },
    guideUrl: { type: 'string' }
  },
  additionalProperties: false
});

const CABIN_EMAIL_SUBJECT =
  'Your arrival to The Cabin / Пристигане в The Cabin - {{checkInDate}}';

const CABIN_EMAIL_BODY = [
  '<section lang="en">',
  '  <p>Hi {{guestFirstName}},</p>',
  '',
  '  <p>Your stay at <strong>The Cabin</strong> is coming up soon. You arrive on <strong>{{checkInDate}}</strong> and check out on <strong>{{checkOutDate}}</strong>.</p>',
  '',
  '  <p><strong>Check-in:</strong> {{arrivalWindow}}</p>',
  '',
  '  <p>The Cabin is a real off-grid stay in nature. It is set in a quiet forest valley, with full privacy and no shops or amenities nearby. Please arrive prepared with food, water, and everything you need for your stay.</p>',
  '',
  '  <p><strong>Arrival point:</strong><br>',
  '  {{meetingPointLabel}}<br>',
  '  Google Maps: <a href="{{googleMapsUrl}}">{{googleMapsUrl}}</a></p>',
  '',
  '  <p>Please do not search for a different route in Google Maps. Follow the link and the arrival guide, because access to The Cabin is specific.</p>',
  '',
  '  <p><strong>Full arrival guide:</strong><br>',
  '  <a href="{{guideUrl}}">{{guideUrl}}</a></p>',
  '',
  '  <p>You will park at the designated point and continue on foot to the cabin. Bring practical luggage that is easy to carry. If you plan to arrive later in the day, please message us in advance so we can coordinate calmly.</p>',
  '',
  '  <p><strong>What to prepare:</strong><br>',
  '  Comfortable shoes, layered clothing, a rain jacket, a headlamp or flashlight, food, drinks, and personal items for an off-grid stay.</p>',
  '',
  '  <p>If you have questions before arrival, reply to this email.</p>',
  '',
  '  <p>We look forward to hosting you.<br>',
  '  Drift & Dwells</p>',
  '</section>',
  '',
  '<hr>',
  '',
  '<section lang="bg">',
  '  <p>Здравейте, {{guestFirstName}},</p>',
  '',
  '  <p>Остават само няколко дни до престоя ви в <strong>The Cabin</strong>. Очакваме ви на <strong>{{checkInDate}}</strong>, а напускането е на <strong>{{checkOutDate}}</strong>.</p>',
  '',
  '  <p><strong>Настаняване:</strong> {{arrivalWindow}}</p>',
  '',
  '  <p>The Cabin е истинско off-grid преживяване сред природата. Мястото е в тиха горска долина, с пълно уединение и без магазини или удобства наблизо. Моля, подгответе храна, вода и всичко необходимо за престоя предварително.</p>',
  '',
  '  <p><strong>Място за пристигане:</strong><br>',
  '  {{meetingPointLabel}}<br>',
  '  Google Maps: <a href="{{googleMapsUrl}}">{{googleMapsUrl}}</a></p>',
  '',
  '  <p>Моля, не търсете друг маршрут в Google Maps. Следвайте линка и наръчника за пристигане, защото достъпът до The Cabin е специфичен.</p>',
  '',
  '  <p><strong>Пълен наръчник за пристигане:</strong><br>',
  '  <a href="{{guideUrl}}">{{guideUrl}}</a></p>',
  '',
  '  <p>Паркира се на определеното място и последната част до кабината е пеша. Препоръчваме практичен багаж, който може лесно да се носи. Ако пристигате по-късно през деня, моля, пишете ни предварително, за да координираме всичко спокойно.</p>',
  '',
  '  <p><strong>Какво да подготвите:</strong><br>',
  '  Удобни обувки, дрехи на слоеве, яке за дъжд, челник или фенер, храна, напитки и лични неща за off-grid престой.</p>',
  '',
  '  <p>Ако имате въпроси преди пристигането, отговорете на този имейл.</p>',
  '',
  '  <p>Очакваме ви с радост.<br>',
  '  Drift & Dwells</p>',
  '</section>'
].join('\n');

const CABIN_WHATSAPP_BODY = [
  'Hi {{guestFirstName}}',
  '',
  'Your stay at The Cabin is coming up soon.',
  '',
  'Check-in: {{checkInDate}}',
  'Check-out: {{checkOutDate}}',
  '',
  'The Cabin is a real off-grid stay in nature, with full privacy and no shops or amenities nearby. Please prepare food, water, and everything you need in advance.',
  '',
  'Arrival point:',
  '{{meetingPointLabel}}',
  '{{googleMapsUrl}}',
  '',
  'Please follow this link and the arrival guide, not a different route in Google Maps.',
  '',
  'Full arrival guide:',
  '{{guideUrl}}',
  '',
  'You will park at the designated point and continue on foot to the cabin, so practical luggage that is easy to carry is best.',
  '',
  'If you plan to arrive later in the day, please message us in advance.',
  '',
  'We look forward to hosting you.',
  '',
  '---',
  '',
  'Здравейте, {{guestFirstName}}',
  '',
  'Остават само няколко дни до престоя ви в The Cabin.',
  '',
  'Настаняване: {{checkInDate}}',
  'Напускане: {{checkOutDate}}',
  '',
  'The Cabin е истинско off-grid преживяване сред природата, с пълно уединение и без магазини или удобства наблизо. Моля, подгответе храна, вода и всичко необходимо предварително.',
  '',
  'Място за пристигане:',
  '{{meetingPointLabel}}',
  '{{googleMapsUrl}}',
  '',
  'Моля, следвайте този линк и наръчника за пристигане, а не друг маршрут в Google Maps.',
  '',
  'Пълен наръчник за пристигане:',
  '{{guideUrl}}',
  '',
  'Паркира се на определеното място и последната част до кабината е пеша, затова е най-добре багажът да е практичен и лесен за носене.',
  '',
  'Ако пристигате по-късно през деня, моля, пишете ни предварително.',
  '',
  'Очакваме ви с радост.'
].join('\n');

const VALLEY_EMAIL_SUBJECT =
  'Your arrival to The Valley / Пристигане в The Valley - {{checkInDate}}';

const VALLEY_EMAIL_BODY = [
  '<section lang="en">',
  '  <p>Hi {{guestFirstName}},</p>',
  '',
  '  <p>Your stay at <strong>{{propertyName}}</strong> in The Valley is coming up soon. You arrive on <strong>{{checkInDate}}</strong> and check out on <strong>{{checkOutDate}}</strong>.</p>',
  '',
  '  <p><strong>Check-in:</strong> {{arrivalWindow}}</p>',
  '',
  '  <p>The Valley is a quiet off-grid place in the mountains, surrounded by forest and nature. There are no shops or amenities nearby, so please arrive prepared with food, drinks, and personal items for your stay.</p>',
  '',
  '  <p><strong>Route and arrival point:</strong><br>',
  '  {{meetingPointLabel}}<br>',
  '  Google Maps: <a href="{{googleMapsUrl}}">{{googleMapsUrl}}</a></p>',
  '',
  '  <p>Please use the route link we send you. Do not rely on a random Google Maps route. Google Maps may send guests the wrong way, especially through Kraishte. The correct route goes through Eleshnitsa, Palatik, and Chereshovo.</p>',
  '',
  '  <p>The last section to The Valley is around 1 km and is not standard car access. It can be done on foot, by jeep, horse, or ATV, depending on prior arrangement and conditions on site.</p>',
  '',
  '  <p><strong>Full arrival guide:</strong><br>',
  '  <a href="{{guideUrl}}">{{guideUrl}}</a></p>',
  '',
  '  <p>Please plan your luggage practically. If you have more luggage or plan to arrive later in the day, message us in advance so we can coordinate your arrival calmly.</p>',
  '',
  '  <p><strong>What to prepare:</strong><br>',
  '  Comfortable shoes, layered clothing, a rain jacket, food, drinks, and everything personal you need for a stay in nature.</p>',
  '',
  '  <p>If you have questions before arrival, reply to this email.</p>',
  '',
  '  <p>We look forward to hosting you.<br>',
  '  Drift & Dwells</p>',
  '</section>',
  '',
  '<hr>',
  '',
  '<section lang="bg">',
  '  <p>Здравейте, {{guestFirstName}},</p>',
  '',
  '  <p>Остават само няколко дни до престоя ви в <strong>{{propertyName}}</strong> в The Valley. Очакваме ви на <strong>{{checkInDate}}</strong>, а напускането е на <strong>{{checkOutDate}}</strong>.</p>',
  '',
  '  <p><strong>Настаняване:</strong> {{arrivalWindow}}</p>',
  '',
  '  <p>The Valley е спокойно off-grid място в планината, заобиколено от гора и природа. Наблизо няма магазини или удобства, затова е важно да дойдете подготвени с храна, напитки и лични неща за престоя.</p>',
  '',
  '  <p><strong>Маршрут и място за пристигане:</strong><br>',
  '  {{meetingPointLabel}}<br>',
  '  Google Maps: <a href="{{googleMapsUrl}}">{{googleMapsUrl}}</a></p>',
  '',
  '  <p>Моля, използвайте линка за маршрут, който ви изпращаме. Не разчитайте на случаен маршрут в Google Maps. Google Maps може да изпрати гостите по грешен път, особено през Kraishte. Правилният маршрут минава през Eleshnitsa, Palatik и Chereshovo.</p>',
  '',
  '  <p>Последният участък до The Valley е около 1 км и не е стандартен автомобилен достъп. Може да се стигне пеша, с джип, кон или ATV, според предварителната организация и условията на място.</p>',
  '',
  '  <p><strong>Пълен наръчник за пристигане:</strong><br>',
  '  <a href="{{guideUrl}}">{{guideUrl}}</a></p>',
  '',
  '  <p>Моля, планирайте багажа си практично. Ако имате повече багаж или пристигате по-късно през деня, пишете ни предварително, за да координираме пристигането спокойно.</p>',
  '',
  '  <p><strong>Какво да подготвите:</strong><br>',
  '  Удобни обувки, дрехи на слоеве, яке за дъжд, храна, напитки и всичко лично необходимо за престой сред природата.</p>',
  '',
  '  <p>Ако имате въпроси преди пристигането, отговорете на този имейл.</p>',
  '',
  '  <p>Очакваме ви с радост.<br>',
  '  Drift & Dwells</p>',
  '</section>'
].join('\n');

const VALLEY_WHATSAPP_BODY = [
  'Hi {{guestFirstName}}',
  '',
  'Your stay at {{propertyName}} in The Valley is coming up soon.',
  '',
  'Check-in: {{checkInDate}}',
  'Check-out: {{checkOutDate}}',
  '',
  'The Valley is a quiet off-grid place in the mountains, surrounded by forest and nature. There are no shops or amenities nearby, so please prepare food, drinks, and everything you need in advance.',
  '',
  'Route and arrival point:',
  '{{meetingPointLabel}}',
  '{{googleMapsUrl}}',
  '',
  'Please use this route link. Do not follow a random Google Maps route. Google Maps may send guests the wrong way, especially through Kraishte. The correct route goes through Eleshnitsa, Palatik, and Chereshovo.',
  '',
  'The last section to The Valley is around 1 km and can be done on foot, by jeep, horse, or ATV, depending on prior arrangement and conditions on site.',
  '',
  'Full arrival guide:',
  '{{guideUrl}}',
  '',
  'If you have more luggage or plan to arrive later in the day, please message us in advance.',
  '',
  'We look forward to hosting you.',
  '',
  '---',
  '',
  'Здравейте, {{guestFirstName}}',
  '',
  'Остават само няколко дни до престоя ви в {{propertyName}} в The Valley.',
  '',
  'Настаняване: {{checkInDate}}',
  'Напускане: {{checkOutDate}}',
  '',
  'The Valley е спокойно off-grid място в планината, заобиколено от гора и природа. Наблизо няма магазини или удобства, затова е важно да подготвите храна, напитки и всичко необходимо предварително.',
  '',
  'Маршрут и място за пристигане:',
  '{{meetingPointLabel}}',
  '{{googleMapsUrl}}',
  '',
  'Моля, използвайте този линк за маршрут. Не следвайте случаен маршрут в Google Maps. Google Maps може да изпрати гостите по грешен път, особено през Kraishte. Правилният маршрут минава през Eleshnitsa, Palatik и Chereshovo.',
  '',
  'Последният участък до The Valley е около 1 км и се стига пеша, с джип, кон или ATV, според предварителната организация и условията на място.',
  '',
  'Пълен наръчник за пристигане:',
  '{{guideUrl}}',
  '',
  'Ако имате повече багаж или пристигате по-късно през деня, моля, пишете ни предварително.',
  '',
  'Очакваме ви с радост.'
].join('\n');

function whatsappNotes(templateName, body) {
  return [
    COPY_SOURCE_NOTE,
    `Meta template name: ${templateName}.`,
    'WhatsApp reference body (bilingual, for Meta submission — not rendered from DB MessageTemplate fields):',
    '',
    body
  ].join('\n');
}

const OPS_ARRIVING_8D_SUBJECT =
  '[Drift & Dwells OPS] Arriving in 8 days / Пристигане след 8 дни: {{propertyName}} - {{guestFirstName}}';

const OPS_ARRIVING_8D_BODY = [
  '<section lang="en">',
  '  <p><strong>Guest arrives in 8 days.</strong></p>',
  '  <p>',
  '    Name: {{guestFirstName}}<br>',
  '    Property: {{propertyName}}<br>',
  '    Check-in: {{checkInDate}}<br>',
  '    Check-out: {{checkOutDate}}<br>',
  '    Arrival window: {{arrivalWindow}}',
  '  </p>',
  '  <p>Please check that the reservation, property preparation, access instructions, and guest communication are in order.</p>',
  '</section>',
  '<hr>',
  '<section lang="bg">',
  '  <p><strong>Гостът пристига след 8 дни.</strong></p>',
  '  <p>',
  '    Име: {{guestFirstName}}<br>',
  '    Място: {{propertyName}}<br>',
  '    Настаняване: {{checkInDate}}<br>',
  '    Напускане: {{checkOutDate}}<br>',
  '    Прозорец за пристигане: {{arrivalWindow}}',
  '  </p>',
  '  <p>Моля, проверете дали резервацията, подготовката на мястото, инструкциите за достъп и комуникацията с госта са наред.</p>',
  '</section>'
].join('\n');

const OPS_CHECKIN_TOMORROW_SUBJECT =
  '[Drift & Dwells OPS] Check-in tomorrow / Настаняване утре: {{propertyName}} - {{guestFirstName}}';

const OPS_CHECKIN_TOMORROW_BODY = [
  '<section lang="en">',
  '  <p><strong>Guest checks in tomorrow.</strong></p>',
  '  <p>',
  '    Name: {{guestFirstName}}<br>',
  '    Property: {{propertyName}}<br>',
  '    Check-in: {{checkInDate}}<br>',
  '    Check-out: {{checkOutDate}}<br>',
  '    Arrival window: {{arrivalWindow}}',
  '  </p>',
  '  <p>Please do a final check of property preparation, access, guest communication, and any special reservation notes.</p>',
  '</section>',
  '<hr>',
  '<section lang="bg">',
  '  <p><strong>Гостът се настанява утре.</strong></p>',
  '  <p>',
  '    Име: {{guestFirstName}}<br>',
  '    Място: {{propertyName}}<br>',
  '    Настаняване: {{checkInDate}}<br>',
  '    Напускане: {{checkOutDate}}<br>',
  '    Прозорец за пристигане: {{arrivalWindow}}',
  '  </p>',
  '  <p>Моля, направете последна проверка на подготовката, достъпа, комуникацията с госта и всички специални бележки по резервацията.</p>',
  '</section>'
].join('\n');

const OPS_CHECKOUT_TODAY_SUBJECT =
  '[Drift & Dwells OPS] Checkout today / Напускане днес: {{propertyName}} - {{guestFirstName}}';

const OPS_CHECKOUT_TODAY_BODY = [
  '<section lang="en">',
  '  <p><strong>Guest checks out today.</strong></p>',
  '  <p>',
  '    Name: {{guestFirstName}}<br>',
  '    Property: {{propertyName}}<br>',
  '    Check-in: {{checkInDate}}<br>',
  '    Check-out: {{checkOutDate}}',
  '  </p>',
  '  <p>Please check the checkout timing, guest communication, and preparation for cleaning or the next reservation.</p>',
  '</section>',
  '<hr>',
  '<section lang="bg">',
  '  <p><strong>Гостът напуска днес.</strong></p>',
  '  <p>',
  '    Име: {{guestFirstName}}<br>',
  '    Място: {{propertyName}}<br>',
  '    Настаняване: {{checkInDate}}<br>',
  '    Напускане: {{checkOutDate}}',
  '  </p>',
  '  <p>Моля, проверете часа за напускане, комуникацията с госта и подготовката за почистване или следваща резервация.</p>',
  '</section>'
].join('\n');

const OPS_VARIABLE_SCHEMA = Object.freeze({
  type: 'object',
  required: ['guestFirstName', 'propertyName', 'checkInDate', 'checkOutDate', 'arrivalWindow'],
  properties: {
    guestFirstName: { type: 'string' },
    propertyName: { type: 'string' },
    checkInDate: { type: 'string' },
    checkOutDate: { type: 'string' },
    arrivalWindow: { type: 'string' }
  },
  additionalProperties: false
});

/** Cleaning notifications (C5) — operational only; no guest PII. */
const CLEANER_VARIABLE_SCHEMA = Object.freeze({
  type: 'object',
  required: [
    'propertyName',
    'checkOutDate',
    'checkoutTime',
    'meetingPointLabel',
    'googleMapsUrl'
  ],
  properties: {
    propertyName: { type: 'string' },
    unitLabel: { type: 'string' },
    checkOutDate: { type: 'string' },
    checkInDate: { type: 'string' },
    checkoutTime: { type: 'string' },
    cleaningNotes: { type: 'string' },
    meetingPointLabel: { type: 'string' },
    googleMapsUrl: { type: 'string' },
    meetingPointWhat3words: { type: 'string' },
    guideUrl: { type: 'string' },
    accessNote: { type: 'string' }
  },
  additionalProperties: false
});

/** Desired copy slices keyed for maintenance script identity matching. */
const GMA_TEMPLATE_COPY_TARGETS = Object.freeze([
  {
    key: 'arrival_3d_the_cabin',
    channel: 'email',
    locale: 'en',
    propertyKind: 'cabin',
    version: 1,
    label: 'arrival_3d_the_cabin / email',
    desired: {
      emailSubject: CABIN_EMAIL_SUBJECT,
      emailBodyMarkup: CABIN_EMAIL_BODY,
      variableSchema: GUEST_TEMPLATE_VARIABLE_SCHEMA,
      notes: COPY_SOURCE_NOTE
    }
  },
  {
    key: 'arrival_3d_the_cabin',
    channel: 'whatsapp',
    locale: 'en',
    propertyKind: 'cabin',
    version: 1,
    label: 'arrival_3d_the_cabin / whatsapp',
    desired: {
      emailSubject: null,
      emailBodyMarkup: null,
      variableSchema: GUEST_TEMPLATE_VARIABLE_SCHEMA,
      notes: whatsappNotes('arrival_3d_the_cabin_v1', CABIN_WHATSAPP_BODY)
    }
  },
  {
    key: 'arrival_3d_the_valley',
    channel: 'email',
    locale: 'en',
    propertyKind: 'valley',
    version: 1,
    label: 'arrival_3d_the_valley / email',
    desired: {
      emailSubject: VALLEY_EMAIL_SUBJECT,
      emailBodyMarkup: VALLEY_EMAIL_BODY,
      variableSchema: GUEST_TEMPLATE_VARIABLE_SCHEMA,
      notes: COPY_SOURCE_NOTE
    }
  },
  {
    key: 'arrival_3d_the_valley',
    channel: 'whatsapp',
    locale: 'en',
    propertyKind: 'valley',
    version: 1,
    label: 'arrival_3d_the_valley / whatsapp',
    desired: {
      emailSubject: null,
      emailBodyMarkup: null,
      variableSchema: GUEST_TEMPLATE_VARIABLE_SCHEMA,
      notes: whatsappNotes('arrival_3d_the_valley_v1', VALLEY_WHATSAPP_BODY)
    }
  },
  {
    key: 'ops_alert_arriving_8d',
    channel: 'email',
    locale: 'en',
    propertyKind: 'any',
    version: 1,
    label: 'ops_alert_arriving_8d / email',
    desired: {
      emailSubject: OPS_ARRIVING_8D_SUBJECT,
      emailBodyMarkup: OPS_ARRIVING_8D_BODY,
      variableSchema: OPS_VARIABLE_SCHEMA,
      notes: COPY_SOURCE_NOTE
    }
  },
  {
    key: 'ops_alert_check_in_tomorrow',
    channel: 'email',
    locale: 'en',
    propertyKind: 'any',
    version: 1,
    label: 'ops_alert_check_in_tomorrow / email',
    desired: {
      emailSubject: OPS_CHECKIN_TOMORROW_SUBJECT,
      emailBodyMarkup: OPS_CHECKIN_TOMORROW_BODY,
      variableSchema: OPS_VARIABLE_SCHEMA,
      notes: COPY_SOURCE_NOTE
    }
  },
  {
    key: 'ops_alert_checkout_today',
    channel: 'email',
    locale: 'en',
    propertyKind: 'any',
    version: 1,
    label: 'ops_alert_checkout_today / email',
    desired: {
      emailSubject: OPS_CHECKOUT_TODAY_SUBJECT,
      emailBodyMarkup: OPS_CHECKOUT_TODAY_BODY,
      variableSchema: OPS_VARIABLE_SCHEMA,
      notes: COPY_SOURCE_NOTE
    }
  }
]);

module.exports = {
  COPY_SOURCE_NOTE,
  OPS_VARIABLE_SCHEMA,
  CLEANER_VARIABLE_SCHEMA,
  GUEST_TEMPLATE_VARIABLE_SCHEMA,
  CABIN_EMAIL_SUBJECT,
  CABIN_EMAIL_BODY,
  CABIN_WHATSAPP_BODY,
  VALLEY_EMAIL_SUBJECT,
  VALLEY_EMAIL_BODY,
  VALLEY_WHATSAPP_BODY,
  OPS_ARRIVING_8D_SUBJECT,
  OPS_ARRIVING_8D_BODY,
  OPS_CHECKIN_TOMORROW_SUBJECT,
  OPS_CHECKIN_TOMORROW_BODY,
  OPS_CHECKOUT_TODAY_SUBJECT,
  OPS_CHECKOUT_TODAY_BODY,
  GMA_TEMPLATE_COPY_TARGETS,
  whatsappNotes
};
