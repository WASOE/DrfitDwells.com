/**
 * Contract tests: lifecycle send status mapping, persist payload shape, resend vs automatic.
 * Run: npm run test:lifecycle-email (from server/)
 */
'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const emailService = require('../services/emailService');
const EmailEvent = require('../models/EmailEvent');

const originalSendEmail = emailService.sendEmail.bind(emailService);
const originalEmailCreate = EmailEvent.create.bind(EmailEvent);

const bookingLifecycleEmailService = require('../services/bookingLifecycleEmailService');

function minimalBooking(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    checkIn: new Date('2026-07-01'),
    checkOut: new Date('2026-07-03'),
    adults: 2,
    children: 0,
    totalPrice: 100,
    status: 'pending',
    guestInfo: { firstName: 'A', lastName: 'B', email: 'guest@example.com', phone: '+10000000000' },
    ...overrides
  };
}

const minimalEntity = {
  name: 'Contract Cabin',
  location: 'Test Valley',
  arrivalWindowDefault: '15:00–18:00'
};

afterEach(() => {
  emailService.sendEmail = originalSendEmail;
  EmailEvent.create = originalEmailCreate;
});

describe('resolveSendStatus', () => {
  const { resolveSendStatus } = bookingLifecycleEmailService;

  test('maps success + sent', () => {
    assert.deepStrictEqual(resolveSendStatus({ success: true, method: 'sent', messageId: 'm1' }), {
      sendStatus: 'success',
      deliveryMethod: 'sent'
    });
  });

  test('maps success + logged (no SMTP)', () => {
    assert.deepStrictEqual(resolveSendStatus({ success: true, method: 'logged' }), {
      sendStatus: 'success',
      deliveryMethod: 'logged'
    });
  });

  test('maps skipped-duplicate to skipped sendStatus', () => {
    assert.deepStrictEqual(resolveSendStatus({ success: true, method: 'skipped-duplicate' }), {
      sendStatus: 'skipped',
      deliveryMethod: 'skipped-duplicate'
    });
  });

  test('maps failure', () => {
    assert.deepStrictEqual(resolveSendStatus({ success: false, method: 'failed', error: 'x' }), {
      sendStatus: 'failed',
      deliveryMethod: 'failed'
    });
  });

  test('maps missing sendResult', () => {
    assert.deepStrictEqual(resolveSendStatus(null), {
      sendStatus: 'failed',
      deliveryMethod: 'unknown'
    });
  });
});

