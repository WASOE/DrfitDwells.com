import {
  CARD_BG_ALT,
  CARD_BG_ASSET_PATH,
  CARD_LAYOUT,
  CARD_TOKENS,
  CARD_TYPOGRAPHY,
  PLACEHOLDER_VOUCHER_CODE,
  forestBackgroundUrl
} from '@shared/giftVoucher/cardSpec';
import { getCardLabels, getOccasionHeadline } from '@shared/giftVoucher/cardCopy';

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

function CardHeadline({ occasion, locale, className = '', style = {} }) {
  const headline = getOccasionHeadline(occasion, locale);
  if (!headline) return null;
  return (
    <p
      className={`text-[11px] font-semibold uppercase tracking-[0.24em] ${className}`}
      style={{ fontFamily: CARD_TYPOGRAPHY.fontSans, ...style }}
    >
      {headline}
    </p>
  );
}

function CardMessage({ message, locale, className = '', style = {}, italic = false }) {
  const labels = getCardLabels(locale);
  const text = message?.trim() || labels.defaultMessage;
  return (
    <p
      className={`font-serif leading-snug ${italic ? 'italic' : ''} ${className}`}
      style={{
        fontFamily: CARD_TYPOGRAPHY.fontSerif,
        fontSize: `${CARD_LAYOUT.messagePx}px`,
        ...style
      }}
    >
      {text}
    </p>
  );
}

function CardNames({ fields, labels, className = '', style = {}, mutedClassName = '' }) {
  const parts = [];
  if (fields.recipientName) {
    parts.push(
      <span key="for">
        <span className={mutedClassName}>{labels.forLabel}</span> {fields.recipientName}
      </span>
    );
  }
  if (fields.buyerName) {
    parts.push(
      <span key="from">
        <span className={mutedClassName}>{labels.fromLabel}</span> {fields.buyerName}
      </span>
    );
  }
  if (!parts.length) return null;
  return (
    <p
      className={`text-sm leading-relaxed ${className}`}
      style={{ fontFamily: CARD_TYPOGRAPHY.fontSans, fontSize: `${CARD_LAYOUT.namesPx}px`, ...style }}
    >
      {parts.map((part, i) => (
        <span key={part.key} className={i > 0 ? 'mt-1 block' : ''}>
          {part}
        </span>
      ))}
    </p>
  );
}

function CardAmount({ fields, labels, locale, className = '', style = {} }) {
  const amount = formatCurrency(fields.amountOriginalCents, fields.currency, locale);
  return (
    <div className={className} style={{ fontFamily: CARD_TYPOGRAPHY.fontSans, ...style }}>
      <p
        className="text-[11px] uppercase tracking-[0.24em]"
        style={{ fontSize: `${CARD_LAYOUT.footerPx}px` }}
      >
        {labels.amountLabel}
      </p>
      <p className="font-semibold" style={{ fontSize: `${CARD_LAYOUT.amountPx}px` }}>
        {amount}
      </p>
    </div>
  );
}

function CardFooter({ fields, labels, locale, className = '', onPlainPaper = false }) {
  const ink = onPlainPaper ? CARD_TOKENS.ink : undefined;
  const muted = onPlainPaper ? CARD_TOKENS.inkMuted : undefined;
  const code = fields.code || PLACEHOLDER_VOUCHER_CODE;
  const expires = formatExpiryDate(fields.expiresAt, locale);

  return (
    <div
      className={`pt-3 text-[11px] leading-relaxed ${className}`}
      style={{
        fontFamily: CARD_TYPOGRAPHY.fontSans,
        fontSize: `${CARD_LAYOUT.footerPx}px`,
        color: ink
      }}
    >
      <p className="uppercase tracking-[0.24em]" style={{ color: muted }}>
        {labels.codeLabel}
      </p>
      <p className="mt-1">
        <span
          className="inline-block font-mono font-bold tracking-wider"
          style={{
            fontSize: `${CARD_LAYOUT.codePx}px`,
            border: onPlainPaper ? `1px solid ${CARD_TOKENS.minimal.rule}` : 'none',
            padding: onPlainPaper ? '6px 10px' : 0
          }}
        >
          {code}
        </span>
      </p>
      <p className="mt-2" style={{ color: muted }}>
        <span className="uppercase tracking-[0.24em]">{labels.expiresLabel}</span> {expires}
      </p>
      <p className="mt-2" style={{ color: muted }}>
        {labels.redeemInstruction}
      </p>
    </div>
  );
}

