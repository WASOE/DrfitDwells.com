'use strict';

/**
 * Read-only GMA template preview (compose-only).
 * No dispatcher, providers, emailService, jobs, or dispatches.
 */

const mongoose = require('mongoose');
const Booking = require('../../models/Booking');
const Cabin = require('../../models/Cabin');
const CabinType = require('../../models/CabinType');
const MessageAutomationRule = require('../../models/MessageAutomationRule');
const MessageTemplate = require('../../models/MessageTemplate');
const { derivePlainTextFromHtml } = require('../../utils/manualLifecycleResendContent');
const { renderGmaEmailHtml } = require('./gmaEmailHtmlRenderer');
const { resolveVariables } = require('./messageVariableResolver');
const {
  resolvePropertyKindFromCabinDoc,
  resolvePropertyKindFromCabinTypeDoc,
  PropertyKindUnresolvedError
} = require('./propertyKindResolver');

const DEFAULT_LOCALE = 'en';
const WHATSAPP_REFERENCE_BODY_MARKER =
  'WhatsApp reference body (bilingual, for Meta submission — not rendered from DB MessageTemplate fields):';
const WHATSAPP_PREVIEW_NOTE =
  'WhatsApp preview shows the approved reference body stored for review. Final Meta rendering depends on the submitted Meta template.';

const PREVIEW_RULE_KEYS = Object.freeze([
  'arrival_instructions_pre_arrival_cabin',
  'arrival_instructions_pre_arrival_valley',
  'check_in_access_day_before_cabin',
  'check_in_access_day_before_valley',
  'cleaner_checkout_prep_cabin',
  'cleaner_checkout_prep_valley',
  'cleaner_checkout_today_cabin',
  'cleaner_checkout_today_valley'
]);

const PREVIEW_RULE_KEY_SET = new Set(PREVIEW_RULE_KEYS);

class MessageTemplatePreviewError extends Error {
  constructor(message, { status = 400, errorType = 'validation', details = null } = {}) {
    super(message);
    this.name = 'MessageTemplatePreviewError';
    this.status = status;
    this.errorType = errorType;
    this.details = details;
  }
}

function extractWhatsappReferenceBodyFromNotes(notes) {
  if (typeof notes !== 'string' || notes.length === 0) return null;
  const idx = notes.indexOf(WHATSAPP_REFERENCE_BODY_MARKER);
  if (idx === -1) return null;
  const body = notes.slice(idx + WHATSAPP_REFERENCE_BODY_MARKER.length).replace(/^\s+/, '');
  return body.length > 0 ? body : null;
}

/** Mustache-style {{key}} substitution (aligned with automation dispatcher; no dispatcher import). */
function renderTemplateString(template, variables) {
  if (typeof template !== 'string' || template.length === 0) return '';
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_m, key) => {
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      const v = variables[key];
      return v == null ? '' : String(v);
    }
    return '';
  });
}

function ruleScopeMatches(rule, propertyKind) {
  if (!rule?.propertyScope) return false;
  if (rule.propertyScope === 'any') return true;
  return rule.propertyScope === propertyKind;
}

async function resolveStayTarget(booking) {
  if (booking?.cabinId) {
    return Cabin.findById(booking.cabinId).lean();
  }
  if (booking?.cabinTypeId) {
    return CabinType.findById(booking.cabinTypeId).lean();
  }
  return null;
}

function detectStayKind(booking) {
  if (booking?.cabinId) return 'cabin';
  if (booking?.cabinTypeId) return 'cabinType';
  return null;
}

function resolveStayPropertyKind(stayTarget, stayKind) {
  if (!stayTarget) {
    throw new PropertyKindUnresolvedError(
      'Booking has neither cabinId nor cabinTypeId; cannot resolve propertyKind.',
      { reason: 'no_stay_target' }
    );
  }
  if (stayKind === 'cabin') return resolvePropertyKindFromCabinDoc(stayTarget);
  if (stayKind === 'cabinType') return resolvePropertyKindFromCabinTypeDoc(stayTarget);
  throw new PropertyKindUnresolvedError(
    `Unknown stayKind ${JSON.stringify(stayKind)}`,
    { reason: 'invalid_stay_kind' }
  );
}

function collectMissingFromSchema(variableSchema, variables) {
  const required = Array.isArray(variableSchema?.required) ? variableSchema.required : [];
  return required.filter((key) => {
    const v = variables[key];
    return v == null || (typeof v === 'string' && v.trim() === '');
  });
}

async function loadPreviewTemplate({ templateKey, channel, propertyKind }) {
  const template = await MessageTemplate.findOne({
    key: templateKey,
    channel,
    locale: DEFAULT_LOCALE,
    propertyKind,
    status: { $in: ['draft', 'approved'] }
  })
    .sort({ version: -1 })
    .lean();

  if (!template) {
    throw new MessageTemplatePreviewError(
      `No draft or approved template for key=${templateKey}, channel=${channel}, propertyKind=${propertyKind}`,
      { status: 404, errorType: 'not_found' }
    );
  }
  return template;
}

/**
 * @param {{ reservationId: string, ruleKey: string, channel: 'email'|'whatsapp' }} input
 */
