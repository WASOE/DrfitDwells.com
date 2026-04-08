import { format } from 'date-fns';
import { enGB, bg } from 'date-fns/locale';

/** BCP 47 tags aligned with site languages (en → en-GB for copy and calendars). */
export function getBcp47ForSiteLanguage(siteLanguage) {
  return siteLanguage === 'bg' ? 'bg-BG' : 'en-GB';
}

/** date-fns locale objects — use enGB everywhere for English, never enUS. */
export function getDateFnsLocale(siteLanguage) {
  return siteLanguage === 'bg' ? bg : enGB;
}

export function formatStayDay(date, siteLanguage) {
  if (!date) return '';
  return format(date, 'd MMM', { locale: getDateFnsLocale(siteLanguage) });
}

export function formatStayRangeSummary(checkIn, checkOut, siteLanguage) {
  if (!checkIn || !checkOut) return '';
  const loc = getDateFnsLocale(siteLanguage);
  return `${format(checkIn, 'd MMM', { locale: loc })} → ${format(checkOut, 'd MMM', { locale: loc })}`;
}

/** Longer display with year (confirmations, success pages). */
export function formatStayDayLong(date, siteLanguage) {
  if (!date) return '';
  return format(date, 'd MMM yyyy', { locale: getDateFnsLocale(siteLanguage) });
}

/** Full weekday + calendar date (confirmations, success page). */
export function formatStayDayWithWeekday(date, siteLanguage) {
  if (!date) return '';
  return format(date, 'EEEE d MMMM yyyy', { locale: getDateFnsLocale(siteLanguage) });
}

/**
 * react-datepicker format string; month names still localize when `locale` prop is set.
 * Keep pattern consistent with {@link formatStayDay} (day before month, en-GB style).
 */
export function getReactDatepickerDateFormat() {
  return 'dd MMM';
}

/** Registered ids for react-datepicker `locale` (call {@link registerReactDatepickerLocales} before first open). */
export function getReactDatepickerLocaleKey(siteLanguage) {
  return siteLanguage === 'bg' ? 'bg' : 'en-GB';
}

export function registerReactDatepickerLocales(registerLocale) {
  registerLocale('en-GB', enGB);
  registerLocale('bg', bg);
}
