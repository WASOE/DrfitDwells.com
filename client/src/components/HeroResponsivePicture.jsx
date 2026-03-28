/**
 * Responsive hero still (AVIF → WebP → JPG) with stable dimensions.
 */
export default function HeroResponsivePicture({
  avifSrcSet,
  webpSrcSet,
  fallbackSrc,
  width,
  height,
  sizes,
  alt,
  className,
  style,
  loading,
  fetchPriority,
  decoding = 'async'
}) {
  return (
    <picture>
      <source type="image/avif" srcSet={avifSrcSet} sizes={sizes} />
      <source type="image/webp" srcSet={webpSrcSet} sizes={sizes} />
      <img
        src={fallbackSrc}
        alt={alt}
        className={className}
        style={style}
        width={width}
        height={height}
        sizes={sizes}
        loading={loading}
        fetchPriority={fetchPriority}
        decoding={decoding}
      />
    </picture>
  );
}
