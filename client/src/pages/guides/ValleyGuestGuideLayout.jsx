import { useState } from 'react';
import { Phone, Navigation, Printer, MessageCircle, Copy, FileText } from 'lucide-react';
import Seo from '../../components/Seo';
import {
  SUPPORT_WHATSAPP_LINK,
  buildTelLink,
  copyToClipboard,
  openPrintableGuide
} from './guideUtils';
import {
  HOW_TO_ARRIVE_PDF_PATH,
  GUEST_GUIDE_PDF_PATH
} from '@shared/valley/accessFacts';
import './PublicArrivalGuide.css';
import './ValleyGuestGuide.css';
import '../the-valley/the-valley.css';

const GuideAction = ({ href, onClick, icon: Icon, label, variant = 'secondary', disabled = false }) => (
  <a
    href={disabled ? '#' : href || '#'}
    onClick={(e) => {
      if (disabled || (!href && !onClick)) e.preventDefault();
      if (onClick) onClick(e);
    }}
    target={href?.startsWith('http') ? '_blank' : undefined}
    rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
    aria-disabled={disabled}
    className={`valley-guest-guide__action valley-guest-guide__action--${variant}${
      disabled ? ' is-disabled' : ''
    }`}
  >
    <Icon
      size={variant === 'primary' ? 16 : 15}
      strokeWidth={1.75}
      className="valley-guest-guide__action-icon"
      aria-hidden
    />
    <span className="valley-guest-guide__action-label">{label}</span>
  </a>
);

/**
 * Dedicated long-form Valley guest guide shell (not the Cabin arrival template).
 */
export default function ValleyGuestGuideLayout({
  seoTitle,
  seoDescription,
  canonicalPath,
  noindex = true,
  heroImageUrl,
  navigateUrl,
  emergencyContact,
  supportContact,
  parkingCoordinates,
  children
}) {
  const [toast, setToast] = useState('');
  const telHref = buildTelLink(emergencyContact || supportContact || '');

  const copyCoords = async () => {
    const ok = await copyToClipboard(parkingCoordinates);
    if (ok) {
      setToast('Parking coordinates copied');
      setTimeout(() => setToast(''), 1800);
    }
  };

  return (
    <div className="public-guide-shell valley-guest-guide min-h-screen">
      <Seo
        title={seoTitle || 'The Valley Guest Guide | Drift & Dwells'}
        description={seoDescription}
        canonicalPath={canonicalPath || '/guides/the-valley'}
        noindex={noindex}
      />
      <div className="public-guide-container valley-container valley-guest-guide__container">
        <header className="public-guide-hero">
          {heroImageUrl ? (
            <img
              className="public-guide-image"
              src={heroImageUrl}
              alt="The Valley in the Rhodope Mountains"
              loading="lazy"
            />
          ) : null}
          <p className="public-guide-eyebrow valley-label">Drift & Dwells guest guide</p>
          <h1 className="public-guide-title valley-h2">The Valley</h1>
          <p className="public-guide-subtitle valley-intro">
            Read this before you travel. It covers where you are going, what to bring, the correct road to
            Chereshovo, and the final approach from parking.
          </p>
          <p className="public-guide-offline-note">
            Save or print this page before you lose signal. Final check-in details arrive a few days before
            your stay.
          </p>
        </header>

        <div className="public-guide-sticky-actions valley-guest-guide__actions">
          <div className="valley-guest-guide__action-stack">
            <GuideAction
              href={navigateUrl}
              icon={Navigation}
              label="Navigate to parking"
              variant="primary"
              disabled={!navigateUrl}
            />
            <div className="valley-guest-guide__action-row">
              <GuideAction href={telHref} icon={Phone} label="Call" disabled={!telHref} />
              <GuideAction href={SUPPORT_WHATSAPP_LINK} icon={MessageCircle} label="WhatsApp" />
            </div>
            <button
              type="button"
              className="valley-guest-guide__print-link"
              onClick={() => openPrintableGuide()}
            >
              <Printer size={14} strokeWidth={1.75} aria-hidden />
              Print / save offline
            </button>
          </div>
          <div className="valley-guest-guide__pdf-row">
            <a
              className="valley-guest-guide__pdf-link"
              href={HOW_TO_ARRIVE_PDF_PATH}
              target="_blank"
              rel="noopener noreferrer"
            >
              <FileText size={14} aria-hidden />
              How to arrive (PDF)
            </a>
            <a
              className="valley-guest-guide__pdf-link"
              href={GUEST_GUIDE_PDF_PATH}
              target="_blank"
              rel="noopener noreferrer"
            >
              <FileText size={14} aria-hidden />
              Full guest guide (PDF)
            </a>
          </div>
          {parkingCoordinates ? (
            <div className="valley-guest-guide__coords-bar">
              <span>
                Parking: <strong>{parkingCoordinates}</strong>
              </span>
              <button type="button" onClick={copyCoords} className="valley-guest-guide__copy-btn">
                <Copy size={12} aria-hidden /> Copy
              </button>
            </div>
          ) : null}
        </div>

        <nav className="valley-guest-guide__toc" aria-label="Guide sections">
          <a href="#welcome">Welcome</a>
          <a href="#before-town">Before town</a>
          <a href="#getting-there">Getting there</a>
          <a href="#parking-final">Parking &amp; final approach</a>
          <a href="#off-grid">Off-grid</a>
          <a href="#stay-safety">Stay &amp; safety</a>
          <a href="#activities">Around</a>
          <a href="#final-info">Useful info</a>
        </nav>

        <div className="valley-guest-guide__body">{children}</div>
      </div>

      {toast ? <div className="public-guide-toast valley-caption">{toast}</div> : null}
    </div>
  );
}

export function GuideSection({ id, title, children }) {
  return (
    <section id={id} className="valley-guest-guide__section">
      <h2 className="valley-guest-guide__section-title">{title}</h2>
      <div className="valley-guest-guide__section-body">{children}</div>
    </section>
  );
}

export function GuideSubheading({ children }) {
  return <h3 className="valley-guest-guide__subheading">{children}</h3>;
}
