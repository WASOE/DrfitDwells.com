export default function SeoLandingHeroImage({ src, alt }) {
  return (
    <div className="seo-landing-hero-media">
      <img src={src} alt={alt} width="2000" height="1493" loading="eager" fetchPriority="high" decoding="async" />
    </div>
  );
}
