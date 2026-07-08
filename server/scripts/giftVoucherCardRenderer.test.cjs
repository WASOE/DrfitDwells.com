const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {
  renderGiftVoucherCard,
  isCardAssetAvailable,
  HEADLINE_ATTR,
  BRAND_LINE_ATTR,
  FORM_BLOCK_ATTR
} = require('../services/giftVouchers/giftVoucherCardRenderer');
const {
  CARD_BG_ASSET_PATH,
  PLACEHOLDER_VOUCHER_CODE
} = require('../../shared/giftVoucher/cardSpec');
const { BRAND_LINE, FORM_LABELS } = require('../../shared/giftVoucher/cardCopy');

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
const TEMPLATES = ['forest', 'romantic', 'minimal'];

function render(voucher, mode = 'email', extra = {}) {
  return renderGiftVoucherCard({
    voucher: { ...BASE_VOUCHER, ...voucher },
    mode,
    siteOrigin: SITE_ORIGIN,
    ...extra
  }).html;
}

test('renders all three templates in EN and BG with brand line and form block', () => {
  for (const templateId of TEMPLATES) {
    for (const locale of ['en', 'bg']) {
      for (const mode of ['email', 'print']) {
        const html = render({ cardTemplateId: templateId, cardLocale: locale }, mode);
        assert.ok(html.length > 200, `${templateId}/${locale}/${mode} should produce HTML`);
        assert.match(html, new RegExp(BRAND_LINE_ATTR), `${templateId}/${locale}/${mode} brand line`);
        // Circled-word treatment wraps part of the line in spans/SVG; compare tag-stripped text.
        const textOnly = html.replace(/<[^>]+>/g, '');
        assert.ok(textOnly.includes(BRAND_LINE[locale]), `${templateId}/${locale}/${mode} brand line copy`);
        assert.match(html, new RegExp(FORM_BLOCK_ATTR), `${templateId}/${locale}/${mode} form block`);
        for (const label of Object.values(FORM_LABELS[locale])) {
          assert.ok(html.includes(label), `${templateId}/${locale}/${mode} form label ${label}`);
        }
        assert.match(html, /border-bottom:2px dotted/, `${templateId}/${locale}/${mode} dotted underlines`);
      }
    }
  }
});

