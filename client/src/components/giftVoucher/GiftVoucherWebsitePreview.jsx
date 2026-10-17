import { useTranslation } from 'react-i18next';
import { getBrandLine, getCardLabels, getOccasionHeadline } from '@shared/giftVoucher/cardCopy';

export default function GiftVoucherWebsitePreview({ fields, copy }) {
  const { t } = useTranslation('giftVoucher');
  const labels = getCardLabels(fields.locale);
  const templateClass = fields.templateId === 'minimal' ? 'night' : fields.templateId === 'romantic' ? 'clay' : '';
  const recipientFontSize = Math.max(18, Math.min(42, 42 - Math.max(0, fields.recipientName.length - 14) * 0.28));
  const hasLongCopy = fields.recipientName.length > 28 || fields.message.length > 70;
  const value = new Intl.NumberFormat(fields.locale === 'bg' ? 'bg-BG' : 'en-IE', {
    style: 'currency', currency: fields.currency,
    minimumFractionDigits: fields.amountOriginalCents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(fields.amountOriginalCents / 100);

  return (
    <article className={`voucher-card gv2-card ${fields.templateId} ${templateClass}${hasLongCopy ? ' long-content' : ''}`} lang={fields.locale} aria-label={t('order.previewLabel', { lng: fields.locale })}>
      <div className="card-lines" aria-hidden="true" />
      <header className="card-top">
        <b>DRIFT &amp;<br />DWELLS</b>
        <span className="caps">{getBrandLine(fields.locale)}<br />{t('v2.cardEstablished', { lng: fields.locale })}</span>
      </header>
      <div className="card-main gv2-card-body">
        <small className="card-dear">{copy.cardDear} · {getOccasionHeadline(fields.occasion, fields.locale)}</small>
        <strong className="card-recipient" style={{ '--recipient-font-size': `${recipientFontSize}px` }}>{fields.recipientName}</strong>
        <em className="card-msg">{fields.message}</em>
      </div>
      <footer className="card-base">
        <span className="card-base-left">
          <span>{copy.cardFrom}</span>
          <strong>{fields.buyerName}</strong>
          <span className="card-stays">{t('hero.cabin', { lng: fields.locale })} · {t('hero.valley', { lng: fields.locale })}</span>
        </span>
        <span className="card-value-group">
          <span className="card-dear">{copy.cardCredit}</span>
          <strong className="card-value" aria-label={`${labels.amountLabel}: ${value}`}>{value}</strong>
        </span>
      </footer>
    </article>
  );
}
