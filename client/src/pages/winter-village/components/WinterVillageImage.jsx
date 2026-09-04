import { getSlot } from '../winterVillageMedia';

/**
 * Renders a Winter Village media slot.
 * Pending slots are silent atmospheric plates — no public photography instructions.
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
