'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCorporateGiftLead } = require('../services/corporateGiftLeads/validation');

const base = { type: 'nomination', idempotencyKey: 'request_123', company: ' Example Ltd ', companyWebsite: 'https://example.com', consent: true };

test('nomination keeps company information but not employee identity', () => {
  const result = validateCorporateGiftLead({
    ...base, employeeName: 'Private Person', employeeEmail: 'private@example.com',
    companyWebsite: 'https://example.com', hrContact: 'People team'
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.company, 'Example Ltd');
  assert.equal(result.value.hrContact, 'People team');
  assert.equal(result.value.employeeName, undefined);
  assert.equal(result.value.employeeEmail, undefined);
});

test('nomination requires a valid HR email or website and normalizes HR email', () => {
  assert.equal(validateCorporateGiftLead({ ...base, companyWebsite: '', hrEmail: '' }).ok, false);
  assert.equal(validateCorporateGiftLead({ ...base, companyWebsite: '', hrEmail: 'not-an-email' }).ok, false);
  const result = validateCorporateGiftLead({ ...base, companyWebsite: '', hrEmail: ' HR@EXAMPLE.COM ' });
  assert.equal(result.ok, true);
  assert.equal(result.value.hrEmail, 'hr@example.com');
});

test('HR requests require and normalize contact details', () => {
  const result = validateCorporateGiftLead({
    ...base, type: 'hr', contactName: 'HR', contactEmail: ' HR@EXAMPLE.COM ',
    employeeCount: '50', budget: 'Flexible', message: 'Hello'
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.contactEmail, 'hr@example.com');
  assert.equal(result.value.message, 'Hello');
  assert.equal(validateCorporateGiftLead({ ...base, type: 'hr' }).ok, false);
});

test('rejects invalid company, consent, keys and URLs', () => {
  for (const patch of [
    { company: '' }, { consent: false }, { idempotencyKey: 'bad' },
    { companyWebsite: 'javascript:alert(1)' }, { companyWebsite: 'https://a:b@example.com' },
    { type: 'other' }, { company: 'x'.repeat(201) }
  ]) {
    assert.equal(validateCorporateGiftLead({ ...base, ...patch }).ok, false);
  }
});

test('honeypot is detected and attribution is allowlisted', () => {
  assert.deepEqual(validateCorporateGiftLead({ ...base, honeypot: 'spam' }), { honeypot: true });
  const result = validateCorporateGiftLead({ ...base, attribution: { utmSource: 'test', email: 'secret' } });
  assert.deepEqual(result.value.attribution, { utmSource: 'test' });
});
