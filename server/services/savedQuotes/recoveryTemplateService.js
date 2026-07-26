'use strict';

const { issuePreferenceAccessToken, buildPreferenceUrl } = require('./preferenceAccessTokenService');
const {
  issueContinuationToken,
  buildContinuationUrl
} = require('./recoveryContinuationService');

const TEMPLATE_REGISTRY = Object.freeze({
  quote_delivery_v1: {
    key: 'quote_delivery_v1',
    version: 'v1',
    purpose: 'quote_delivery',
    subject: 'Your Drift & Dwells quote for {{stayLabel}}',
    text: [
      'Hello,',
      '',
      'Here is the quote you requested for {{stayLabel}}.',
      'Stay: {{checkIn}} → {{checkOut}}',
      'Guests: {{adults}} adults, {{children}} children',
      'Quoted total: {{quotedTotal}} {{currency}}',
      'This quote representation expires on {{quoteExpiresAt}}.',
      '',
      'This email does not reserve availability or lock the price after expiry.',
      'Current price and availability may differ when you continue.',
      '',
      'Continue your booking: {{continuationUrl}}',
      '',
      'Manage email preferences: {{preferenceUrl}}',
      '',
      '— Drift & Dwells'
    ].join('\n'),
    html: `
      <p>Hello,</p>
      <p>Here is the quote you requested for <strong>{{stayLabel}}</strong>.</p>
      <ul>
        <li>Stay: {{checkIn}} → {{checkOut}}</li>
        <li>Guests: {{adults}} adults, {{children}} children</li>
        <li>Quoted total: {{quotedTotal}} {{currency}}</li>
        <li>Quote representation expires: {{quoteExpiresAt}}</li>
      </ul>
      <p>This email does not reserve availability or lock the price after expiry. Current price and availability may differ when you continue.</p>
      <p><a href="{{continuationUrl}}">Continue your booking</a></p>
      <p><a href="{{preferenceUrl}}">Manage email preferences</a></p>
      <p>— Drift & Dwells</p>
    `.trim()
  },
  booking_reminder_v1: {
    key: 'booking_reminder_v1',
    version: 'v1',
    purpose: 'booking_reminder',
    subject: 'A reminder about your Drift & Dwells stay enquiry',
    text: [
      'Hello,',
      '',
      'You asked us to send a limited reminder if you did not finish booking {{stayLabel}}.',
      'Stay: {{checkIn}} → {{checkOut}}',
      'Quoted total at the time: {{quotedTotal}} {{currency}}',
      'Original quote representation expired or expires on {{quoteExpiresAt}}.',
      '',
      'Availability is not reserved. The price shown was the quote at that time and may no longer be available.',
      '',
      'Continue when you are ready: {{continuationUrl}}',
      '',
      'Withdraw reminder or other email preferences: {{preferenceUrl}}',
      '',
      '— Drift & Dwells'
    ].join('\n'),
    html: `
      <p>Hello,</p>
      <p>You asked us to send a limited reminder if you did not finish booking <strong>{{stayLabel}}</strong>.</p>
      <ul>
        <li>Stay: {{checkIn}} → {{checkOut}}</li>
        <li>Quoted total at the time: {{quotedTotal}} {{currency}}</li>
        <li>Quote representation expiry: {{quoteExpiresAt}}</li>
      </ul>
      <p>Availability is not reserved. The price shown was the quote at that time and may no longer be available.</p>
      <p><a href="{{continuationUrl}}">Continue when you are ready</a></p>
      <p><a href="{{preferenceUrl}}">Withdraw reminder or other email preferences</a></p>
      <p>— Drift & Dwells</p>
    `.trim()
  }
});

function formatMoney(cents, currency = 'EUR') {
  const amount = Number(cents || 0) / 100;
  return `${amount.toFixed(2)}`;
}

function renderTemplateString(template, vars) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] != null ? String(vars[key]) : ''
  );
}

function getTemplateDefinition(messagePurpose, templateVersion = 'v1') {
  if (messagePurpose === 'quote_delivery') {
    return TEMPLATE_REGISTRY.quote_delivery_v1;
  }
  if (messagePurpose === 'booking_reminder') {
    return TEMPLATE_REGISTRY.booking_reminder_v1;
  }
  return null;
}

