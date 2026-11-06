export default function HomePicture({
  image,
  alt,
  sizes,
  className = 'h-full w-full object-cover',
}) {
  return (
    <picture>
      {image.avifSrcSet ? (
        <source type="image/avif" srcSet={image.avifSrcSet} sizes={sizes} />
      ) : null}
      {image.webpSrcSet ? (
        <source type="image/webp" srcSet={image.webpSrcSet} sizes={sizes} />
      ) : null}
      <img
        src={image.src}
        alt={alt}
        width={image.width}
        height={image.height}
        sizes={sizes}
        className={className}
        loading="lazy"
        decoding="async"
      />
    </picture>
  );
}
