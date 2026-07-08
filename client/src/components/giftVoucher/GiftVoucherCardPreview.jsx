import {
  CARD_ASSETS,
  CARD_LAYOUT,
  CARD_LOGO,
  CARD_OBJECT,
  CARD_TOKENS,
  cardFontFamily,
  PLACEHOLDER_VOUCHER_CODE
} from '@shared/giftVoucher/cardSpec';
import {
  getBrandLine,
  getBrandLineCircledWord,
  getCardLabels,
  getFormLabels,
  getOccasionHeadline,
  INK_FOOTER
} from '@shared/giftVoucher/cardCopy';
import './giftVoucherCardFonts.css';
import './giftVoucherCardPreview.css';

/** Preview-only: soft shadow + fixed slight rotation so the card reads as paper. */
function cardObjectStyle(templateId) {
  const deg = CARD_OBJECT.rotationDeg[templateId] || 0;
  return {
    boxShadow: CARD_OBJECT.shadow,
    transform: deg ? `rotate(${deg}deg)` : undefined
  };
}

function formatCurrency(cents, currency = 'EUR', locale = 'en') {
  const amount = Number(cents || 0) / 100;
  const intlLocale = locale === 'bg' ? 'bg-BG' : 'en-IE';
  return new Intl.NumberFormat(intlLocale, {
    style: 'currency',
    currency: String(currency || 'EUR').toUpperCase()
  }).format(amount);
}

function formatExpiryDate(value, locale = 'en') {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const intlLocale = locale === 'bg' ? 'bg-BG' : 'en-GB';
  return d.toLocaleDateString(intlLocale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Europe/Sofia'
  });
}

/** Site logo — top right on every template, same width as the former stamp slot. */
function CardLogo({ variant = 'dark' }) {
  const src = variant === 'white' ? CARD_LOGO.white : CARD_LOGO.dark;
  return (
    <img
      src={src}
      alt={CARD_LOGO.alt}
      width={CARD_LOGO.widthPx}
      className="absolute right-4 top-4 h-auto w-40"
      data-gv-card-logo="1"
      loading="lazy"
    />
  );
}

function BrandLine({ locale, voice = 'script', color, circled = false }) {
  const line = getBrandLine(locale);
  const isStatement = voice === 'statement';
  const style = {
    fontFamily: cardFontFamily(isStatement ? 'statement' : 'script'),
    fontSize: `${isStatement ? CARD_LAYOUT.brandStatementPx : CARD_LAYOUT.brandScriptPx}px`,
    lineHeight: isStatement ? 1.08 : 1.3,
    fontWeight: isStatement ? 600 : 400,
    color
  };

  if (circled) {
    const word = getBrandLineCircledWord(locale);
    const idx = line.toLowerCase().indexOf(word.toLowerCase());
    if (idx >= 0) {
      return (
        <p
          className="mb-3"
          style={{ ...style, paddingRight: `min(40%, ${CARD_LOGO.brandLineClearancePx}px)` }}
          data-gv-card-brand-line="1"
        >
          {line.slice(0, idx)}
          <span className="relative inline-block whitespace-nowrap">
            <svg
              viewBox="0 0 120 52"
              preserveAspectRatio="none"
              aria-hidden="true"
              className="pointer-events-none absolute overflow-visible"
              style={{ left: '-10%', top: '-22%', width: '120%', height: '150%' }}
            >
              <path
                d="M12 27 C 14 10, 58 4, 88 9 C 112 13, 116 30, 96 41 C 72 51, 22 49, 12 36 C 6 29, 10 22, 18 18"
                fill="none"
                stroke={color}
                strokeWidth="2.4"
                strokeLinecap="round"
                opacity="0.9"
              />
            </svg>
            <span className="relative">{line.slice(idx, idx + word.length)}</span>
          </span>
          {line.slice(idx + word.length)}
        </p>
      );
    }
  }

  return (
    <p
      className="mb-3"
      style={{ ...style, paddingRight: `min(40%, ${CARD_LOGO.brandLineClearancePx}px)` }}
      data-gv-card-brand-line="1"
    >
      {line}
    </p>
  );
}

