import { posterModernSources } from '../utils/posterModernSources';

/**
 * Mobile hero poster: AVIF → WebP → byte-identical JPEG fallback.
 * Mirrors desktop HeroResponsivePicture pattern without srcset (same intrinsic size).
 */
export default function MobilePosterPicture({
  posterJpg,
  alt,
  className,
  style,
  loading,
  fetchPriority,
  decoding = 'async',
  imgRef,
  width,
  height,
  id
}) {
  const { jpg, avif, webp } = posterModernSources(posterJpg);

  return (
    <picture>
      {avif ? <source type="image/avif" srcSet={avif} /> : null}
      {webp ? <source type="image/webp" srcSet={webp} /> : null}
      <img
        ref={imgRef}
        id={id}
        src={jpg}
        alt={alt}
        className={className}
        style={style}
        width={width}
        height={height}
        loading={loading}
        decoding={decoding}
        {...(fetchPriority != null && fetchPriority !== ''
          ? { fetchpriority: fetchPriority }
          : {})}
      />
    </picture>
  );
}
