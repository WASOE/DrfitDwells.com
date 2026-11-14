'use strict';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KEY_RE = /^[a-zA-Z0-9_-]{8,128}$/;

function validateCorporateGiftLead(body) {
  const raw = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (typeof raw.honeypot === 'string' && raw.honeypot.trim()) {
    return { honeypot: true };
  }
  const errors = [];
  function text(name, max, required = false) {
    const value = raw[name];
    if (value != null && typeof value !== 'string') {
      errors.push(`${name} must be a string`);
      return '';
    }
    const result = (value || '').trim();
    if ((required && !result) || result.length > max) {
      errors.push(`${name} ${required ? 'is required and ' : ''}must be at most ${max} characters`);
    }
    return result;
  }

  const type = text('type', 20, true);
  if (!['nomination', 'hr'].includes(type)) errors.push('type must be nomination or hr');
  const idempotencyKey = text('idempotencyKey', 128, true);
  if (!KEY_RE.test(idempotencyKey)) errors.push('idempotencyKey is invalid');
  const company = text('company', 200, true);
  const companyWebsite = text('companyWebsite', 500);
  if (companyWebsite) {
    try {
      const url = new URL(companyWebsite);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid URL');
    } catch {
      errors.push('companyWebsite must be an http or https URL');
    }
  }
  const hrContact = type === 'nomination' ? text('hrContact', 200) : '';
  const hrEmail = type === 'nomination' ? text('hrEmail', 320).toLowerCase() : '';
  if (hrEmail && !EMAIL_RE.test(hrEmail)) errors.push('hrEmail must be a valid email');
  if (type === 'nomination' && !hrEmail && !companyWebsite) errors.push('An HR email or company website is required');
  const contactName = type === 'hr' ? text('contactName', 120, true) : '';
  const contactEmail = type === 'hr' ? text('contactEmail', 320, true).toLowerCase() : '';
  if (type === 'hr' && !EMAIL_RE.test(contactEmail)) errors.push('contactEmail must be a valid email');
  const employeeCount = type === 'hr' ? text('employeeCount', 80) : '';
  const budget = type === 'hr' ? text('budget', 120) : '';
  const message = type === 'hr' ? text('message', 4000) : '';
  if (raw.consent !== true) errors.push('consent is required');

  const attributionInput = raw.attribution && typeof raw.attribution === 'object' && !Array.isArray(raw.attribution)
    ? raw.attribution : {};
  const attribution = {};
  for (const [key, max] of Object.entries({
    source: 120, medium: 120, campaign: 120, utmSource: 120, utmMedium: 120,
    utmCampaign: 120, referrer: 500, landingPath: 500
  })) {
    if (typeof attributionInput[key] === 'string') attribution[key] = attributionInput[key].slice(0, max);
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      type, idempotencyKey, company, companyWebsite, hrContact, hrEmail, contactName,
      contactEmail, employeeCount, budget, message, consent: true, attribution
    }
  };
}

module.exports = { validateCorporateGiftLead };