function OccasionLine({ occasion, locale, color }) {
  const headline = getOccasionHeadline(occasion, locale);
  if (!headline) return null;
  return (
    <p
      className="mb-2 uppercase"
      style={{
        fontFamily: cardFontFamily('utilityCaps'),
        fontSize: `${CARD_LAYOUT.occasionPx}px`,
        letterSpacing: '0.22em',
        fontWeight: 500,
        color
      }}
    >
      {headline}
    </p>
  );
}

function CardMessage({ message, locale, color, lineHeight = 1.45 }) {
  const labels = getCardLabels(locale);
  const text = message?.trim() || labels.defaultMessage;
  return (
    <p
      className="mb-2 whitespace-pre-line"
      style={{
        fontFamily: cardFontFamily('message'),
        fontSize: `${CARD_LAYOUT.messagePx}px`,
        lineHeight,
        fontWeight: 500,
        color
      }}
      data-gv-card-message="1"
    >
      {text}
    </p>
  );
}

function Signature({ buyerName, color }) {
  if (!buyerName) return null;
  return (
    <p
      style={{
        fontFamily: cardFontFamily('message'),
        fontSize: `${CARD_LAYOUT.namesPx}px`,
        color,
        marginBottom: `${CARD_LAYOUT.signatureGapPx}px`
      }}
    >
      — {buyerName}
    </p>
  );
}

/** Letter-only pressed-flower accent in the signature → form-block zone. */
function LetterFlower() {
  return (
    <img
      src={CARD_ASSETS.pressedFlower}
      alt=""
      aria-hidden="true"
      className="ml-auto block h-auto"
      style={{ width: CARD_LAYOUT.letterFlowerWidthPx, marginBottom: `${CARD_LAYOUT.signatureGapPx}px` }}
      data-gv-card-flower="1"
      loading="lazy"
    />
  );
}

/**
 * TO / VALID UNTIL / CODE / VALUE. No outer frame — the dotted underlines are
 * the hand-drawn treatment (a solid rounded frame read like a web form group).
 * TO + VALUE are emphasized: the two things a recipient looks for.
 */
