import ValleyGuestGuideLayout, { GuideSection, GuideSubheading } from './ValleyGuestGuideLayout';
import {
  VALLEY_LOCATION,
  CHERESHOVO_PARKING,
  FINAL_APPROACH,
  KRAISHTE_WARNING,
  guestNavigateUrl,
  formatRouteArrowLine,
  CANONICAL_GUIDE_PATH,
  HOW_TO_ARRIVE_PDF_PATH,
  GUEST_GUIDE_PDF_PATH
} from '@shared/valley/accessFacts';

const CONTACT = '+359 876342540';

export default function ValleyPublicGuide() {
  return (
    <ValleyGuestGuideLayout
      seoTitle="The Valley Guest Guide | Drift & Dwells"
      seoDescription="Pre-trip guide for The Valley: location near Bansko, Chereshovo arrival via Eleshnitsa and Palatik, parking, and the final 2.5 km approach."
      canonicalPath={CANONICAL_GUIDE_PATH}
      noindex
      heroImageUrl="/uploads/The%20Valley/WhatsApp%20Image%202025-10-17%20at%2010.20.23%20AM.jpeg"
      navigateUrl={guestNavigateUrl}
      emergencyContact={CONTACT}
      supportContact={CONTACT}
      parkingCoordinates={CHERESHOVO_PARKING.coordinatesDisplay}
    >
      <GuideSection id="welcome" title="1. Welcome & location">
        <p>
          The Valley is {VALLEY_LOCATION.summary}. It is a small off-grid place with individual stays and
          shared outdoor space in the forest — quiet, remote, and practical once you know how arrival works.
        </p>
        <p>
          This guide is for <strong>before your trip</strong>. A few days before arrival we send current
          operational details (exact meeting confirmation, transfer if arranged, and check-in specifics).
          Those messages confirm the basics below; they should not be the first time you learn the road.
        </p>
        <GuideSubheading>What to expect</GuideSubheading>
        <ul>
          <li>No shops on the climb — stock up in Bansko or Razlog first.</li>
          <li>Phone signal can weaken on the final approach — save this page offline.</li>
          <li>Days are unstructured: walk, cook, rest, sit by the fire.</li>
        </ul>
      </GuideSection>

      <GuideSection id="before-town" title="2. Before you leave town">
        <p>
          Once you leave Bansko or Razlog toward the mountains, treat town as your last easy supply stop.
        </p>
        <GuideSubheading>Pack</GuideSubheading>
        <ul>
          <li>Closed shoes with grip for the final walk</li>
          <li>Warm layers (nights cool quickly)</li>
          <li>Rain jacket</li>
          <li>Headlamp or strong phone torch + power bank</li>
          <li>Personal medication and any baby supplies you need</li>
        </ul>
        <GuideSubheading>Buy before you drive up</GuideSubheading>
        <ul>
          <li>Food for every main meal of your stay</li>
          <li>Water, drinks, coffee, tea</li>
          <li>Full fuel tank</li>
          <li>Optional cash for local products (honey, cheese, eggs, and similar)</li>
        </ul>
        <p className="valley-guest-guide__muted">
          There are no supermarkets or pharmacies on the way into The Valley.
        </p>
      </GuideSection>

      <GuideSection id="getting-there" title="3. Getting to The Valley">
        <p>
          <strong>Chereshovo is the default arrival village.</strong> In normal conditions a normal passenger
          car can reach the designated Chereshovo parking. You do not need a special vehicle for that road —
          drive carefully on mountain bends.
        </p>
        <div className="valley-guest-guide__callout">
          <p>
            <strong>Correct road:</strong> {formatRouteArrowLine()} → designated parking.
          </p>
          <p>{KRAISHTE_WARNING}</p>
        </div>
        <GuideSubheading>How to navigate</GuideSubheading>
        <ul>
          <li>Use the “Navigate to parking” button above (or open it before you lose signal).</li>
          <li>It ends at Chereshovo parking — not at The Valley itself.</li>
          <li>Checkpoints to watch for: Eleshnitsa, then Palatik, then Chereshovo parking.</li>
        </ul>
        <GuideSubheading>Ortsevo</GuideSubheading>
        <p>
          Ortsevo is an optional adventure / hiking arrival for guests who deliberately choose it and receive
          suitable instructions. It is <strong>not</strong> the standard arrival and should not be treated as
          an equal alternative to Chereshovo.
        </p>
      </GuideSection>

      <GuideSection id="parking-final" title="4. Parking & final 2.5 km / ~45 min">
        <p>
          Park at the designated Chereshovo parking:{' '}
          <strong>{CHERESHOVO_PARKING.coordinatesDisplay}</strong>. This is your vehicle stop for the stay.
        </p>
        <div className="valley-guest-guide__callout valley-guest-guide__callout--warn">
          <p>
            <strong>Do not drive a normal passenger car beyond this parking toward The Valley.</strong>
          </p>
          <p>
            From parking to The Valley is {FINAL_APPROACH.distancePhrase} — {FINAL_APPROACH.walkTimePhrase}{' '}
            walking — completed by {FINAL_APPROACH.modesPhrase}.
          </p>
        </div>
        <GuideSubheading>On the final approach</GuideSubheading>
        <ul>
          <li>Forest track and path with a gradual incline</li>
          <li>Wear shoes with grip; keep a hand free for balance</li>
          <li>If arriving near dark, use a torch or headlamp and allow extra time</li>
          <li>Pack luggage so it is practical to carry, or arrange a suitable transfer in advance</li>
        </ul>
        <p className="valley-guest-guide__muted">
          Transfer details, if you need them, are confirmed closer to arrival — not invented here.
        </p>
      </GuideSection>

      <GuideSection id="off-grid" title="5. Living off-grid">
        <GuideSubheading>Power</GuideSubheading>
        <p>
          Electricity comes from solar and batteries. It is enough for lights, charging phones and laptops,
          and ordinary daily use. Avoid high-draw appliances you bring from home (personal heaters, hair
          dryers, and similar). After cloudy days, use power more gently.
        </p>
        <GuideSubheading>Water</GuideSubheading>
        <p>
          Water comes from the mountain and returns to local systems. Use it normally, keep showers
          reasonable, and never pour oils, paint, harsh chemicals, or rubbish into sinks or toilets.
        </p>
        <GuideSubheading>Heating & hot water</GuideSubheading>
        <p>
          Stays use a wood stove or fireplace for space heat, with gas or hybrid systems for hot water. On
          arrival, learn how your stove and hot-water controls work. Never leave a fire unattended.
        </p>
        <p className="valley-guest-guide__muted">
          Connectivity details for your unit are confirmed in your final arrival message.
        </p>
      </GuideSection>

      <GuideSection id="stay-safety" title="6. Accommodation & safety">
        <p>
          The Valley includes A-frame cabins, a luxury cabin, and a historic stone house, with shared outdoor
          spaces. Each stay is private; the land around them is shared. Your booking tells you which unit is
          yours.
        </p>
        <GuideSubheading>Safety</GuideSubheading>
        <ul>
          <li>Paths can be uneven, dark, or slippery — move carefully at night with a light</li>
          <li>Supervise children near stoves, fires, and the creek</li>
          <li>Agree clear boundaries with children for where they may walk alone</li>
          <li>If your unit allows pets, keep them under control and away from wildlife and farm animals</li>
          <li>Mountain weather changes quickly — keep a warm layer ready</li>
        </ul>
      </GuideSection>

      <GuideSection id="activities" title="7. Activities & around The Valley">
        <p>
          Hiking, quiet time outdoors, and exploring the surrounding villages and viewpoints are the heart of
          a stay here. Seasonal activities may be available — ask us before or during your stay rather than
          assuming a fixed menu or price list from this page.
        </p>
        <p>
          Chereshovo is the practical side for road access back toward Razlog and Bansko. Ortsevo sits higher
          with big views and is worth a visit when you want a hike or viewpoint day — again, not the default
          arrival.
        </p>
      </GuideSection>

      <GuideSection id="final-info" title="8. Final useful information">
        <ul>
          <li>
            <strong>Guide URL:</strong> https://driftdwells.com{CANONICAL_GUIDE_PATH}
          </li>
          <li>
            <strong>How to arrive (PDF):</strong>{' '}
            <a href={HOW_TO_ARRIVE_PDF_PATH} target="_blank" rel="noopener noreferrer">
              https://driftdwells.com{HOW_TO_ARRIVE_PDF_PATH}
            </a>
          </li>
          <li>
            <strong>Full guest guide (PDF):</strong>{' '}
            <a href={GUEST_GUIDE_PDF_PATH} target="_blank" rel="noopener noreferrer">
              https://driftdwells.com{GUEST_GUIDE_PDF_PATH}
            </a>
          </li>
          <li>
            <strong>Phone / WhatsApp:</strong> {CONTACT}
          </li>
          <li>
            <strong>Parking coordinates:</strong> {CHERESHOVO_PARKING.coordinatesDisplay}
          </li>
          <li>
            <strong>Default road:</strong> {formatRouteArrowLine()} — never Kraishte
          </li>
          <li>
            <strong>Final approach:</strong> {FINAL_APPROACH.distancePhrase},{' '}
            {FINAL_APPROACH.walkTimePhrase} walking, by {FINAL_APPROACH.modesPhrase}
          </li>
        </ul>
        <p>
          A few days before arrival we will send the final operational instructions for a smooth check-in.
          If anything is unclear before then, message us.
        </p>
      </GuideSection>
    </ValleyGuestGuideLayout>
  );
}
