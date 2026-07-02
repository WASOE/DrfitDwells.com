const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {
  renderGiftVoucherCard,
  HEADLINE_ATTR
} = require('../services/giftVouchers/giftVoucherCardRenderer');
const {
  CARD_BG_ASSET_PATH,
  PLACEHOLDER_VOUCHER_CODE
} = require('../../shared/giftVoucher/cardSpec');

const BASE_VOUCHER = {
  amountOriginalCents: 15000,
  currency: 'EUR',
  expiresAt: new Date('2027-06-01T12:00:00.000Z'),
  code: 'DD-ABCD-1234',
  recipientName: 'Maria',
  buyerName: 'Ivan',
  message: 'Time offline together.',
  cardLocale: 'en'
};

const SCRIPT_PAYLOAD = '<script>alert(1)</script>';
const SITE_ORIGIN = 'https://driftdwells.com';

function render(voucher, mode = 'email', extra = {}) {
  return renderGiftVoucherCard({
    voucher: { ...BASE_VOUCHER, ...voucher },
    mode,
    siteOrigin: SITE_ORIGIN,
    ...extra
  }).html;
}

test('renders all three templates in EN and BG', () => {
  for (const templateId of ['forest', 'romantic', 'minimal']) {
    for (const locale of ['en', 'bg']) {
      const html = render({ cardTemplateId: templateId, cardLocale: locale });
      assert.ok(html.length > 200, `${templateId}/${locale} should produce HTML`);
      if (templateId === 'forest') {
        assert.match(html, /gift-voucher-card-bg\.jpg/);
      }
    }
  }
});

test('legacy null template id resolves to minimal', () => {
  const html = render({ cardTemplateId: null, cardOccasion: null });
  assert.doesNotMatch(html, new RegExp(HEADLINE_ATTR));
  assert.match(html, /data-gv-card-message="1"/);
});

test('null occasion produces no headline element', () => {
  const html = render({ cardTemplateId: 'romantic', cardOccasion: null });
  assert.doesNotMatch(html, new RegExp(HEADLINE_ATTR));
  assert.doesNotMatch(html, /A gift for you/);
  assert.doesNotMatch(html, /Подарък за теб/);
});

test('custom occasion renders generic headline EN and BG', () => {
  const en = render({ cardTemplateId: 'minimal', cardOccasion: 'custom', cardLocale: 'en' });
  assert.match(en, /data-gv-card-headline="1"/);
  assert.match(en, /A gift for you/);

  const bg = render({ cardTemplateId: 'minimal', cardOccasion: 'custom', cardLocale: 'bg' });
  assert.match(bg, /data-gv-card-headline="1"/);
  assert.match(bg, /Подарък за теб/);
});

test('named occasion renders occasion headline not generic', () => {
  const html = render({ cardTemplateId: 'romantic', cardOccasion: 'birthday', cardLocale: 'en' });
  assert.match(html, /Happy birthday/);
  assert.doesNotMatch(html, /A gift for you/);
});

test('user fields are HTML-escaped', () => {
  const html = render({
    cardTemplateId: 'minimal',
    cardOccasion: null,
    recipientName: '"><img src=x onerror=alert(1)>',
    buyerName: '<b>Bob</b>',
    message: SCRIPT_PAYLOAD
  });
  assert.match(html, /&quot;&gt;&lt;img/);
  assert.match(html, /&lt;b&gt;Bob&lt;\/b&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('forest email uses absolute URL to card derivative not page hero', () => {
  const html = render({ cardTemplateId: 'forest' }, 'email');
  const expected = `${SITE_ORIGIN}${CARD_BG_ASSET_PATH}`;
  assert.match(html, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(html, /gift-voucher-hero\.jpg/);
  assert.match(html, /background="/);
  assert.match(html, /bgcolor="/);
});

test('forest print uses img base layer not CSS background-image on card root', () => {
  const html = render({ cardTemplateId: 'forest' }, 'print');
  assert.match(html, /<img[^>]+gift-voucher-card-bg\.jpg/);
  assert.match(html, /position:absolute/);
  assert.doesNotMatch(html, /background-image:url/);
  assert.doesNotMatch(html, /opacity:\s*0\.35/);
  assert.match(html, /data-gv-card-footer="1"/);
  assert.match(html, /DD-ABCD-1234/);
});

test('message font size exceeds amount font size in output', () => {
  const html = render({ cardTemplateId: 'minimal', cardOccasion: 'thank_you' });
  const messageMatch = html.match(/data-gv-card-message="1"[^>]*font-size:(\d+)px/);
  const amountMatch = html.match(/data-gv-card-amount="1"[^>]*font-size:(\d+)px/);
  assert.ok(messageMatch, 'message element with font-size');
  assert.ok(amountMatch, 'amount element with font-size');
  assert.ok(
    Number(messageMatch[1]) > Number(amountMatch[1]),
    `message ${messageMatch[1]}px should exceed amount ${amountMatch[1]}px`
  );
});

test('null code renders preview placeholder', () => {
  const html = render({ cardTemplateId: 'minimal', code: null });
  assert.match(html, new RegExp(PLACEHOLDER_VOUCHER_CODE));
  assert.doesNotMatch(html, /N\/A/);
});

test('card derivative asset exists and is under 250KB', () => {
  const assetPath = path.join(
    __dirname,
    '../../client/public/media/gift-vouchers/gift-voucher-card-bg.jpg'
  );
  assert.ok(fs.existsSync(assetPath), 'gift-voucher-card-bg.jpg must exist');
  const { size } = fs.statSync(assetPath);
  assert.ok(size < 250 * 1024, `card bg should be under 250KB, got ${size} bytes`);
});

test('giftVoucherTextSafe is shared by email templates', () => {
  const { userHtml, subjectSafe } = require('../utils/giftVoucherTextSafe');
  assert.equal(userHtml('<test>'), '&lt;test&gt;');
  assert.equal(subjectSafe('\r\nevil'), 'evil');
});
