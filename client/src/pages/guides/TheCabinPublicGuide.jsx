import PublicArrivalGuideTemplate from './PublicArrivalGuideTemplate';
import {
  CABIN_COORDINATES,
  CABIN_HERO_IMAGE,
  CABIN_NAVIGATE_URL,
  HOST_PHONE_DISPLAY,
  PDF_CHECKLIST_URL
} from './the-cabin/arrivalConstants';

export default function TheCabinPublicGuide() {
  return (
    <PublicArrivalGuideTemplate
      propertyName="The Cabin"
      purposeLine="Field-ready arrival companion for your final approach into The Cabin."
      heroImageUrl={CABIN_HERO_IMAGE}
      destinationLabel="The Cabin, Bachevo"
      coordinates={CABIN_COORDINATES}
      navigateUrl={CABIN_NAVIGATE_URL}
      parkingNote="Use the pull-in from our arrival message. Pull fully off the lane so local traffic can pass."
      checkInBasics="If needed, stop safely and message us before the final approach."
      finalApproachNote="Road narrows and surface turns rough near the end. Stay on the pinned route and keep speed low."
      routeCheckpoints={[
        {
          title: 'Village ends, road changes',
          onTrack: 'Last houses fade, lane narrows, and the road continues uphill.',
          recovery: 'If the road stops climbing or feels private, return to the last confirmed point and restart navigation.'
        },
        {
          title: 'Surface gets rougher',
          onTrack: 'Gravel, ruts, and slower progress are normal.',
          recovery: 'Do not take side tracks. Stay on the main uphill line.'
        },
        {
          title: 'Final approach confidence',
          onTrack: 'Narrow lane, rough surface, and steady climb mean you are still correct.',
          recovery: 'If unsure, stop safely and contact us.'
        }
      ]}
      realityNotes={[
        'Signal can be weak near the final approach.',
        'Arrive in daylight where possible.',
        'Slow and steady driving is normal on this road.'
      ]}
      packItems={['Download your offline route', 'Power bank', 'Warm layer for mountain weather']}
      emergencyContact={HOST_PHONE_DISPLAY}
      supportContact={HOST_PHONE_DISPLAY}
      fallbackPoint="Bachevo center"
      lostRecovery="Return to Bachevo center, re-open navigation, and contact us before attempting the final approach again."
      driftIntro="Drift & Dwells hosts remote stays designed for calm, nature, and practical support when needed."
      directBookMessage="For your next stay, direct booking gives faster support and clearer pre-arrival guidance."
      offlineHint="Save this page and navigation route before departure."
      externalGuideUrl={PDF_CHECKLIST_URL}
      canonicalPath="/guides/the-cabin"
      seoTitle="The Cabin Arrival Guide | Drift & Dwells"
      seoDescription="Practical public arrival guide for The Cabin: route checkpoints, final approach, parking, and support."
      noindex
      showWeakSignalWarning
    />
  );
}
