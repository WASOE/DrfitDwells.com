import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { publicGuideAPI } from '../../services/api';
import PublicArrivalGuideTemplate from './PublicArrivalGuideTemplate';

const defaultReality = [
  'Expect variable mobile signal close to remote properties.',
  'Check weather and road conditions before final departure.',
  'Aim to arrive in daylight where possible.',
  'Keep a backup battery and offline navigation ready.'
];

const normalizeLocationCheckpoint = (location) => ({
  title: 'Property area checkpoint',
  onTrack: `You are approaching ${location}. Slow down and verify destination details before the final turn.`,
  recovery: 'If you pass the expected area, stop at a safe point and re-open main route.'
});

const safeText = (value) => (value && String(value).trim()) || '';

export default function ValleyStayPublicGuide() {
  const { staySlug } = useParams();
  const [state, setState] = useState({ loading: true, error: '', guide: null });

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        setState({ loading: true, error: '', guide: null });
        const res = await publicGuideAPI.getValleyStayGuideBySlug(staySlug);
        const guide = res?.data?.data?.guide;
        if (!guide) throw new Error('Guide data unavailable');
        if (mounted) setState({ loading: false, error: '', guide });
      } catch (_err) {
        if (mounted) {
          setState({ loading: false, error: 'Valley stay-specific guide unavailable for this stay slug.', guide: null });
        }
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [staySlug]);

  const guideData = useMemo(() => {
    if (!state.guide) return null;
    const c = state.guide;
    const hasCoords = c?.meetingPoint?.lat && c?.meetingPoint?.lng;
    const coordinates = hasCoords ? `${c.meetingPoint.lat}, ${c.meetingPoint.lng}` : '';
    return {
      propertyName: c.propertyName || 'Valley stay',
      purposeLine: 'Stay-specific Valley arrival guide with route and final approach details.',
      heroImageUrl: c.imageUrl,
      destinationLabel: safeText(c?.meetingPoint?.label) || safeText(c.location),
      coordinates,
      navigateUrl: c?.meetingPoint?.googleMapsUrl || '',
      parkingNote: safeText(c?.safetyNotes),
      checkInBasics: safeText(c?.arrivalWindowDefault),
      finalApproachNote: 'Confirm final turn, gate, or entry marker before leaving the main road.',
      routeCheckpoints: [normalizeLocationCheckpoint(c.location || 'the property')],
      realityNotes: defaultReality,
      packItems: c.packingList?.length ? c.packingList : [],
      emergencyContact: c.emergencyContact || '',
      supportContact: c.emergencyContact || '',
      fallbackPoint: c?.meetingPoint?.label || '',
      lostRecovery: 'Do not continue guessing. Stop safely, share your location, and wait for confirmation.',
      driftIntro: 'Drift & Dwells focuses on low-friction stays where practical support and clear guidance come first.',
      directBookMessage: 'For your next stay, direct booking gives faster support and smoother pre-arrival guidance.',
      seasonalRoadNote: 'In winter, rain, or fog windows, add extra drive time and prioritize daylight arrival.',
      externalGuideUrl: c.arrivalGuideUrl || '',
      canonicalPath: `/guides/the-valley/${staySlug}`,
      seoTitle: `${c.propertyName || 'Valley stay'} Arrival Guide | Drift & Dwells`,
      seoDescription: 'Practical arrival instructions and final approach details for this Valley stay.',
      noindex: true
    };
  }, [state.guide, staySlug]);

  if (state.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--valley-canvas)' }}>
        <p className="valley-body">Loading guide...</p>
      </div>
    );
  }

  if (state.error || !guideData) {
    return (
      <div className="min-h-screen flex items-center justify-center px-5 text-center" style={{ backgroundColor: 'var(--valley-canvas)' }}>
        <p className="valley-body">{state.error || 'Guide unavailable.'}</p>
      </div>
    );
  }

  return <PublicArrivalGuideTemplate {...guideData} />;
}