function FormBlock({ fields, locale, color, mutedColor }) {
  const labels = getFormLabels(locale);
  const rows = [
    { key: 'to', label: labels.to, value: fields.recipientName || '', emphasized: true },
    { key: 'validUntil', label: labels.validUntil, value: formatExpiryDate(fields.expiresAt, locale) },
    { key: 'code', label: labels.code, value: fields.code || PLACEHOLDER_VOUCHER_CODE },
    {
      key: 'value',
      label: labels.value,
      value: formatCurrency(fields.amountOriginalCents, fields.currency, locale),
      emphasized: true
    }
  ];

  return (
    <table className="w-full border-collapse" data-gv-card-form-block="1">
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td
              className="whitespace-nowrap pr-4 align-bottom uppercase"
              style={{
                fontFamily: cardFontFamily('utilityCaps'),
                fontSize: `${CARD_LAYOUT.formLabelPx}px`,
                letterSpacing: '0.18em',
                fontWeight: 500,
                color: mutedColor,
                padding: '7px 14px 7px 0'
              }}
            >
              {row.label}
            </td>
            <td
              className="w-full align-bottom uppercase"
              style={{
                fontFamily: cardFontFamily('message'),
                fontSize: `${row.emphasized ? CARD_LAYOUT.formValueEmphasisPx : CARD_LAYOUT.formValuePx}px`,
                lineHeight: 1.3,
                fontWeight: 700,
                letterSpacing: '0.04em',
                color,
                borderBottom: `2px dotted ${mutedColor}`,
                padding: '7px 0'
              }}
            >
              {row.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RedeemLine({ locale, color }) {
  const labels = getCardLabels(locale);
  return (
    <p
      className="mt-3"
      style={{
        fontFamily: cardFontFamily('smallUtility'),
        fontSize: `${CARD_LAYOUT.footerPx}px`,
        lineHeight: 1.5,
        color
      }}
    >
      {labels.redeemInstruction}
    </p>
  );
}

function PostcardCard({ fields, locale }) {
  const t = CARD_TOKENS.forest;
  return (
    <div
      className="relative w-full overflow-hidden rounded-md p-7 md:p-9"
      data-gv-card-template="forest"
      style={{
        backgroundColor: t.fallbackBg,
        backgroundImage: `url('${CARD_ASSETS.paperTexture}')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        ...cardObjectStyle('forest')
      }}
    >
      <CardLogo variant="dark" />
      <BrandLine locale={locale} voice="script" color={t.ink} />
      <OccasionLine occasion={fields.occasion} locale={locale} color={t.muted} />
      <CardMessage message={fields.message} locale={locale} color={t.ink} />
      <Signature buyerName={fields.buyerName} color={t.ink} />
      <FormBlock fields={fields} locale={locale} color={t.ink} mutedColor={t.muted} />
      <RedeemLine locale={locale} color={t.muted} />
    </div>
  );
}

function LetterCard({ fields, locale }) {
  const t = CARD_TOKENS.romantic;
  return (
    <div
      className="relative w-full overflow-hidden rounded-md p-7 md:p-9"
      data-gv-card-template="romantic"
      style={{
        backgroundColor: t.fallbackBg,
        backgroundImage: `url('${CARD_ASSETS.crumpledTexture}')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        ...cardObjectStyle('romantic')
      }}
    >
      <CardLogo variant="dark" />
      <BrandLine locale={locale} voice="script" color={t.ink} circled />
      <OccasionLine occasion={fields.occasion} locale={locale} color={t.warmAccent} />
      <CardMessage
        message={fields.message}
        locale={locale}
        color={t.ink}
        lineHeight={CARD_LAYOUT.letterLineHeight}
      />
      <Signature buyerName={fields.buyerName} color={t.ink} />
      <LetterFlower />
      <FormBlock fields={fields} locale={locale} color={t.ink} mutedColor={t.muted} />
      <RedeemLine locale={locale} color={t.muted} />
    </div>
  );
}

function InkCard({ fields, locale }) {
  const t = CARD_TOKENS.minimal;
  return (
    <div
      className="relative w-full overflow-hidden rounded-md p-8 md:p-10"
      data-gv-card-template="minimal"
      style={{ backgroundColor: t.bg, ...cardObjectStyle('minimal') }}
    >
      <CardLogo variant="white" />
      <BrandLine locale={locale} voice="statement" color={t.text} />
      <OccasionLine occasion={fields.occasion} locale={locale} color={t.muted} />
      <CardMessage message={fields.message} locale={locale} color={t.text} />
      <Signature buyerName={fields.buyerName} color={t.text} />
      <FormBlock fields={fields} locale={locale} color={t.text} mutedColor={t.muted} />
      <RedeemLine locale={locale} color={t.muted} />
      <p
        className="mt-4 uppercase"
        style={{
          fontFamily: cardFontFamily('utilityCaps'),
          fontSize: '11px',
          letterSpacing: '0.3em',
          fontWeight: 500,
          color: t.muted
        }}
      >
        {INK_FOOTER}
      </p>
    </div>
  );
}

const TEMPLATE_COMPONENTS = {
  forest: PostcardCard,
  romantic: LetterCard,
  minimal: InkCard
};

export default function GiftVoucherCardPreview({ fields }) {
  const locale = fields.locale || 'en';
  const labels = getCardLabels(locale);
  const Template = TEMPLATE_COMPONENTS[fields.templateId] || InkCard;

  return (
    <div className="gv-card-object w-full" aria-live="polite" aria-label={labels.brandWordmark}>
      <Template fields={fields} locale={locale} />
    </div>
  );
}
