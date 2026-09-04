import { useEffect, useState } from 'react';
import HeroResponsivePicture from '../../../components/HeroResponsivePicture';

const WINTER_STILL_FALLBACK = '/media/hero/valley-winter-1920w.avif';

/**
 * Full-bleed winter media: poster/still first, optional muted video on top.
 * Never used for summer assets. Falls back to a repo winter still if /uploads is unavailable.
 */
export default function WinterVillageCinematicMedia({
  videoSrc,
  posterSrc,
  picture,
  alt,
  className = '',
  overlayClassName = '',
  prefersReducedMotion = false,
  eager = false,
  objectPosition = 'center center'
}) {
  const [videoRevealed, setVideoRevealed] = useState(false);
  const [stillFailed, setStillFailed] = useState(false);
  const allowVideo = Boolean(videoSrc) && !prefersReducedMotion;
  const imgSrc = stillFailed ? WINTER_STILL_FALLBACK : posterSrc;

  useEffect(() => {
    setVideoRevealed(false);
    setStillFailed(false);
  }, [videoSrc, posterSrc, allowVideo]);

  return (
    <div className={`wv-media ${className}`.trim()}>
      {picture ? (
        <HeroResponsivePicture
          avifSrcSet={picture.avifSrcSet}
          webpSrcSet={picture.webpSrcSet}
          fallbackSrc={picture.fallbackSrc || posterSrc || WINTER_STILL_FALLBACK}
          width={picture.width || 1920}
          height={picture.height || 1080}
          sizes="100vw"
          alt={alt}
          className="wv-media-img"
          style={{ objectPosition }}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : undefined}
          decoding="async"
        />
      ) : (
        <img
          src={imgSrc}
          alt={alt}
          className="wv-media-img"
          style={{ objectPosition }}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setStillFailed(true)}
        />
      )}
      {allowVideo ? (
        <video
          key={videoSrc}
          className={`wv-media-video ${videoRevealed ? 'is-on' : ''}`}
          autoPlay
          loop
          muted
          playsInline
          preload={eager ? 'auto' : 'metadata'}
          poster={posterSrc}
          style={{ objectPosition }}
          onPlaying={() => setVideoRevealed(true)}
        >
          <source src={videoSrc} type="video/mp4" />
        </video>
      ) : null}
      {overlayClassName ? <div className={overlayClassName} aria-hidden="true" /> : null}
    </div>
  );
}

export function WinterVillageStill({
  src,
  alt = '',
  className,
  style,
  loading = 'lazy'
}) {
  const [failed, setFailed] = useState(false);
  return (
    <img
      src={failed ? WINTER_STILL_FALLBACK : src}
      alt={alt}
      className={className}
      style={style}
      loading={loading}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
