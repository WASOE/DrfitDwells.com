import { useMemo, useState } from 'react';
import { Phone, Navigation, Download, MessageCircle, Copy } from 'lucide-react';
import Seo from '../../components/Seo';
import GuideMapModule from './GuideMapModule';
import {
  SUPPORT_WHATSAPP_LINK,
  buildTelLink,
  copyToClipboard,
  looksLikePdf,
  openPrintableGuide,
  toAbsoluteGuideUrl
} from './guideUtils';
import './PublicArrivalGuide.css';
import '../the-valley/the-valley.css';

const ActionButton = ({ href, onClick, icon: Icon, label, secondary = false, disabled = false }) => (
  <a
    href={disabled ? '#' : (href || '#')}
    onClick={(e) => {
      if (disabled || !href) e.preventDefault();
      if (onClick) onClick(e);
    }}
    target={href?.startsWith('http') ? '_blank' : undefined}
    rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
    aria-disabled={disabled}
    className={`flex-1 min-h-[46px] rounded-full px-3 py-2.5 flex items-center justify-center gap-1.5 transition-all touch-manipulation active:scale-[0.98] ${
      secondary
        ? 'bg-white border border-stone-200 text-stone-900 text-xs font-semibold uppercase tracking-[0.14em] hover:bg-stone-50 hover:border-[#81887a]/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#81887a]'
        : 'bg-[#F1ECE2] text-stone-900 text-xs font-bold uppercase tracking-[0.18em] shadow-sm hover:brightness-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#81887a]'
    } ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
  >
    <Icon size={14} strokeWidth={2} className="shrink-0 opacity-90" aria-hidden />
    <span>{label}</span>
  </a>
);

const GuideSection = ({ title, children }) => (
  <section className="public-guide-section">
    <h2 className="public-guide-section-title">{title}</h2>
    {children}
  </section>
);

const KeyPairPanel = ({ label, value }) => {
  if (!value) return null;
  return (
    <div className="public-guide-panel">
      <p><strong>{label}:</strong> {value}</p>
    </div>
  );
};

const Checklist = ({ items }) => {
  if (!items.length) return null;
  return (
    <ul className="public-guide-list">
      {items.map((item) => (
        <li key={item}>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
};

export default function PublicArrivalGuideTemplate({
  propertyName,
  purposeLine,
  heroImageUrl,
  destinationLabel,
  coordinates,
  navigateUrl,
  parkingNote,
  checkInBasics,
  finalApproachNote,
  routeCheckpoints = [],
  /** Compact offline files + handoff only (e.g. The Cabin). Rendered after Fast-help, before brand. */
  navigationPack,
  guideMapData,
  realityNotes = [],
  packItems = [],
  emergencyContact,
  supportContact,
  fallbackPoint,
  lostRecovery,
  driftIntro,
  directBookMessage,
  seasonalRoadNote,
  offlineHint = 'Save this page to your phone before departure.',
  routeCopyLabel = 'Copy coordinates',
  showWeakSignalWarning = false,
  externalGuideUrl,
  canonicalPath,
  seoTitle,
  seoDescription,
  noindex = true
}) {
  const [toast, setToast] = useState('');
  const telHref = useMemo(() => buildTelLink(emergencyContact || supportContact || ''), [emergencyContact, supportContact]);
  const guideUrl = toAbsoluteGuideUrl(externalGuideUrl || '');

  const hasArrivalEssentials = Boolean(destinationLabel || coordinates || parkingNote || checkInBasics || finalApproachNote);
  const hasRoute = routeCheckpoints.length > 0;
  const hasReality = realityNotes.length > 0 || showWeakSignalWarning || Boolean(seasonalRoadNote);
  const hasFastHelp = Boolean(emergencyContact || supportContact || fallbackPoint || lostRecovery);
  const hasBrandFooter = Boolean(driftIntro || directBookMessage);

  const handleDownload = () => {
    if (guideUrl && looksLikePdf(guideUrl)) {
      window.open(guideUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    openPrintableGuide();
  };

  const copyCoords = async () => {
    const ok = await copyToClipboard(coordinates);
    if (ok) {
      setToast('Coordinates copied');
      setTimeout(() => setToast(''), 1800);
    }
  };

  return (
    <div className="public-guide-shell min-h-screen">
      <Seo
        title={seoTitle || `${propertyName} Arrival Guide | Drift & Dwells`}
        description={seoDescription || purposeLine}
        canonicalPath={canonicalPath || '/guides/the-valley'}
        noindex={noindex}
      />
      <div className="public-guide-container valley-container">
        <header className="public-guide-hero">
          {heroImageUrl ? <img className="public-guide-image" src={heroImageUrl} alt={`${propertyName} arrival view`} loading="lazy" /> : null}
          <p className="public-guide-eyebrow valley-label">Drift & Dwells arrival guide</p>
          <h1 className="public-guide-title valley-h2">{propertyName}</h1>
          <p className="public-guide-subtitle valley-intro">{purposeLine}</p>
          <p className="public-guide-offline-note">{offlineHint}</p>
        </header>

        <div className="public-guide-sticky-actions">
          <div className="public-guide-actions-grid">
            <ActionButton href={navigateUrl} icon={Navigation} label="Navigate" disabled={!navigateUrl} />
            <ActionButton onClick={handleDownload} icon={Download} label="Download PDF" secondary />
            <ActionButton href={telHref} icon={Phone} label="Call" secondary disabled={!telHref} />
            <ActionButton href={SUPPORT_WHATSAPP_LINK} icon={MessageCircle} label="WhatsApp" secondary />
          </div>
        </div>

        {hasArrivalEssentials ? (
          <GuideSection title="Arrival essentials">
            <div className="public-guide-grid">
              <KeyPairPanel label="Destination" value={destinationLabel} />
              <div className="public-guide-panel">
                <p><strong>Coordinates:</strong> {coordinates || 'Not shared for this property'}</p>
                {coordinates ? (
                  <button
                    type="button"
                    onClick={copyCoords}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 border border-stone-200 bg-white text-xs font-semibold uppercase tracking-wider text-stone-800 mt-2 hover:bg-[#F1ECE2] hover:border-[#81887a]/35 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#81887a]"
                  >
                    <Copy size={12} aria-hidden /> {routeCopyLabel}
                  </button>
                ) : null}
              </div>
              <KeyPairPanel label="Parking" value={parkingNote} />
              <KeyPairPanel label="Check-in basics" value={checkInBasics} />
              <KeyPairPanel label="Final approach" value={finalApproachNote} />
            </div>
          </GuideSection>
        ) : null}

        {guideMapData ? (
          <GuideSection title="Guide map">
            <GuideMapModule data={guideMapData} />
          </GuideSection>
        ) : null}

        {hasRoute ? (
          <GuideSection title="Route reassurance">
            <div className="public-guide-grid">
              {routeCheckpoints.map((point) => (
                <div key={point.title} className="public-guide-panel">
                  <p><strong>{point.title}</strong></p>
                  <p style={{ marginTop: 6 }}><strong>If you see:</strong> {point.onTrack}</p>
                  <p style={{ marginTop: 6 }}><strong>If you miss it:</strong> {point.recovery}</p>
                </div>
              ))}
            </div>
          </GuideSection>
        ) : null}

        {hasReality ? (
          <GuideSection title="Reality layer">
            <Checklist items={realityNotes} />
            {showWeakSignalWarning ? (
              <div className="public-guide-panel public-guide-note-warn" style={{ marginTop: 10 }}>
                <p>Weak signal expected near final approach. Save this page and map route offline.</p>
              </div>
            ) : null}
            {seasonalRoadNote ? (
              <div className="public-guide-panel public-guide-note-info" style={{ marginTop: 10 }}>
                <p><strong>Seasonal road note:</strong> {seasonalRoadNote}</p>
              </div>
            ) : null}
          </GuideSection>
        ) : null}

        {packItems.length ? (
          <GuideSection title="What to pack for arrival">
            <Checklist items={packItems} />
          </GuideSection>
        ) : null}

        {hasFastHelp ? (
          <GuideSection title="Fast-help">
            <div className="public-guide-grid">
              <KeyPairPanel label="Emergency contact" value={emergencyContact} />
              <KeyPairPanel label="Support contact" value={supportContact} />
              <KeyPairPanel label="Nearest fallback point" value={fallbackPoint} />
              <KeyPairPanel label="If lost" value={lostRecovery} />
            </div>
          </GuideSection>
        ) : null}

        {navigationPack ? (
          <GuideSection title="Offline navigation files">
            {navigationPack}
          </GuideSection>
        ) : null}

        {hasBrandFooter ? (
          <GuideSection title="About Drift & Dwells">
            <div className="public-guide-grid">
              <KeyPairPanel label="About" value={driftIntro} />
              <KeyPairPanel label="Book direct next time" value={directBookMessage} />
            </div>
          </GuideSection>
        ) : null}

        <div className="public-guide-tail-cta">
          <a href="/about" className="public-guide-about-cta">
            Read our story
          </a>
        </div>
      </div>

      {toast ? <div className="public-guide-toast valley-caption">{toast}</div> : null}
    </div>
  );
}
