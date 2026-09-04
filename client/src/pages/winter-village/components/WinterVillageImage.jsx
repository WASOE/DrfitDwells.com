import { getSlot } from '../winterVillageMedia';

/**
 * Renders a Winter Village media slot.
 *
 * A ready slot renders a responsive picture. A pending slot renders a designed plate
 * carrying the shot brief, so the layout reads at full quality before the photography
 * arrives and the page never falls back to off-season or AI imagery.
 */
export default function WinterVillageImage({
  slot,
  className = '',
  sizes = '100vw',
  priority = false,
  focus
}) {
  const media = getSlot(slot);
  const objectPosition = focus || media.focus;

  if (!media.ready) {
    return (
      <div
        className={`wv-plate wv-plate--pending ${className}`.trim()}
        style={{ '--wv-plate-ratio': media.ratio }}
        role="img"
        aria-label={media.alt}
      >
        <span className="wv-plate-grain" aria-hidden="true" />
        <span className="wv-plate-note" aria-hidden="true">
          <span className="wv-plate-note-label">Winter photograph to come</span>
          <span className="wv-plate-note-brief">{media.brief}</span>
        </span>
      </div>
    );
  }

  return (
    <picture className={`wv-plate ${className}`.trim()} style={{ '--wv-plate-ratio': media.ratio }}>
      <source type="image/avif" srcSet={media.avif} sizes={sizes} />
      <source type="image/webp" srcSet={media.webp} sizes={sizes} />
      <img
        src={media.fallback}
        alt={media.alt}
        className="wv-plate-img"
        style={{ objectPosition }}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        decoding="async"
      />
    </picture>
  );
}
