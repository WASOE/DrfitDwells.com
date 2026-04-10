/**
 * Meta Phase 1 hardening — run: npm run test:meta-tracking (from server/)
 */
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');

const {
  sanitizeMetaClientContext,
  sanitizeEventSourceUrl,
  normalizeOriginList
} = require('../utils/sanitizeMetaClientContext');
const {
  isPlaceholderPhone,
  normalizePhoneForMeta,
  hashNameForMeta,
  buildMetaPurchaseUserData
} = require('../services/metaUserData');

const allowedProd = normalizeOriginList(
  'https://driftanddwells.com,https://www.driftanddwells.com'
);

describe('sanitizeEventSourceUrl', () => {
  test('rejects javascript: and non-http(s)', () => {
    assert.strictEqual(
      sanitizeEventSourceUrl('javascript:alert(1)', allowedProd),
      null
    );
    assert.strictEqual(sanitizeEventSourceUrl('data:text/html,hi', allowedProd), null);
    assert.strictEqual(sanitizeEventSourceUrl('ftp://driftanddwells.com/', allowedProd), null);
  });

  test('rejects wrong origin', () => {
    assert.strictEqual(
      sanitizeEventSourceUrl('https://evil.example/cabin/x/confirm', allowedProd),
      null
    );
  });

  test('rejects userinfo URLs', () => {
    assert.strictEqual(
      sanitizeEventSourceUrl('https://user:pass@driftanddwells.com/path', allowedProd),
      null
    );
  });

  test('accepts allowed https origin with path and query', () => {
    const u =
      'https://www.driftanddwells.com/bg/cabin/abc/confirm?checkIn=2026-06-01&checkOut=2026-06-05';
    assert.strictEqual(sanitizeEventSourceUrl(u, allowedProd), u);
  });

  test('accepts http localhost for dev allowlist', () => {
    const local = normalizeOriginList('http://localhost:5173');
    const u = 'http://localhost:5173/cabin/x/confirm';
    assert.strictEqual(sanitizeEventSourceUrl(u, local), u);
  });
});

describe('sanitizeMetaClientContext', () => {
  test('strips eventSourceUrl when origin not allowed but keeps fbp', () => {
    const out = sanitizeMetaClientContext(
      {
        eventSourceUrl: 'https://attacker.test/steal',
        fbp: 'fb.1.123.456',
        sessionId: 'sess-1'
      },
      { allowedOriginsSet: allowedProd }
    );
    assert.strictEqual(out.eventSourceUrl, undefined);
    assert.strictEqual(out.fbp, 'fb.1.123.456');
    assert.strictEqual(out.sessionId, 'sess-1');
  });

  test('passes valid url + fbc', () => {
    const out = sanitizeMetaClientContext(
      {
        eventSourceUrl: 'https://driftanddwells.com/stays/a-frame/confirm',
        fbc: 'fb.1.1700000000.AbCdEf'
      },
      { allowedOriginsSet: allowedProd }
    );
    assert.ok(out.eventSourceUrl.startsWith('https://driftanddwells.com'));
    assert.strictEqual(out.fbc, 'fb.1.1700000000.AbCdEf');
  });
});

describe('metaUserData phone edge cases', () => {
  test('placeholders and empties', () => {
    assert.strictEqual(isPlaceholderPhone(''), true);
    assert.strictEqual(isPlaceholderPhone('   '), true);
    assert.strictEqual(isPlaceholderPhone('Not provided'), true);
    assert.strictEqual(isPlaceholderPhone('  not  provided  '), true);
    assert.strictEqual(isPlaceholderPhone('N/A'), true);
    assert.strictEqual(normalizePhoneForMeta('Not provided'), null);
    assert.strictEqual(normalizePhoneForMeta(undefined), null);
  });

  test('international formats normalize to digits', () => {
    assert.strictEqual(normalizePhoneForMeta('+359 88 123 4567'), '359881234567');
    assert.strictEqual(normalizePhoneForMeta('+1 (555) 123-4567'), '15551234567');
    assert.strictEqual(normalizePhoneForMeta('00359 88 123 4567'), '00359881234567');
  });

  test('too few digits rejected', () => {
    assert.strictEqual(normalizePhoneForMeta('1234567'), null);
  });
});