test('legacy null template id resolves to minimal (Ink)', () => {
  const html = render({ cardTemplateId: null, cardOccasion: null });
  assert.match(html, /data-gv-card-template="minimal"/);
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

test('all templates include site logo at consistent width', () => {
  for (const templateId of TEMPLATES) {
    for (const mode of ['email', 'print']) {
      const html = render({ cardTemplateId: templateId }, mode);
      assert.match(html, /data-gv-card-logo="1"/, `${templateId}/${mode} logo`);
      assert.match(html, /logo-header-(dark|white)/, `${templateId}/${mode} logo asset`);
      assert.match(html, /width:160px|width="160"/, `${templateId}/${mode} logo width`);
    }
  }
});

test('templates do not render stamp or mountain line-art; flower is Letter print only', () => {
  for (const templateId of TEMPLATES) {
    for (const mode of ['email', 'print']) {
      const html = render({ cardTemplateId: templateId }, mode);
      assert.doesNotMatch(html, /gift-voucher-stamp-frame/);
      assert.doesNotMatch(html, /gift-voucher-mountain-lineart/);
      assert.doesNotMatch(html, /data-gv-card-art=/);
      if (templateId === 'romantic' && mode === 'print') {
        assert.match(html, /gift-voucher-pressed-flower/, 'Letter print carries the pressed flower');
        assert.match(html, /data-gv-card-flower="1"/);
      } else {
        assert.doesNotMatch(
          html,
          /gift-voucher-pressed-flower/,
          `${templateId}/${mode} must not carry the pressed flower`
        );
      }
    }
  }
});

test('missing texture assets render flat fallback', () => {
  for (const templateId of ['forest', 'romantic']) {
    for (const mode of ['email', 'print']) {
      const html = render({ cardTemplateId: templateId }, mode);
      if (!isCardAssetAvailable('paperTexture') && templateId === 'forest') {
        assert.match(html, /background-color:#F7F4EE/, `${templateId}/${mode} flat paper fallback`);
      }
    }
  }
});

test('email mode degrades textures to solid colors and skips custom fonts', () => {
  for (const templateId of ['forest', 'romantic']) {
    const html = render({ cardTemplateId: templateId }, 'email');
    assert.doesNotMatch(html, /background-image/, `${templateId} email must not use texture bg`);
    assert.doesNotMatch(html, /Marck Script/, `${templateId} email falls back for script role`);
    assert.doesNotMatch(html, /Caveat/, `${templateId} email falls back for message role`);
    assert.match(html, /Playfair Display/, `${templateId} email serif fallback present`);
    assert.match(html, /font-style:italic/, `${templateId} email script fallback is italic`);
  }
});

test('print mode uses the webfont voices', () => {
  const postcard = render({ cardTemplateId: 'forest' }, 'print');
  assert.match(postcard, /Marck Script/);
  assert.match(postcard, /Caveat/);
  assert.match(postcard, /Oswald/);
});

test('ink template is solid black with logo only (no decorative art)', () => {
  for (const mode of ['email', 'print']) {
    const html = render({ cardTemplateId: 'minimal' }, mode);
    assert.match(html, /background-color:#000000/);
    assert.doesNotMatch(html, /gift-voucher-stamp-frame/);
    assert.doesNotMatch(html, /gift-voucher-mountain-lineart/);
    assert.match(html, /logo-header-white/);
    assert.match(html, /driftdwells\.com/);
    assert.match(html, /@driftdwells/);
  }
});

test('ink brand line uses statement voice (Playfair) in print', () => {
  const html = render({ cardTemplateId: 'minimal' }, 'print');
  const brandMatch = html.match(new RegExp(`${BRAND_LINE_ATTR}="1"[^>]*font-family:'Playfair Display'`));
  assert.ok(brandMatch, 'Ink brand line set in Playfair');
});

test('letter circled word SVG present in print, absent in email', () => {
  const printHtml = render({ cardTemplateId: 'romantic' }, 'print');
  assert.match(printHtml, /<svg/);
  const emailHtml = render({ cardTemplateId: 'romantic' }, 'email');
  assert.doesNotMatch(emailHtml, /<svg/);
});

test('form block has no outer frame in any template or mode — dotted underlines only', () => {
  for (const templateId of TEMPLATES) {
    for (const mode of ['email', 'print']) {
      const html = render({ cardTemplateId: templateId }, mode);
      assert.doesNotMatch(html, /data-gv-card-form-frame/, `${templateId}/${mode} frameless`);
      assert.match(html, /border-bottom:2px dotted/, `${templateId}/${mode} dotted underlines`);
    }
  }
});

test('TO and VALUE rows are emphasized above the other form rows', () => {
  const { CARD_LAYOUT } = require('../../shared/giftVoucher/cardSpec');
  const html = render({ cardTemplateId: 'forest' }, 'print');
  const amountMatch = html.match(/data-gv-card-amount="1"[^>]*font-size:(\d+)px/);
  assert.ok(amountMatch, 'amount row with font-size');
  assert.equal(Number(amountMatch[1]), CARD_LAYOUT.formValueEmphasisPx);
  assert.ok(
    CARD_LAYOUT.formValueEmphasisPx > CARD_LAYOUT.formValuePx,
    'emphasis size exceeds base form value size'
  );
  assert.ok(
    CARD_LAYOUT.messagePx > CARD_LAYOUT.formValueEmphasisPx,
    'message stays the largest text element'
  );
});

test('message font size exceeds form value font size in output', () => {
  const html = render({ cardTemplateId: 'minimal', cardOccasion: 'thank_you' });
  const messageMatch = html.match(/data-gv-card-message="1"[^>]*font-size:(\d+)px/);
  const valueMatch = html.match(/data-gv-card-amount="1"[^>]*font-size:(\d+)px/);
  assert.ok(messageMatch, 'message element with font-size');
  assert.ok(valueMatch, 'form value element with font-size');
  assert.ok(
    Number(messageMatch[1]) > Number(valueMatch[1]),
    `message ${messageMatch[1]}px should exceed form value ${valueMatch[1]}px`
  );
});

test('form block carries amount, code and expiry', () => {
  const html = render({ cardTemplateId: 'forest' });
  assert.match(html, /data-gv-card-amount="1"/);
  assert.match(html, /DD-ABCD-1234/);
  assert.match(html, /2027/);
});

test('null code renders preview placeholder', () => {
  const html = render({ cardTemplateId: 'minimal', code: null });
  assert.match(html, new RegExp(PLACEHOLDER_VOUCHER_CODE));
  assert.doesNotMatch(html, /N\/A/);
});

test('legacy card bg derivative stays on disk — already-sent emails hot-link it', () => {
  const assetPath = path.join(__dirname, '../../client/public', CARD_BG_ASSET_PATH);
  assert.ok(fs.existsSync(assetPath), 'gift-voucher-card-bg.jpg must exist');
  const { size } = fs.statSync(assetPath);
  assert.ok(size < 250 * 1024, `card bg should be under 250KB, got ${size} bytes`);
});

test('card webfont files exist and are under 150KB each', () => {
  const { CARD_WEBFONTS, CARD_WEBFONT_BASE } = require('../../shared/giftVoucher/cardSpec');
  for (const font of CARD_WEBFONTS) {
    const fontPath = path.join(__dirname, '../../client/public', CARD_WEBFONT_BASE, font.file);
    assert.ok(fs.existsSync(fontPath), `${font.file} must exist`);
    const { size } = fs.statSync(fontPath);
    assert.ok(size < 150 * 1024, `${font.file} should be under 150KB, got ${size}`);
  }
});

test('giftVoucherTextSafe is shared by email templates', () => {
  const { userHtml, subjectSafe } = require('../utils/giftVoucherTextSafe');
  assert.equal(userHtml('<test>'), '&lt;test&gt;');
  assert.equal(subjectSafe('\r\nevil'), 'evil');
});