function ForestCard({ fields, labels, locale }) {
  const t = CARD_TOKENS.forest;
  const bgUrl = forestBackgroundUrl({ mode: 'print' });

  return (
    <div
      className="mx-auto flex w-full max-w-md flex-col overflow-hidden rounded-lg shadow-lg"
      data-gv-card-template="forest"
      style={{ background: CARD_TOKENS.paper, fontFamily: CARD_TYPOGRAPHY.fontSans }}
    >
      <div className="relative min-h-[220px] flex-[0_0_68%] overflow-hidden md:min-h-[280px]">
        <img
          src={bgUrl}
          alt={CARD_BG_ALT}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />
        <div
          className="relative z-10 flex h-full flex-col justify-end p-6"
          style={{
            background: `linear-gradient(to bottom, ${t.overlayTop}, ${t.overlayBottom})`
          }}
        >
          <CardHeadline occasion={fields.occasion} locale={locale} className="mb-3 text-[#f7f5f0]" />
          <CardMessage
            message={fields.message}
            locale={locale}
            className="mb-4 text-[#f7f5f0]"
            style={{ textShadow: '0 1px 3px rgba(0,0,0,0.45)' }}
          />
          <CardNames
            fields={fields}
            labels={labels}
            className="text-[#f7f5f0]"
            mutedClassName="text-white/80"
          />
        </div>
      </div>
      <div className="flex-1 bg-[#fdfcfa] p-6">
        <CardAmount fields={fields} labels={labels} locale={locale} className="mb-2 text-stone-900" />
        <CardFooter fields={fields} labels={labels} locale={locale} onPlainPaper />
      </div>
    </div>
  );
}

function RomanticCard({ fields, labels, locale }) {
  const t = CARD_TOKENS.romantic;
  const border = `${t.frameBorderPx}px solid ${t.warmAccent}`;

  return (
    <div
      className="mx-auto w-full max-w-md"
      data-gv-card-template="romantic"
      style={{ fontFamily: CARD_TYPOGRAPHY.fontSans, background: t.bg }}
    >
      <div style={{ border, padding: t.frameGapPx }}>
        <div style={{ border, padding: '24px', background: t.surface }}>
          <p
            className="mb-4 text-center font-serif text-lg tracking-widest"
            style={{ color: t.warmAccent, fontFamily: CARD_TYPOGRAPHY.fontSerif }}
          >
            {labels.brandWordmark}
          </p>
          <div className="py-6 text-center">
            <CardHeadline
              occasion={fields.occasion}
              locale={locale}
              className="mb-3"
              style={{ color: t.warmAccent }}
            />
            <CardMessage
              message={fields.message}
              locale={locale}
              className="text-stone-900"
              italic
            />
          </div>
          <CardNames
            fields={fields}
            labels={labels}
            className="mb-4 text-center text-stone-900"
            mutedClassName="text-stone-500"
          />
          <CardAmount fields={fields} labels={labels} locale={locale} className="mb-2 text-stone-600" />
          <CardFooter fields={fields} labels={labels} locale={locale} />
        </div>
      </div>
    </div>
  );
}

function MinimalCard({ fields, labels, locale }) {
  const t = CARD_TOKENS.minimal;

  return (
    <div
      className="mx-auto w-full max-w-md border p-6 md:p-8"
      data-gv-card-template="minimal"
      style={{
        fontFamily: CARD_TYPOGRAPHY.fontSans,
        background: t.bg,
        borderColor: t.rule
      }}
    >
      <CardHeadline occasion={fields.occasion} locale={locale} className="mb-3 text-stone-900" />
      <CardMessage message={fields.message} locale={locale} className="mb-4 text-stone-900" />
      <CardNames
        fields={fields}
        labels={labels}
        className="mb-4 text-stone-900"
        mutedClassName="text-stone-500"
      />
      <hr className="my-5 border-stone-300" />
      <CardAmount fields={fields} labels={labels} locale={locale} className="mb-2 text-stone-900" />
      <CardFooter fields={fields} labels={labels} locale={locale} onPlainPaper />
    </div>
  );
}

const TEMPLATE_COMPONENTS = {
  forest: ForestCard,
  romantic: RomanticCard,
  minimal: MinimalCard
};

export default function GiftVoucherCardPreview({ fields }) {
  const locale = fields.locale || 'en';
  const labels = getCardLabels(locale);
  const Template = TEMPLATE_COMPONENTS[fields.templateId] || MinimalCard;

  return (
    <div className="w-full" aria-live="polite" aria-label={labels.brandWordmark}>
      <Template fields={fields} labels={labels} locale={locale} />
    </div>
  );
}

export { CARD_BG_ASSET_PATH };
