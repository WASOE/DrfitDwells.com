import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { publicLocationQuoteAPI } from '../../../services/publicLocationQuoteApi';
import { getMinSelectableStayDate } from '../../../utils/bookingMinStayDate';
import { formatDateOnlyLocal } from '../../../utils/dateOnly';

const LOCATION_SLUG = 'the-valley';

function formatEuro(amount) {
  if (amount == null || Number.isNaN(amount)) return '—';
  return new Intl.NumberFormat('en-EU', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

const RetreatQuoteSection = ({ onQuoteLoaded }) => {
  const { t } = useTranslation('retreats');
  const minDate = formatDateOnlyLocal(getMinSelectableStayDate());

  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [adults, setAdults] = useState(12);
  const [children, setChildren] = useState(0);
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [enquiryLoading, setEnquiryLoading] = useState(false);
  const [enquiryError, setEnquiryError] = useState('');
  const [enquirySuccess, setEnquirySuccess] = useState(false);

  const fetchQuote = useCallback(async () => {
    setQuoteError('');
    setQuote(null);
    setEnquirySuccess(false);

    if (!checkIn || !checkOut) {
      setQuoteError(t('quote.intro'));
      return;
    }

    setQuoteLoading(true);
    try {
      const res = await publicLocationQuoteAPI.getQuote(LOCATION_SLUG, {
        checkIn,
        checkOut,
        adults: Number(adults) || 0,
        children: Number(children) || 0
      });
      if (!res?.success || !res?.data) {
        throw new Error(res?.message || t('quote.error'));
      }
      setQuote(res.data);
      onQuoteLoaded?.(res.data);
    } catch (err) {
      const msg =
        err?.response?.data?.message || err?.message || t('quote.error');
      setQuoteError(msg);
    } finally {
      setQuoteLoading(false);
    }
  }, [checkIn, checkOut, adults, children, t, onQuoteLoaded]);

  const submitEnquiry = async (e) => {
    e.preventDefault();
    setEnquiryError('');
    setEnquirySuccess(false);

    if (!quote) {
      setEnquiryError(t('enquiry.needQuote'));
      return;
    }

    setEnquiryLoading(true);
    try {
      const res = await publicLocationQuoteAPI.submitEnquiry({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        checkIn: quote.checkIn,
        checkOut: quote.checkOut,
        adults: Number(adults) || 0,
        children: Number(children) || 0,
        message: message.trim() || undefined,
        locationSlug: LOCATION_SLUG,
        quoteSnapshot: quote
      });
      if (!res?.success) {
        throw new Error(res?.message || t('enquiry.error'));
      }
      setEnquirySuccess(true);
    } catch (err) {
      setEnquiryError(err?.response?.data?.message || err?.message || t('enquiry.error'));
    } finally {
      setEnquiryLoading(false);
    }
  };

  return (
    <section className="valley-section" id="retreat-quote">
      <div className="valley-container">
        <h2 className="retreat-h2">{t('quote.title')}</h2>
        <p className="retreat-body mb-6">{quote ? null : t('quote.intro')}</p>
        <p className="retreat-body mb-6 text-sm text-stone-600">{t('quote.minGuestsHint')}</p>

        <div className="retreat-quote-panel">
          <div className="retreat-form-grid mb-6">
            <div>
              <label className="retreat-label" htmlFor="retreat-check-in">
                {t('quote.checkIn')}
              </label>
              <input
                id="retreat-check-in"
                type="date"
                className="retreat-input"
                min={minDate}
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
              />
            </div>
            <div>
              <label className="retreat-label" htmlFor="retreat-check-out">
                {t('quote.checkOut')}
              </label>
              <input
                id="retreat-check-out"
                type="date"
                className="retreat-input"
                min={checkIn || minDate}
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
              />
            </div>
            <div>
              <label className="retreat-label" htmlFor="retreat-adults">
                {t('quote.adults')}
              </label>
              <input
                id="retreat-adults"
                type="number"
                min={1}
                max={99}
                className="retreat-input"
                value={adults}
                onChange={(e) => setAdults(e.target.value)}
              />
            </div>
            <div>
              <label className="retreat-label" htmlFor="retreat-children">
                {t('quote.children')}
              </label>
              <input
                id="retreat-children"
                type="number"
                min={0}
                max={99}
                className="retreat-input"
                value={children}
                onChange={(e) => setChildren(e.target.value)}
              />
            </div>
          </div>

          <button
            type="button"
            className="retreat-btn"
            onClick={fetchQuote}
            disabled={quoteLoading}
          >
            {quoteLoading ? t('quote.loading') : t('quote.submit')}
          </button>

          {quoteError ? <p className="retreat-error mt-4">{quoteError}</p> : null}

          {quote ? (
            <div className="mt-8">
              {quote.available ? (
                <p className="retreat-status-available">{t('quote.available')}</p>
              ) : (
                <p className="retreat-status-unavailable">{t('quote.unavailable')}</p>
              )}

              {quote.available ? (
                <>
                  <p className="retreat-price-total mt-4">
                    {formatEuro(quote.totalPrice)}
                  </p>
                  <p className="text-sm text-stone-600 mt-1">
                    {t('quote.totalLabel')} · {t('quote.nights', { count: quote.nights })}
                  </p>

                  {Array.isArray(quote.includedAccommodations) && quote.includedAccommodations.length > 0 ? (
                    <div className="retreat-breakdown">
                      <p className="text-sm font-semibold uppercase tracking-wide text-stone-600 mb-2">
                        {t('quote.breakdown')}
                      </p>
                      {quote.includedAccommodations.map((row) => (
                        <div key={`${row.kind}-${row.slug}`} className="retreat-breakdown-row">
                          <span>
                            {row.label}
                            {row.unitCount ? ` (${t('quote.units', { count: row.unitCount })})` : ''}
                            {row.guestsUsed
                              ? ` · ${t('quote.guestsUsed', { count: row.guestsUsed })}`
                              : ''}
                          </span>
                          <span>{formatEuro(row.lodgingSubtotal)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="mt-4">
                  {quote.unavailableReason ? (
                    <p className="retreat-body text-sm">{quote.unavailableReason}</p>
                  ) : null}
                  {Array.isArray(quote.conflicts) &&
                    quote.conflicts.map((c) => (
                      <p key={c.publicMessage} className="retreat-conflict">
                        {c.publicMessage}
                      </p>
                    ))}
                </div>
              )}

              <p className="retreat-disclaimer">{quote.priceDisclaimer || t('quote.disclaimer')}</p>
              <p className="retreat-disclaimer">{t('quote.subjectToConfirmation')}</p>
            </div>
          ) : null}
        </div>

        <div className="mt-12 max-w-2xl" id="retreat-enquiry">
          <h2 className="retreat-h2">{t('enquiry.title')}</h2>
          <p className="retreat-body mb-6">{t('enquiry.intro')}</p>

          {enquirySuccess ? (
            <p className="retreat-success">{t('enquiry.success')}</p>
          ) : (
            <form onSubmit={submitEnquiry} className="retreat-form-grid">
              <div>
                <label className="retreat-label" htmlFor="retreat-name">
                  {t('enquiry.name')}
                </label>
                <input
                  id="retreat-name"
                  type="text"
                  required
                  className="retreat-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </div>
              <div>
                <label className="retreat-label" htmlFor="retreat-email">
                  {t('enquiry.email')}
                </label>
                <input
                  id="retreat-email"
                  type="email"
                  required
                  className="retreat-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
              <div>
                <label className="retreat-label" htmlFor="retreat-phone">
                  {t('enquiry.phone')}
                </label>
                <input
                  id="retreat-phone"
                  type="tel"
                  className="retreat-input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                />
              </div>
              <div className="retreat-field-full">
                <label className="retreat-label" htmlFor="retreat-message">
                  {t('enquiry.message')}
                </label>
                <textarea
                  id="retreat-message"
                  rows={4}
                  className="retreat-input"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>
              <div className="retreat-field-full">
                <button
                  type="submit"
                  className="retreat-btn"
                  disabled={enquiryLoading || !quote}
                >
                  {enquiryLoading ? t('enquiry.submitting') : t('enquiry.submit')}
                </button>
                {!quote ? (
                  <p className="retreat-disclaimer mt-2">{t('enquiry.needQuote')}</p>
                ) : null}
                {enquiryError ? <p className="retreat-error">{enquiryError}</p> : null}
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
};

export default RetreatQuoteSection;