async function previewGmaMessageForReservation({ reservationId, ruleKey, channel }) {
  if (!mongoose.isValidObjectId(reservationId)) {
    throw new MessageTemplatePreviewError('Invalid reservation id', { status: 400 });
  }
  if (channel !== 'email' && channel !== 'whatsapp') {
    throw new MessageTemplatePreviewError('channel must be email or whatsapp', {
      status: 400,
      errorType: 'validation'
    });
  }

  const booking = await Booking.findById(reservationId).lean();
  if (!booking || booking.isTest || booking.archivedAt) {
    throw new MessageTemplatePreviewError('Reservation not found', { status: 404, errorType: 'not_found' });
  }

  const rule = await MessageAutomationRule.findOne({ ruleKey }).lean();
  if (!rule) {
    throw new MessageTemplatePreviewError(`Rule not found: ${ruleKey}`, {
      status: 404,
      errorType: 'not_found'
    });
  }
  if (!PREVIEW_RULE_KEY_SET.has(ruleKey)) {
    throw new MessageTemplatePreviewError(`Unknown or unsupported ruleKey: ${ruleKey}`, {
      status: 400,
      errorType: 'validation'
    });
  }

  const templateKey = rule.templateKeyByChannel?.[channel];
  if (!templateKey) {
    throw new MessageTemplatePreviewError(
      `Rule ${ruleKey} has no template key for channel ${channel}`,
      { status: 400, errorType: 'validation' }
    );
  }

  const stayKind = detectStayKind(booking);
  if (!stayKind) {
    throw new MessageTemplatePreviewError(
      'Booking has no cabinId or cabinTypeId',
      { status: 400, errorType: 'validation' }
    );
  }

  const stayTarget = await resolveStayTarget(booking);
  let propertyKind;
  try {
    propertyKind = resolveStayPropertyKind(stayTarget, stayKind);
  } catch (err) {
    if (err instanceof PropertyKindUnresolvedError) {
      throw new MessageTemplatePreviewError(err.message, {
        status: 400,
        errorType: 'property_kind_unresolved',
        details: err.details || null
      });
    }
    throw err;
  }

  if (!ruleScopeMatches(rule, propertyKind)) {
    throw new MessageTemplatePreviewError(
      `Rule ${ruleKey} propertyScope ${rule.propertyScope} does not match stay propertyKind ${propertyKind}`,
      { status: 409, errorType: 'scope_mismatch' }
    );
  }

  const templatePropertyKind = rule.propertyScope === 'any' ? 'any' : propertyKind;
  const template = await loadPreviewTemplate({
    templateKey,
    channel,
    propertyKind: templatePropertyKind
  });

  const varResult = await resolveVariables({
    booking,
    stayTarget,
    audience: rule.audience,
    ruleKey: rule.ruleKey,
    propertyKind
  });
  if (!varResult.ok) {
    throw new MessageTemplatePreviewError('Required template variables are missing', {
      status: 422,
      errorType: 'missing_variables',
      details: { missing: varResult.missing }
    });
  }

  const variables = varResult.variables;
  const schemaMissing = collectMissingFromSchema(template.variableSchema, variables);
  if (schemaMissing.length > 0) {
    throw new MessageTemplatePreviewError('Required template variables are missing', {
      status: 422,
      errorType: 'missing_variables',
      details: { missing: schemaMissing }
    });
  }

  const stayName = stayTarget?.name || null;
  const templateDto = {
    key: template.key,
    channel: template.channel,
    locale: template.locale,
    propertyKind: template.propertyKind,
    version: template.version,
    status: template.status
  };

  let email = null;
  let whatsapp = null;

  if (channel === 'email') {
    const subject = renderTemplateString(template.emailSubject || template.key, variables);
    const fragmentHtml = renderTemplateString(template.emailBodyMarkup || '', variables);
    const html = renderGmaEmailHtml({
      audience: rule.audience || 'guest',
      subject,
      fragmentHtml,
      propertyName: variables.propertyName
    });
    const text = derivePlainTextFromHtml(html);
    email = { subject, html, text, fragmentHtml };
  } else {
    const referenceBody = extractWhatsappReferenceBodyFromNotes(template.notes);
    const body = referenceBody ? renderTemplateString(referenceBody, variables) : null;
    whatsapp = {
      templateName: template.whatsappTemplateName || template.key,
      locale: template.whatsappLocale || template.locale || DEFAULT_LOCALE,
      variables: { ...variables },
      body,
      note: referenceBody
        ? WHATSAPP_PREVIEW_NOTE
        : `${WHATSAPP_PREVIEW_NOTE} No bilingual reference body found in template notes.`
    };
  }

  return {
    bookingId: String(booking._id),
    ruleKey,
    channel,
    propertyKind,
    stayName,
    template: templateDto,
    variables,
    email,
    whatsapp
  };
}

module.exports = {
  PREVIEW_RULE_KEYS,
  PREVIEW_RULE_KEY_SET,
  WHATSAPP_PREVIEW_NOTE,
  WHATSAPP_REFERENCE_BODY_MARKER,
  MessageTemplatePreviewError,
  extractWhatsappReferenceBodyFromNotes,
  renderTemplateString,
  previewGmaMessageForReservation
};
