import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link, useLocation } from 'react-router-dom';
import { bookingAPI } from '../services/api';
import Seo from '../components/Seo';
import { localizePath } from '../utils/localizedRoutes';
import { useSiteLanguage } from '../hooks/useSiteLanguage';
import { formatStayDayWithWeekday } from '../utils/localeDates';
import { getGuideCtaLabel } from './guides/guideUtils';
import { parseDateOnlyLocal } from '../utils/dateOnly';
import { formatBookingStayForCsv } from '../utils/csvExport';
import { formatPaymentSubline, isValleyLocation } from '../utils/bookingConfirmationDisplay';
import { readConsentChoice } from '../tracking/consent';
import { fireBrowserPurchase } from '../tracking/purchase';
import { CONTACT_EMAIL, CONTACT_PHONE, INSTAGRAM_URL, FACEBOOK_URL } from '../data/gmbLocations';

const BookingSuccess = () => {
  const { id } = useParams();
  const location = useLocation();
  const { t } = useTranslation('booking');
  const { language: routeLanguage } = useSiteLanguage();
  const [confirmation, setConfirmation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showPackingModal, setShowPackingModal] = useState(false);
  const purchaseTrackedRef = useRef(false);

  const guestEmail = (
    location.state?.guestEmail ||
    (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(`dd_booking_guest_${id}`) : '') ||
    ''
  )
    .trim()
    .toLowerCase();

  useEffect(() => {
    const fetchConfirmation = async () => {
      try {
        setLoading(true);
        const response = await bookingAPI.getConfirmation(id, guestEmail || undefined);

        if (response.data.success) {
          setConfirmation(response.data.data.confirmation);
        } else {
          setError(t('success.errorNotFound'));
        }
      } catch (err) {
        console.error('Fetch booking confirmation error:', err);
        setError(t('success.errorLoadDetails'));
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchConfirmation();
    } else {
      setError(t('success.errorInvalidId'));
      setLoading(false);
    }
  }, [id, guestEmail, t]);

  useEffect(() => {
    if (!confirmation || !id || purchaseTrackedRef.current) return;
    if (!guestEmail) return;
    if (confirmation.status !== 'confirmed') return;

    purchaseTrackedRef.current = true;
    bookingAPI
      .postPurchaseTracking(id, guestEmail)
      .then((res) => {
        const data = res.data?.data;
        if (!data) return;
        const consent = readConsentChoice();
        if (consent && (consent.analytics || consent.ads)) {
          fireBrowserPurchase(data, consent);
        }
      })
      .catch((err) => {
        const code = err?.response?.data?.code;
        if (code === 'NOT_ELIGIBLE') return;
        purchaseTrackedRef.current = false;
      });
  }, [confirmation, id, guestEmail]);

  const getTripTypeDisplay = useCallback(
    (tripType) => {
      const tripTypeKey = {
        'Romantic Getaway': 'romanticGetaway',
        'Family Retreat': 'familyRetreat',
        'Solo Reset': 'soloReset',
        'Digital Detox': 'digitalDetox',
        'Creative Escape': 'creativeEscape',
        'Nature Exploration': 'natureExploration',
        'Adventure Weekend': 'adventureWeekend'
      };
      if (!tripType) return t('success.tripTypes.custom');
      const k = tripTypeKey[tripType];
      return k ? t(`success.tripTypes.${k}`) : tripType;
    },
    [t]
  );

  const generateICS = () => {
    if (!confirmation) return;

    const entity = confirmation.displayEntity || {};
    const checkIn = confirmation.checkIn ? new Date(confirmation.checkIn) : parseDateOnlyLocal(confirmation.checkInDateOnly);
    const checkOut = confirmation.checkOut ? new Date(confirmation.checkOut) : parseDateOnlyLocal(confirmation.checkOutDateOnly);
    if (!checkIn || !checkOut) return;

    checkIn.setHours(12, 0, 0, 0);
    checkOut.setHours(11, 0, 0, 0);

    const formatDate = (date) => date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const meetingPoint = entity.meetingPoint || {};
    let icsLocation = meetingPoint.label || entity.location || '';
    if (meetingPoint.lat && meetingPoint.lng) {
      icsLocation += ` (GPS: ${meetingPoint.lat}, ${meetingPoint.lng})`;
    }

    const stayName = entity.name || t('success.cabinLabel');
    let description = `Drift & Dwells - ${stayName}\n\n`;
    if (meetingPoint.googleMapsUrl) {
      description += `Directions: ${meetingPoint.googleMapsUrl}\n`;
    }
    if (meetingPoint.what3words) {
      description += `What3Words: ///${meetingPoint.what3words}\n`;
    }
    if (entity.emergencyContact) {
      description += `Emergency: ${entity.emergencyContact}\n`;
    }

    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Drift & Dwells//Booking Calendar//EN
BEGIN:VEVENT
UID:${confirmation.bookingId}@driftdwells.com
DTSTAMP:${formatDate(new Date())}
DTSTART:${formatDate(checkIn)}
DTEND:${formatDate(checkOut)}
SUMMARY:Drift & Dwells — ${stayName}
DESCRIPTION:${description.replace(/\n/g, '\\n')}
LOCATION:${icsLocation}
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `drift-dwells-${stayName.toLowerCase().replace(/\s+/g, '-')}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <>
        <Seo
          title={t('success.seoLoadingTitle')}
          description={t('success.seoLoadingDescription')}
          canonicalPath={`/booking-success/${id}`}
          noindex
        />
        <div className="min-h-screen bg-gradient-to-br from-drift-green/5 to-drift-light-green/5">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-drift-green" />
              <p className="mt-4 text-gray-600">{t('success.loadingBody')}</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (error || !confirmation) {
    return (
      <>
        <Seo
          title={t('success.seoErrorTitle')}
          description={t('success.seoErrorDescription')}
          canonicalPath={`/booking-success/${id}`}
          noindex
        />
        <div className="min-h-screen bg-gradient-to-br from-drift-green/5 to-drift-light-green/5">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <div className="text-center">
              <div className="text-red-500 text-6xl mb-4">⚠️</div>
              <h1 className="text-3xl font-bold text-gray-900 mb-4">{t('success.errorTitle')}</h1>
              <p className="text-gray-600 mb-8">{error || t('success.errorDefaultMessage')}</p>
              <Link to="/" className="btn-primary px-8 py-3">
                {t('success.backToHome')}
              </Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  const entity = confirmation.displayEntity || {};
  const meetingPoint = entity.meetingPoint || {};
  const packingList = Array.isArray(entity.packingList) ? entity.packingList : [];
  const paymentSummary = confirmation.paymentSummary || {};
  const guest = confirmation.guest || {};
  const totalNights = confirmation.totalNights || 0;

  return (
    <>
      <Seo
        title={t('success.seoConfirmedTitle', {
          cabinName: entity.name || t('success.cabinLabel')
        })}
        description={t('success.seoConfirmedDescription')}
        canonicalPath={`/booking-success/${id}`}
        noindex
      />
      <div className="min-h-screen bg-drift-bg">
      <div className="bg-gradient-to-r from-drift-primary to-drift-light-green text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-20">
          <div className="text-center">
            <div className="w-20 h-20 md:w-28 md:h-28 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-6 md:mb-8">
              <svg className="w-12 h-12 md:w-16 md:h-16 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>

            <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold mb-4 md:mb-6 tracking-widest uppercase">
              {t('success.heroTitle')}
            </h1>

            <p className="text-lg md:text-xl text-green-100 mb-6 md:mb-8 max-w-2xl lg:max-w-3xl mx-auto leading-relaxed">
              {t('success.heroSubtitle')}
            </p>

            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 md:p-6 inline-block max-w-full">
              <p className="text-base md:text-lg font-semibold tracking-wide">
                {t('success.bookingRef', { ref: confirmation.bookingRef })}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-lg p-6 md:p-8 border border-gray-100 mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-6">{t('success.summaryTitle')}</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div>
                    <span className="text-sm text-gray-500 block">{t('success.cabinLabel')}</span>
                    <h3 className="text-xl font-semibold text-gray-900">{entity.name}</h3>
                    {entity.location ? (
                      <p className="text-gray-600">📍 {entity.location}</p>
                    ) : null}
                    {confirmation.unitLabel ? (
                      <p className="text-sm text-gray-500 mt-1">
                        {t('success.assignedUnitLabel', { label: confirmation.unitLabel })}
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <span className="text-sm text-gray-500 block">{t('fields.checkIn')}</span>
                    <p className="font-medium">
                      {(() => {
                        const d = parseDateOnlyLocal(confirmation.checkInDateOnly);
                        if (d) return formatStayDayWithWeekday(d, routeLanguage);
                        return formatBookingStayForCsv(confirmation, 'checkIn') || null;
                      })()}
                    </p>
                  </div>

                  <div>
                    <span className="text-sm text-gray-500 block">{t('fields.checkOut')}</span>
                    <p className="font-medium">
                      {(() => {
                        const d = parseDateOnlyLocal(confirmation.checkOutDateOnly);
                        if (d) return formatStayDayWithWeekday(d, routeLanguage);
                        return formatBookingStayForCsv(confirmation, 'checkOut') || null;
                      })()}
                    </p>
                  </div>

                  <div>
                    <span className="text-sm text-gray-500 block">{t('success.durationLabel')}</span>
                    <p className="font-medium">{t('modal.nights', { count: totalNights })}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <span className="text-sm text-gray-500 block">{t('success.tripTypeLabel')}</span>
                    <p className="font-medium">{getTripTypeDisplay(confirmation.tripType)}</p>
                  </div>

                  {confirmation.transportMethod && confirmation.transportMethod !== 'Not selected' && (
                    <div>
                      <span className="text-sm text-gray-500 block">{t('success.arrivalMethodLabel')}</span>
                      <p className="font-medium">{confirmation.transportMethod}</p>
                    </div>
                  )}

                  <div>
                    <span className="text-sm text-gray-500 block">{t('success.primaryGuestLabel')}</span>
                    <p className="font-medium">
                      {guest.firstName} {guest.lastName}
                    </p>
                    {guest.email ? <p className="text-sm text-gray-600">{guest.email}</p> : null}
                  </div>

                  <div>
                    <span className="text-sm text-gray-500 block">{t('success.guestsSummaryLabel')}</span>
                    <p className="font-medium">
                      {t('success.adultsCount', { count: confirmation.adults })}
                      {confirmation.children > 0 &&
                        `, ${t('success.childrenCount', { count: confirmation.children })}`}
                    </p>
                  </div>

                  {confirmation.romanticSetup && (
                    <div className="bg-pink-50 border border-pink-200 rounded-lg p-3">
                      <div className="flex items-center text-pink-700">
                        <span className="text-lg mr-2">💕</span>
                        <span className="text-sm font-medium">{t('success.romanticSetup')}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {confirmation.specialRequests && (
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <span className="text-sm text-gray-500 block">{t('success.specialRequestsLabel')}</span>
                  <p className="text-gray-700 mt-1">{confirmation.specialRequests}</p>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-lg p-6 md:p-8 border border-gray-100">
              <h2 className="text-2xl font-semibold text-gray-900 mb-6">{t('success.preArrivalTitle')}</h2>

              {meetingPoint.googleMapsUrl && (
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 mb-3">📍 {t('success.directionsTitle')}</h3>
                  <div className="flex flex-wrap gap-3">
                    <a
                      href={meetingPoint.googleMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg transition-colors duration-200"
                    >
                      {t('success.openGoogleMaps')}
                    </a>

                    {meetingPoint.lat && meetingPoint.lng && (
                      <div className="inline-flex items-center px-4 py-2 bg-gray-100 rounded-lg">
                        <span className="text-sm text-gray-600">
                          GPS: {meetingPoint.lat}, {meetingPoint.lng}
                        </span>
                      </div>
                    )}

                    {meetingPoint.what3words && (
                      <a
                        href={`https://what3words.com/${meetingPoint.what3words}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center px-4 py-2 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg transition-colors duration-200"
                      >
                        <span className="text-sm">{`///${meetingPoint.what3words}`}</span>
                      </a>
                    )}
                  </div>
                </div>
              )}

              {isValleyLocation(entity.location) && (
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 mb-3">🗺️ {t('success.interactiveGuideTitle')}</h3>
                  <Link
                    to={`/my-trip/${confirmation.bookingId}/valley-guide`}
                    className="inline-flex items-center px-4 py-2 bg-drift-green hover:bg-drift-light-green text-white rounded-lg transition-colors duration-200"
                  >
                    {t('success.openValleyGuide')}
                  </Link>
                  <p className="text-sm text-gray-600 mt-2">{t('success.valleyGuideBlurb')}</p>
                </div>
              )}

              {entity.arrivalGuideUrl && (
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 mb-3">📄 {t('success.arrivalGuideTitle')}</h3>
                  <a
                    href={entity.arrivalGuideUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-4 py-2 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg transition-colors duration-200"
                  >
                    {getGuideCtaLabel(entity.arrivalGuideUrl)}
                  </a>
                </div>
              )}

              <div className="mb-6">
                <h3 className="font-semibold text-gray-900 mb-3">🎒 {t('success.packingSafetyTitle')}</h3>
                <div className="flex flex-wrap gap-3">
                  {packingList.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowPackingModal(true)}
                      className="inline-flex items-center px-4 py-2 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-lg transition-colors duration-200"
                    >
                      {t('success.viewPackingList')}
                    </button>
                  )}

                  {entity.safetyNotes && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 w-full">
                      <h4 className="text-sm font-medium text-yellow-800">{t('success.safetyRulesTitle')}</h4>
                      <p className="text-sm text-yellow-700 mt-1">{entity.safetyNotes}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                {entity.arrivalWindowDefault && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <h4 className="text-sm font-medium text-blue-800">{t('success.arrivalWindowTitle')}</h4>
                    <p className="text-sm text-blue-700">{entity.arrivalWindowDefault}</p>
                  </div>
                )}

                {entity.emergencyContact && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <h4 className="text-sm font-medium text-red-800">{t('success.emergencyContactTitle')}</h4>
                    <p className="text-sm text-red-700">{entity.emergencyContact}</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={generateICS}
                  className="flex items-center justify-center px-4 py-3 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors duration-200"
                >
                  {t('success.addToCalendar')}
                </button>

                <a
                  href="https://wa.me/359881234567"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center px-4 py-3 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg transition-colors duration-200"
                >
                  {t('success.whatsappGroup')}
                </a>
              </div>
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100 mb-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('success.totalCostTitle')}</h3>
              <div className="text-center">
                <div className="text-3xl font-bold text-drift-green mb-2">
                  €{paymentSummary.displayAmount}
                </div>
                <p className="text-sm text-gray-500">{formatPaymentSubline(t, paymentSummary)}</p>
              </div>
            </div>

            <div className="bg-gradient-to-br from-drift-green to-drift-light-green text-white rounded-xl p-6 md:p-8">
              <div className="text-center">
                <div className="text-4xl mb-4">🌲</div>
                <blockquote className="text-lg italic mb-6">{t('success.quoteBody')}</blockquote>
                <p className="text-green-100 text-sm">{t('success.quoteFooter')}</p>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100 mt-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('success.needHelpTitle')}</h3>
              <div className="space-y-3 text-sm">
                <a href={`mailto:${CONTACT_EMAIL}`} className="text-drift-green hover:underline block">
                  {CONTACT_EMAIL}
                </a>
                <a
                  href={`tel:${CONTACT_PHONE.replace(/\s/g, '')}`}
                  className="text-drift-green hover:underline tabular-nums block"
                >
                  {CONTACT_PHONE}
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className="text-center mt-12">
          <div className="flex flex-col sm:flex-row gap-4 justify-center max-w-lg mx-auto">
            <Link to={localizePath('/', routeLanguage)} className="btn-primary px-8 py-3">
              {t('success.backToHome')}
            </Link>
            <Link to={localizePath('/search', routeLanguage)} className="btn-secondary px-8 py-3">
              {t('success.exploreMoreStays')}
            </Link>
          </div>

          <p className="text-sm text-gray-500 mt-6 max-w-2xl mx-auto">
            {t('success.footerNoteLine1')}
            <br />
            {t('success.footerNoteLine2')}
          </p>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mt-4 text-sm text-drift-green">
            <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
              Instagram
            </a>
            <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
              Facebook
            </a>
          </div>
        </div>
      </div>

      {showPackingModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full max-h-96 overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">{t('success.packingListModalTitle')}</h3>
              <button
                type="button"
                onClick={() => setShowPackingModal(false)}
                className="text-gray-400 hover:text-gray-600"
                aria-label={t('success.closePackingAria')}
              >
                ×
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-64">
              <ul className="space-y-2">
                {packingList.map((item, index) => (
                  <li key={index} className="flex items-center">
                    <span className="text-green-500 mr-2">✓</span>
                    <span className="text-gray-700">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
};

export default BookingSuccess;
