/**
 * emailService remediation: provider-attempt callback, dedupe reservation, verify timeout.
 * Run: node --test server/scripts/emailService.remediation.test.cjs
 */
'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const emailService = require('../services/emailService');

const ORIG = {
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_URL: process.env.SMTP_URL,
  EMAIL_DELIVERY_REQUIRED: process.env.EMAIL_DELIVERY_REQUIRED,
  EMAIL_FROM: process.env.EMAIL_FROM
};

function restoreEnv() {
  for (const [k, env] of Object.entries({
    SMTP_HOST: 'SMTP_HOST',
    SMTP_URL: 'SMTP_URL',
    EMAIL_DELIVERY_REQUIRED: 'EMAIL_DELIVERY_REQUIRED',
    EMAIL_FROM: 'EMAIL_FROM'
  })) {
    if (ORIG[k] === undefined) delete process.env[env];
    else process.env[env] = ORIG[k];
  }
}

let savedTransporter;
let savedConfigured;
let savedInitPromise;
let savedLastInitError;

beforeEach(() => {
  restoreEnv();
  emailService.__resetEmailDedupeForTesting();
  emailService.__setVerifyTransportReadyForTesting(null);
  savedTransporter = emailService.transporter;
  savedConfigured = emailService.isConfigured;
  savedInitPromise = emailService.initPromise;
  savedLastInitError = emailService.lastInitError;
  emailService.initPromise = Promise.resolve();
});

afterEach(() => {
  restoreEnv();
  emailService.__resetEmailDedupeForTesting();
  emailService.__setVerifyTransportReadyForTesting(null);
  emailService.transporter = savedTransporter;
  emailService.isConfigured = savedConfigured;
  emailService.initPromise = savedInitPromise;
  emailService.lastInitError = savedLastInitError;
});

describe('onProviderAttemptStarted', () => {
  test('invokes callback once immediately before sendMail only', async () => {
    const order = [];
    emailService.isConfigured = true;
    emailService.transporter = {
      sendMail: async () => {
        order.push('sendMail');
        return { messageId: 'mid-1' };
      }
    };
    const result = await emailService.sendEmail({
      to: 'guest@example.com',
      subject: 's',
      html: '<p>h</p>',
      text: 'h',
      trigger: 'booking_confirmed',
      bookingId: 'bk_cb_1',
      onProviderAttemptStarted: async () => {
        order.push('callback');
      }
    });
    assert.equal(result.method, 'sent');
    assert.deepEqual(order, ['callback', 'sendMail']);
  });

  test('does not invoke callback for logged fallback', async () => {
    let called = false;
    emailService.isConfigured = false;
    emailService.transporter = null;
    delete process.env.EMAIL_DELIVERY_REQUIRED;
    const result = await emailService.sendEmail({
      to: 'guest@example.com',
      subject: 's',
      html: '<p>h</p>',
      text: 'h',
      trigger: 'booking_confirmed',
      bookingId: 'bk_logged_1',
      onProviderAttemptStarted: async () => {
        called = true;
      }
    });
    assert.equal(result.method, 'logged');
    assert.equal(called, false);
  });

  test('callback throw prevents sendMail and propagates', async () => {
    let sendMailCalls = 0;
    emailService.isConfigured = true;
    emailService.transporter = {
      sendMail: async () => {
        sendMailCalls += 1;
        return { messageId: 'should-not' };
      }
    };
    await assert.rejects(
      () =>
        emailService.sendEmail({
          to: 'guest@example.com',
          subject: 's',
          html: '<p>h</p>',
          text: 'h',
          trigger: 'booking_confirmed',
          bookingId: 'bk_cb_fail',
          onProviderAttemptStarted: async () => {
            const err = new Error('boundary write failed');
            err.code = 'PROVIDER_ATTEMPT_CALLBACK_FAILED';
            throw err;
          }
        }),
      (err) => err.code === 'PROVIDER_ATTEMPT_CALLBACK_FAILED'
    );
    assert.equal(sendMailCalls, 0);
  });

  test('sendMail throw after callback propagates for confirmation path', async () => {
    emailService.isConfigured = true;
    emailService.transporter = {
      sendMail: async () => {
        throw new Error('smtp reset');
      }
    };
    await assert.rejects(
      () =>
        emailService.sendEmail({
          to: 'guest@example.com',
          subject: 's',
          html: '<p>h</p>',
          text: 'h',
          trigger: 'booking_confirmed',
          bookingId: 'bk_smtp_throw',
          onProviderAttemptStarted: async () => {}
        }),
      (err) => /smtp reset/i.test(err.message)
    );
  });
});