describe('sendBookingLifecycleEmail', () => {
  test('automatic: guest recipient, idempotency on, persists LifecycleEmail shape', async () => {
    let capturedSend = null;
    let capturedCreate = null;

    emailService.sendEmail = async (opts) => {
      capturedSend = opts;
      return { success: true, method: 'sent', messageId: 'mid-contract-1' };
    };
    EmailEvent.create = async (doc) => {
      capturedCreate = doc;
      return { ...doc, _id: new mongoose.Types.ObjectId(), createdAt: new Date() };
    };

    const booking = minimalBooking();
    const result = await bookingLifecycleEmailService.sendBookingLifecycleEmail({
      booking,
      templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_RECEIVED,
      overrideRecipient: null,
      lifecycleSource: 'automatic',
      actorContext: null,
      entity: minimalEntity
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.recipient, 'guest@example.com');
    assert.strictEqual(result.sendStatus, 'success');
    assert.strictEqual(capturedSend.to, 'guest@example.com');
    assert.strictEqual(capturedSend.trigger, 'booking_received');
    assert.strictEqual(capturedSend.skipIdempotencyWindow, false);
    assert.strictEqual(capturedCreate.type, 'LifecycleEmail');
    assert.strictEqual(capturedCreate.templateKey, 'booking_received');
    assert.strictEqual(capturedCreate.lifecycleSource, 'automatic');
    assert.strictEqual(capturedCreate.sendStatus, 'success');
    assert.strictEqual(capturedCreate.overrideRecipientUsed, false);
    assert.strictEqual(capturedCreate.guestEmailAtSend, 'guest@example.com');
    assert.strictEqual(capturedCreate.tag, 'lifecycle:booking_received');
    assert.strictEqual(capturedCreate.emailTrigger, 'booking_received');
  });

  test('manual_resend: override recipient, idempotency off, actor on persist', async () => {
    let capturedSend = null;
    let capturedCreate = null;

    emailService.sendEmail = async (opts) => {
      capturedSend = opts;
      return { success: true, method: 'sent', messageId: 'mid-contract-2' };
    };
    EmailEvent.create = async (doc) => {
      capturedCreate = doc;
      return { ...doc, _id: new mongoose.Types.ObjectId() };
    };

    const booking = minimalBooking();
    const result = await bookingLifecycleEmailService.sendBookingLifecycleEmail({
      booking,
      templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
      overrideRecipient: 'AltRecipient@Example.COM',
      lifecycleSource: 'manual_resend',
      actorContext: { actorId: 'u1', actorRole: 'admin' },
      entity: minimalEntity
    });

    assert.strictEqual(result.recipient, 'altrecipient@example.com');
    assert.strictEqual(capturedSend.to, 'altrecipient@example.com');
    assert.strictEqual(capturedSend.skipIdempotencyWindow, true);
    assert.strictEqual(capturedCreate.overrideRecipientUsed, true);
    assert.strictEqual(capturedCreate.lifecycleSource, 'manual_resend');
    assert.strictEqual(capturedCreate.actorId, 'u1');
    assert.strictEqual(capturedCreate.actorRole, 'admin');
    assert.strictEqual(capturedCreate.sendStatus, 'success');
  });

  test('manual_resend without override uses guest email', async () => {
    let capturedSend = null;
    emailService.sendEmail = async (opts) => {
      capturedSend = opts;
      return { success: true, method: 'logged' };
    };
    EmailEvent.create = async (doc) => ({ ...doc, _id: new mongoose.Types.ObjectId() });

    const booking = minimalBooking();
    await bookingLifecycleEmailService.sendBookingLifecycleEmail({
      booking,
      templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CANCELLED,
      overrideRecipient: null,
      lifecycleSource: 'manual_resend',
      actorContext: null,
      entity: minimalEntity
    });

    assert.strictEqual(capturedSend.to, 'guest@example.com');
    assert.strictEqual(capturedSend.skipIdempotencyWindow, true);
  });

  test('automatic + skipped-duplicate maps to skipped persist', async () => {
    let capturedCreate = null;
    emailService.sendEmail = async () => ({ success: true, method: 'skipped-duplicate' });
    EmailEvent.create = async (doc) => {
      capturedCreate = doc;
      return { ...doc, _id: new mongoose.Types.ObjectId() };
    };

    const booking = minimalBooking();
    await bookingLifecycleEmailService.sendBookingLifecycleEmail({
      booking,
      templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
      overrideRecipient: null,
      lifecycleSource: 'automatic',
      actorContext: null,
      entity: minimalEntity
    });

    assert.strictEqual(capturedCreate.sendStatus, 'skipped');
    assert.strictEqual(capturedCreate.deliveryMethod, 'skipped-duplicate');
  });

  test('send failure persists failed + errorMessage', async () => {
    let capturedCreate = null;
    emailService.sendEmail = async () => ({ success: false, method: 'failed', error: 'smtp down' });
    EmailEvent.create = async (doc) => {
      capturedCreate = doc;
      return { ...doc, _id: new mongoose.Types.ObjectId() };
    };

    const booking = minimalBooking();
    const result = await bookingLifecycleEmailService.sendBookingLifecycleEmail({
      booking,
      templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_RECEIVED,
      lifecycleSource: 'automatic',
      actorContext: null,
      entity: minimalEntity
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(capturedCreate.sendStatus, 'failed');
    assert.strictEqual(capturedCreate.errorMessage, 'smtp down');
  });

  test('invalid override email throws', async () => {
    emailService.sendEmail = async () => assert.fail('sendEmail should not run');
    const booking = minimalBooking();
    await assert.rejects(
      () =>
        bookingLifecycleEmailService.sendBookingLifecycleEmail({
          booking,
          templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_RECEIVED,
          overrideRecipient: 'not-an-email',
          lifecycleSource: 'manual_resend',
          entity: minimalEntity
        }),
      (err) => err.code === 'INVALID_OVERRIDE_EMAIL'
    );
  });

  test('automatic send rejects manual content override', async () => {
    emailService.sendEmail = async () => assert.fail('sendEmail should not run');
    const booking = minimalBooking();
    await assert.rejects(
      () =>
        bookingLifecycleEmailService.sendBookingLifecycleEmail({
          booking,
          templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_RECEIVED,
          lifecycleSource: 'automatic',
          actorContext: null,
          entity: minimalEntity,
          manualContentOverride: { subject: 'X', html: '<p>x</p>' }
        }),
      (err) => err.code === 'CONTENT_OVERRIDE_NOT_ALLOWED'
    );
  });

  test('manual_resend with edited content sends overridden subject and derived text', async () => {
    let capturedSend = null;
    let capturedCreate = null;

    emailService.sendEmail = async (opts) => {
      capturedSend = opts;
      return { success: true, method: 'sent', messageId: 'mid-edit-1' };
    };
    EmailEvent.create = async (doc) => {
      capturedCreate = doc;
      return { ...doc, _id: new mongoose.Types.ObjectId() };
    };

    const booking = minimalBooking();
    await bookingLifecycleEmailService.sendBookingLifecycleEmail({
      booking,
      templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_RECEIVED,
      overrideRecipient: null,
      lifecycleSource: 'manual_resend',
      actorContext: { actorId: 'admin1', actorRole: 'admin' },
      entity: minimalEntity,
      manualContentOverride: {
        subject: 'Custom subject line',
        html: '<p>Hello</p><script>evil()</script><a href="javascript:alert(1)">x</a>'
      }
    });

    assert.strictEqual(capturedSend.subject, 'Custom subject line');
    assert.ok(!capturedSend.html.toLowerCase().includes('<script'));
    assert.ok(!capturedSend.html.includes('javascript:'));
    assert.strictEqual(capturedSend.text.includes('<'), false);
    assert.ok(capturedSend.text.includes('Hello'));
    assert.strictEqual(capturedCreate.subject, 'Custom subject line');
    assert.ok(capturedCreate.details.contentHash && capturedCreate.details.contentHash.length === 64);
    assert.strictEqual(capturedCreate.details.manualContentEdited, true);
    assert.strictEqual(capturedCreate.details.subjectEdited, true);
    assert.strictEqual(capturedCreate.details.bodyEdited, true);
  });

  test('manual_resend with edited content identical to template logs hash and flags false', async () => {
    let capturedSend = null;
    let capturedCreate = null;

    emailService.sendEmail = async (opts) => {
      capturedSend = opts;
      return { success: true, method: 'logged' };
    };
    EmailEvent.create = async (doc) => {
      capturedCreate = doc;
      return { ...doc, _id: new mongoose.Types.ObjectId() };
    };

    const booking = minimalBooking();
    const base = emailService.generateBookingReceivedEmail(booking, minimalEntity);

    await bookingLifecycleEmailService.sendBookingLifecycleEmail({
      booking,
      templateKey: bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_RECEIVED,
      lifecycleSource: 'manual_resend',
      actorContext: null,
      entity: minimalEntity,
      manualContentOverride: { subject: base.subject, html: base.html }
    });

    assert.strictEqual(capturedSend.subject, base.subject);
    assert.strictEqual(capturedCreate.details.manualContentEdited, false);
    assert.strictEqual(capturedCreate.details.subjectEdited, false);
    assert.strictEqual(capturedCreate.details.bodyEdited, false);
    assert.ok(capturedCreate.details.contentHash);
  });
});

describe('manualLifecycleResendContent', () => {
  const {
    sanitizeManualResendHtml,
    derivePlainTextFromHtml,
    MAX_MANUAL_RESEND_SUBJECT_LENGTH
  } = require('../utils/manualLifecycleResendContent');

  test('sanitize strips script and javascript URLs', () => {
    const html =
      '<div><a href="javascript:void(0)">j</a><script>bad()</script><p>ok</p></div>';
    const s = sanitizeManualResendHtml(html);
    assert.ok(!s.toLowerCase().includes('<script'));
    assert.ok(!s.includes('javascript:'));
    assert.ok(s.includes('ok'));
  });

  test('derivePlainTextFromHtml removes tags', () => {
    const t = derivePlainTextFromHtml('<p>a&nbsp;b</p>');
    assert.strictEqual(t.includes('<'), false);
    assert.ok(t.includes('a'));
    assert.ok(t.includes('b'));
  });

  test('max subject length constant is bounded', () => {
    assert.ok(MAX_MANUAL_RESEND_SUBJECT_LENGTH > 0 && MAX_MANUAL_RESEND_SUBJECT_LENGTH <= 998);
  });
});
