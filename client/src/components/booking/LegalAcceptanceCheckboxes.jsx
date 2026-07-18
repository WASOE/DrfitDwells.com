import { Link } from 'react-router-dom';
import { useSiteLanguage } from '../../hooks/useSiteLanguage';
import {
  buildCheckbox1LinkParts,
  getLegalAcceptanceCheckboxTexts
} from '../../constants/legalAcceptance';

/**
 * Locale-aware legal acknowledgement checkboxes.
 * Display copy comes from legalAcceptance constants (same source as booking snapshots).
 */
export default function LegalAcceptanceCheckboxes({
  agreedToTerms,
  agreedToActivityRisk,
  onAgreedToTermsChange,
  onAgreedToActivityRiskChange,
  termsError,
  activityRiskError,
  requiredMarker = false,
  className = 'space-y-4',
  labelClassName = 'flex items-start gap-3 cursor-pointer',
  checkboxClassName = 'mt-0.5 w-5 h-5 rounded border-gray-300 text-gray-900 focus:ring-gray-900',
  textClassName = 'text-sm text-gray-800 leading-relaxed',
  linkClassName = 'underline',
  errorClassName = 'mt-2 text-sm text-red-600',
  termsPath = '/terms',
  cancellationPath = '/cancellation-policy'
}) {
  const { language } = useSiteLanguage();
  const texts = getLegalAcceptanceCheckboxTexts(language);
  const checkbox1Parts = buildCheckbox1LinkParts(language);

  return (
    <div className={className}>
      <div>
        <label className={labelClassName}>
          <input
            type="checkbox"
            checked={!!agreedToTerms}
            onChange={(e) => onAgreedToTermsChange(e.target.checked)}
            className={`${checkboxClassName}${termsError ? ' border-red-500' : ''}`}
          />
          <span className={textClassName}>
            {checkbox1Parts.map((part, index) => {
              if (part.type === 'terms') {
                return (
                  <Link
                    key={`terms-${index}`}
                    to={termsPath}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={linkClassName}
                  >
                    {part.value}
                  </Link>
                );
              }
              if (part.type === 'cancellation') {
                return (
                  <Link
                    key={`cancellation-${index}`}
                    to={cancellationPath}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={linkClassName}
                  >
                    {part.value}
                  </Link>
                );
              }
              return <span key={`text-${index}`}>{part.value}</span>;
            })}
            {requiredMarker ? ' *' : null}
          </span>
        </label>
        {termsError ? <p className={errorClassName}>{termsError}</p> : null}
      </div>

      <div>
        <label className={labelClassName}>
          <input
            type="checkbox"
            checked={!!agreedToActivityRisk}
            onChange={(e) => onAgreedToActivityRiskChange(e.target.checked)}
            className={`${checkboxClassName}${activityRiskError ? ' border-red-500' : ''}`}
          />
          <span className={textClassName}>{texts.checkbox2}</span>
        </label>
        {activityRiskError ? <p className={errorClassName}>{activityRiskError}</p> : null}
      </div>
    </div>
  );
}
