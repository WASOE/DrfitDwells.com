const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildBuyerReceiptTemplate,
  buildRecipientVoucherTemplate,
  buildRecipientResendTemplate
} = require('../services/emailTemplates/giftVoucherEmailTemplates');

const BASE_VOUCHER = {
  amountOriginalCents: 5000,
  currency: 'EUR',
  expiresAt: new Date('2027-01-15T12:00:00.000Z'),
  code: 'DD-TEST-CODE',
  deliveryMode: 'email'
};

const SCRIPT_PAYLOAD = '<script>alert(1)</script>';
const IMG_PAYLOAD = '"><img src=x onerror=alert(1)>';
const AMPERSAND_PAYLOAD = 'Tom & Jerry <test>';

test('recipient template escapes message in HTML, keeps readable text part', () => {
  const { html, text } = buildRecipientVoucherTemplate({
    voucher: {
      ...BASE_VOUCHER,
      recipientName: 'Anna',
      buyerName: 'Bob',
      message: SCRIPT_PAYLOAD
    },
    recipientEmail: 'recipient@example.com'
  });
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.ok(text.includes(SCRIPT_PAYLOAD));
  assert.doesNotMatch(text, /&lt;script&gt;/);
});

test('recipient template escapes buyerName and recipientName in HTML', () => {
  const { html } = buildRecipientVoucherTemplate({
    voucher: {
      ...BASE_VOUCHER,
      recipientName: IMG_PAYLOAD,
      buyerName: AMPERSAND_PAYLOAD,
      message: 'Hello'
    },
    recipientEmail: 'recipient@example.com'
  });
  assert.match(html, /&quot;&gt;&lt;img/);
  assert.match(html, /Tom &amp; Jerry &lt;test&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
});

test('recipient template escapes recipientEmail fallback in HTML', () => {
  const { html } = buildRecipientVoucherTemplate({
    voucher: {
      ...BASE_VOUCHER,
      recipientName: null,
      buyerName: 'Bob',
      message: 'Hi'
    },
    recipientEmail: 'evil<script>@example.com'
  });
  assert.match(html, /evil&lt;script&gt;@example\.com/);
  assert.doesNotMatch(html, /<script>/);
});

test('buyer receipt escapes recipientName in HTML', () => {
  const { html, text } = buildBuyerReceiptTemplate({
    voucher: {
      ...BASE_VOUCHER,
      recipientName: SCRIPT_PAYLOAD
    }
  });
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.ok(text.includes(SCRIPT_PAYLOAD));
});

test('resend template inherits escaped recipient HTML', () => {
  const { html } = buildRecipientResendTemplate({
    voucher: {
      ...BASE_VOUCHER,
      recipientName: 'Anna',
      buyerName: 'Bob',
      message: SCRIPT_PAYLOAD
    },
    recipientEmail: 'recipient@example.com'
  });
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('normal user content renders unchanged in HTML', () => {
  const { html } = buildRecipientVoucherTemplate({
    voucher: {
      ...BASE_VOUCHER,
      recipientName: 'Anna',
      buyerName: 'Bob',
      message: 'Enjoy your stay'
    },
    recipientEmail: 'recipient@example.com'
  });
  assert.match(html, /<strong>For:<\/strong> Anna/);
  assert.match(html, /<strong>From:<\/strong> Bob/);
  assert.match(html, /<strong>Message:<\/strong> Enjoy your stay/);
});

test('subject strips CR/LF and control chars from recipientName', () => {
  const maliciousName = '\r\nBcc: evil@x.com';
  const { subject } = buildRecipientVoucherTemplate({
    voucher: {
      ...BASE_VOUCHER,
      recipientName: maliciousName,
      buyerName: 'Bob',
      message: 'Hi'
    },
    recipientEmail: 'recipient@example.com'
  });
  assert.doesNotMatch(subject, /[\r\n\x00-\x1F\x7F]/);
  assert.match(subject, /for Bcc: evil@x\.com/);
});

test('whitespace-only recipientName renders Guest fallback in HTML', () => {
  const { html } = buildRecipientVoucherTemplate({
    voucher: {
      ...BASE_VOUCHER,
      recipientName: '   ',
      buyerName: 'Bob',
      message: 'Hi'
    },
    recipientEmail: ''
  });
  assert.match(html, /<strong>For:<\/strong> Guest/);
  assert.doesNotMatch(html, /<strong>For:<\/strong>\s*<\/p>/);
});

test('whitespace-only recipientName renders Recipient fallback in buyer receipt HTML', () => {
  const { html } = buildBuyerReceiptTemplate({
    voucher: {
      ...BASE_VOUCHER,
      recipientName: '   '
    }
  });
  assert.match(html, /<strong>Recipient:<\/strong> Recipient/);
});