function assertTemplateSafety(definition) {
  const blob = `${definition.subject}\n${definition.text}\n${definition.html}`.toLowerCase();
  const banned = [
    'limited time only',
    'hurry',
    'last chance',
    'guaranteed available',
    'price locked',
    'reserved for you',
    '% off',
    'discount code',
    'promo code'
  ];
  const hits = banned.filter((b) => blob.includes(b));
  return { ok: hits.length === 0, hits };
}

/**
 * Render template for OPS preview. Never calls email provider.
 */
async function renderRecoveryTemplate({
  savedQuote,
  messagePurpose,
  templateVersion = 'v1',
  preferenceUrl = null,
  continuationUrl = null
}) {
  const definition = getTemplateDefinition(messagePurpose, templateVersion);
  if (!definition) {
    return { ok: false, reason: 'unknown_template' };
  }
  const safety = assertTemplateSafety(definition);
  const stayLabel =
    savedQuote.entityType === 'location'
      ? 'The Valley'
      : savedQuote.propertyKind === 'valley'
        ? 'Valley stay'
        : 'Cabin stay';

  const vars = {
    stayLabel,
    checkIn: savedQuote.checkInDateOnly,
    checkOut: savedQuote.checkOutDateOnly,
    adults: savedQuote.adults,
    children: savedQuote.children,
    quotedTotal: formatMoney(savedQuote.quotedTotalCents, savedQuote.currency),
    currency: savedQuote.currency || 'EUR',
    quoteExpiresAt: savedQuote.expiresAt
      ? new Date(savedQuote.expiresAt).toISOString().slice(0, 16).replace('T', ' ')
      : '—',
    continuationUrl: continuationUrl || '[continuation-link]',
    preferenceUrl: preferenceUrl || '[preference-link]'
  };

  const warnings = [];
  if (!savedQuote.emailNormalized && !savedQuote.email) warnings.push('missing_email');
  if (!preferenceUrl) warnings.push('preference_url_placeholder');
  if (!continuationUrl) warnings.push('continuation_url_placeholder');
  if (!safety.ok) warnings.push(`unsafe_copy:${safety.hits.join(',')}`);

  return {
    ok: true,
    templateKey: definition.key,
    templateVersion: definition.version,
    messagePurpose: definition.purpose,
    subject: renderTemplateString(definition.subject, vars),
    text: renderTemplateString(definition.text, vars),
    html: renderTemplateString(definition.html, vars),
    warnings,
    safety
  };
}

/**
 * Build preview with real preference + continuation URLs when email exists.
 * Does not send. May issue tokens for OPS preview only.
 */
async function buildRecoveryPreview({ savedQuote, messagePurpose, templateVersion = 'v1' }) {
  let preferenceUrl = null;
  let continuationUrl = null;
  let preferenceTokenIssued = false;
  let continuationTokenIssued = false;

  if (savedQuote.emailNormalized || savedQuote.email) {
    const pref = await issuePreferenceAccessToken({
      email: savedQuote.emailNormalized || savedQuote.email,
      savedQuoteId: savedQuote._id
    });
    if (!pref.skipped) {
      preferenceUrl = pref.preferenceUrl;
      preferenceTokenIssued = true;
    }
  }

  const cont = await issueContinuationToken({ savedQuoteId: savedQuote._id });
  if (!cont.skipped) {
    continuationUrl = cont.continuationUrl;
    continuationTokenIssued = true;
  }

  const rendered = await renderRecoveryTemplate({
    savedQuote,
    messagePurpose,
    templateVersion,
    preferenceUrl,
    continuationUrl
  });

  return {
    ...rendered,
    preferenceTokenIssued,
    continuationTokenIssued,
    preferenceUrl,
    continuationUrl
  };
}

module.exports = {
  TEMPLATE_REGISTRY,
  getTemplateDefinition,
  renderRecoveryTemplate,
  buildRecoveryPreview,
  assertTemplateSafety,
  buildPreferenceUrl
};