describe('dedupe reservation lifecycle', () => {
  test('logged releases reservation so retry in window is not skipped', async () => {
    emailService.isConfigured = false;
    emailService.transporter = null;
    delete process.env.EMAIL_DELIVERY_REQUIRED;

    const first = await emailService.sendEmail({
      to: 'guest@example.com',
      subject: 's',
      html: '<p>h</p>',
      text: 'h',
      trigger: 'booking_confirmed',
      bookingId: 'bk_dedupe_logged'
    });
    assert.equal(first.method, 'logged');

    emailService.isConfigured = true;
    emailService.transporter = {
      sendMail: async () => ({ messageId: 'mid-after-logged' })
    };
    const second = await emailService.sendEmail({
      to: 'guest@example.com',
      subject: 's',
      html: '<p>h</p>',
      text: 'h',
      trigger: 'booking_confirmed',
      bookingId: 'bk_dedupe_logged'
    });
    assert.equal(second.method, 'sent');
    assert.equal(second.messageId, 'mid-after-logged');
  });

  test('unavailable releases reservation so retry is not skipped', async () => {
    process.env.EMAIL_DELIVERY_REQUIRED = '1';
    emailService.isConfigured = false;
    emailService.transporter = null;

    const first = await emailService.sendEmail({
      to: 'guest@example.com',
      subject: 's',
      html: '<p>h</p>',
      text: 'h',
      trigger: 'booking_confirmed',
      bookingId: 'bk_dedupe_unavail'
    });
    assert.equal(first.method, 'unavailable');

    delete process.env.EMAIL_DELIVERY_REQUIRED;
    emailService.isConfigured = true;
    emailService.transporter = {
      sendMail: async () => ({ messageId: 'mid-after-unavail' })
    };
    const second = await emailService.sendEmail({
      to: 'guest@example.com',
      subject: 's',
      html: '<p>h</p>',
      text: 'h',
      trigger: 'booking_confirmed',
      bookingId: 'bk_dedupe_unavail'
    });
    assert.equal(second.method, 'sent');
  });

  test('SMTP failure without callback does not mark definitively sent', async () => {
    process.env.EMAIL_DELIVERY_REQUIRED = '1';
    emailService.isConfigured = true;
    emailService.transporter = {
      sendMail: async () => {
        throw new Error('rejected');
      }
    };
    const first = await emailService.sendEmail({
      to: 'guest@example.com',
      subject: 's',
      html: '<p>h</p>',
      text: 'h',
      trigger: 'booking_confirmed',
      bookingId: 'bk_dedupe_fail'
    });
    assert.equal(first.success, false);

    emailService.transporter = {
      sendMail: async () => ({ messageId: 'mid-retry' })
    };
    const second = await emailService.sendEmail({
      to: 'guest@example.com',
      subject: 's',
      html: '<p>h</p>',
      text: 'h',
      trigger: 'booking_confirmed',
      bookingId: 'bk_dedupe_fail'
    });
    assert.equal(second.method, 'sent');
  });

  test('authoritative sent retains definitive marker (skip duplicate)', async () => {
    emailService.isConfigured = true;
    let sendMailCalls = 0;
    emailService.transporter = {
      sendMail: async () => {
        sendMailCalls += 1;
        return { messageId: 'mid-def' };
      }
    };
    const first = await emailService.sendEmail({
      to: 'guest@example.com',
      subject: 's',
      html: '<p>h</p>',
      text: 'h',
      trigger: 'booking_confirmed',
      bookingId: 'bk_dedupe_sent'
    });
    assert.equal(first.method, 'sent');
    const second = await emailService.sendEmail({
      to: 'guest@example.com',
      subject: 's',
      html: '<p>h</p>',
      text: 'h',
      trigger: 'booking_confirmed',
      bookingId: 'bk_dedupe_sent'
    });
    assert.equal(second.method, 'skipped-duplicate');
    assert.equal(sendMailCalls, 1);
  });
});

describe('verifyTransportReady timeout lifecycle', () => {
  test('slow verify times out, clears timer, keeps transporter, later verify can succeed', async () => {
    process.env.SMTP_HOST = 'smtp.example.test';
    process.env.SMTP_PORT = '587';
    emailService.isConfigured = true;
    const transporter = {
      verifyCalls: 0,
      verify() {
        this.verifyCalls += 1;
        return new Promise(() => {
          /* never resolves */
        });
      }
    };
    emailService.transporter = transporter;

    const first = await emailService.verifyTransportReady({ timeoutMs: 40 });
    assert.equal(first.configured, true);
    assert.equal(first.verified, false);
    assert.equal(first.ok, false);
    assert.ok(
      first.errorCode === 'SMTP_VERIFY_TIMEOUT' || /timed out/i.test(first.error || '')
    );
    assert.equal(emailService.transporter, transporter);

    // Subsequent verify with fast success on same transporter
    transporter.verify = async () => true;
    const second = await emailService.verifyTransportReady({ timeoutMs: 200 });
    assert.equal(second.ok, true);
    assert.equal(second.verified, true);
    assert.equal(emailService.transporter, transporter);
  });

  test('late verify rejection after timeout does not become unhandled', async () => {
    process.env.SMTP_HOST = 'smtp.example.test';
    emailService.isConfigured = true;
    let rejectLate;
    emailService.transporter = {
      verify() {
        return new Promise((_, reject) => {
          rejectLate = reject;
        });
      }
    };

    const result = await emailService.verifyTransportReady({ timeoutMs: 30 });
    assert.equal(result.verified, false);

    // Late rejection must be absorbed
    rejectLate(new Error('late verify fail'));
    await new Promise((r) => setTimeout(r, 20));
  });
});