describe('metaUserData name edge cases', () => {
  test('empty and whitespace', () => {
    assert.strictEqual(hashNameForMeta(''), null);
    assert.strictEqual(hashNameForMeta('   \t  '), null);
  });

  test('mixed case collapses for hashing', () => {
    const a = hashNameForMeta('JoHn');
    const b = hashNameForMeta('john');
    assert.strictEqual(a, b);
  });
});

describe('buildMetaPurchaseUserData (enriched) — flow contracts', () => {
  afterEach(() => {
    delete process.env.META_CAPI_PURCHASE_ENRICHED;
  });

  test('normal booking: ph fn ln present when enriched', () => {
    const ud = buildMetaPurchaseUserData({
      email: 'Guest@Example.com',
      phone: '+359 88 123 4567',
      firstName: 'Jane',
      lastName: 'Doe',
      clientIp: '203.0.113.10',
      userAgent: 'Mozilla/5.0',
      fbp: 'fb.1.111.222',
      fbc: 'fb.1.333.444',
      enriched: true
    });
    assert.strictEqual(ud.em.length, 1);
    assert.strictEqual(ud.ph.length, 1);
    assert.strictEqual(ud.fn.length, 1);
    assert.strictEqual(ud.ln.length, 1);
    assert.strictEqual(ud.fbp, 'fb.1.111.222');
    assert.strictEqual(ud.fbc, 'fb.1.333.444');
    assert.strictEqual(ud.client_ip_address, '203.0.113.10');
  });

  test('craft placeholder phone: no ph key', () => {
    const ud = buildMetaPurchaseUserData({
      email: 'a@b.co',
      phone: 'Not provided',
      firstName: 'X',
      lastName: 'Y',
      enriched: true
    });
    assert.strictEqual(ud.ph, undefined);
    assert.ok(ud.fn && ud.ln);
  });

  test('enriched false: legacy shape', () => {
    const ud = buildMetaPurchaseUserData({
      email: 'a@b.co',
      phone: '+359881234567',
      firstName: 'X',
      lastName: 'Y',
      fbp: 'fb.1.1.1',
      clientIp: '1.1.1.1',
      userAgent: 'UA',
      enriched: false
    });
    assert.strictEqual(ud.ph, undefined);
    assert.strictEqual(ud.fn, undefined);
    assert.strictEqual(ud.fbp, undefined);
    assert.ok(ud.em);
  });
});

describe('purchase-tracking retry contract (unit)', () => {
  test('stored metaClientContext is what CAPI reads — no success-page URL required', () => {
    const bookingLike = {
      guestInfo: {
        email: 'g@example.com',
        phone: '+359 88 999 8877',
        firstName: 'A',
        lastName: 'B'
      },
      metaClientContext: {
        eventSourceUrl: 'https://driftanddwells.com/cabin/x/confirm',
        fbp: 'fb.1.1.1',
        fbc: 'fb.1.2.2'
      }
    };
    const mc = bookingLike.metaClientContext;
    const ud = buildMetaPurchaseUserData({
      email: bookingLike.guestInfo.email,
      phone: bookingLike.guestInfo.phone,
      firstName: bookingLike.guestInfo.firstName,
      lastName: bookingLike.guestInfo.lastName,
      clientIp: '198.51.100.50',
      userAgent: 'RetryBrowser/1.0',
      fbp: mc.fbp,
      fbc: mc.fbc,
      enriched: true
    });
    assert.strictEqual(ud.fbp, 'fb.1.1.1');
    assert.ok(ud.ph);
  });
});

describe('3DS redirect contract (unit)', () => {
  test('after redirect, client sends fresh getMetaClientContextPayload — URL must pass sanitize if origin allowed', () => {
    const staging = normalizeOriginList('https://app.staging.drift.com');
    const url = 'https://app.staging.drift.com/cabin/1/confirm?payment_intent=pi_x';
    assert.strictEqual(sanitizeEventSourceUrl(url, staging), url);
  });
});
