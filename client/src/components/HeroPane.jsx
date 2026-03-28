import { CABIN_MEDIA, VALLEY_MEDIA } from '../config/mediaConfig';
import { getCabinHeroResponsive, getValleyHeroResponsive } from '../config/heroResponsive';
import HeroResponsivePicture from './HeroResponsivePicture';

const CABIN_VIDEOS = CABIN_MEDIA.heroVideo;
const CABIN_STILLS = CABIN_MEDIA.heroPoster;
const VALLEY_VIDEOS = {
  winter: VALLEY_MEDIA.heroVideo.winter,
  summer: VALLEY_MEDIA.altSummerPair.video
};
const VALLEY_STILLS = {
  winter: VALLEY_MEDIA.heroPoster.winter,
  summer: VALLEY_MEDIA.altSummerPair.poster
};

export default function HeroPane({
  side,
  season,
  useVideo,
  videoRef,
  isPrimary,
  mediaStyle,
  sizes
}) {
  const isLeft = side === 'left';
  const videoSource = isLeft ? CABIN_VIDEOS[season] : VALLEY_VIDEOS[season];
  const poster = isLeft ? CABIN_STILLS[season] : VALLEY_STILLS[season];
  const altText = isLeft ? 'Cabin exterior' : 'Valley landscape';
  const responsive = isLeft ? getCabinHeroResponsive(season) : getValleyHeroResponsive(season);

  if (!useVideo) {
    return (
      <HeroResponsivePicture
        avifSrcSet={responsive.avifSrcSet}
        webpSrcSet={responsive.webpSrcSet}
        fallbackSrc={responsive.fallbackSrc}
        width={responsive.width}
        height={responsive.height}
        sizes={sizes}
        alt={altText}
        className="absolute inset-0 w-full h-full object-cover"
        style={mediaStyle}
        loading={isPrimary ? 'eager' : 'lazy'}
        fetchPriority={isPrimary ? 'high' : 'low'}
        decoding="async"
      />
    );
  }

  return (
    <video
      key={`${side}-${season}`}
      ref={videoRef}
      className="absolute inset-0 w-full h-full object-cover"
      autoPlay
      loop
      muted
      playsInline
      preload="metadata"
      poster={poster}
      width={1920}
      height={1080}
      style={mediaStyle}
    >
      <source src={videoSource} type="video/mp4" />
    </video>
  );
}
