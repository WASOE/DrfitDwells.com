import PublicArrivalGuideTemplate from './PublicArrivalGuideTemplate';

const valleyCheckpoints = [
  {
    title: 'Checkpoint 1 - Eleshnitsa route commitment',
    onTrack: 'You pass Eleshnitsa and begin the sustained mountain climb.',
    recovery: 'If navigation pushes Kraishte shortcut, reject it and restart route from Eleshnitsa.'
  },
  {
    title: 'Checkpoint 2 - Palatik corridor',
    onTrack: 'Narrow forest road with village edges and pine sections around Palatik.',
    recovery: 'If the road profile turns broad/open too early, stop and re-run navigation from Palatik.'
  },
  {
    title: 'Checkpoint 3 - Chereshovo gravel parking',
    onTrack: 'Signed gravel pocket before final foot access; local track narrows beyond this.',
    recovery: 'Do not drive beyond this point. Park here and continue on foot or arranged transfer.'
  }
];

export default function ValleyPublicGuide() {
  return (
    <PublicArrivalGuideTemplate
      propertyName="The Valley"
      purposeLine="Field-ready arrival companion for your final approach into The Valley."
      heroImageUrl="/uploads/The%20Valley/WhatsApp%20Image%202025-10-17%20at%2010.20.23%20AM.jpeg"
      destinationLabel="Chereshovo parking pocket (final vehicle stop)"
      coordinates="41.949939, 23.715978"
      navigateUrl="https://www.google.com/maps/dir/?api=1&origin=Current+Location&destination=41.9551759,23.738895&waypoints=optimize:false|41.9020,23.6520|41.9278,23.6953|41.949939,23.715978&travelmode=driving&dir_action=navigate"
      parkingNote="Use signed gravel parking in Chereshovo. Do not drive past it with private vehicles."
      checkInBasics="Message your ETA before the final climb. If arranged, transfer support meets you at parking."
      finalApproachNote="Final ~1km is by foot on forest track (15-25 min). Keep a torch ready for dusk."
      routeCheckpoints={valleyCheckpoints}
      realityNotes={[
        'Signal weak or unstable near final approach; save this guide and map offline.',
        'Mountain weather shifts quickly; carry a warm layer even in mild daytime weather.',
        'If arriving after sunset, reduce speed and keep buffer time for parking and walk-in.',
        'Road traction can degrade after rain and in shoulder-season mornings.'
      ]}
      packItems={[
        'Headlamp or phone torch + power bank',
        'Closed shoes with grip',
        'Warm outer layer',
        'Water for final walk',
        'Personal medication'
      ]}
      emergencyContact="+359 876 342 540"
      supportContact="+359 876 342 540"
      fallbackPoint="Chereshovo center / village square (best point to stop and call)."
      lostRecovery="Stop at the last confirmed checkpoint, share your live location when signal returns, and wait for route confirmation."
      driftIntro="Drift & Dwells hosts remote stays designed for calm, nature, and reliable practical support when conditions are less than perfect."
      directBookMessage="Next stay tip: booking direct gives you flexible support and first access to special windows."
      seasonalRoadNote="In wet, snowy, or thaw conditions expect slower access and allow extra daylight margin."
      canonicalPath="/guides/the-valley"
      seoTitle="The Valley Arrival Guide | Drift & Dwells"
      seoDescription="Practical public arrival guide for The Valley: route checkpoints, final approach, parking, weak-signal and recovery actions."
      noindex
      showWeakSignalWarning
    />
  );
}
