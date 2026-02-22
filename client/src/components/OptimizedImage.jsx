import { getImageMetadata, getSEOAlt, getSEOTitle } from '../data/imageMetadata';

/**
 * OptimizedImage Component
 * 
 * Wraps img tags with automatic SEO optimization from metadata database.
 * Ensures all images have proper alt text, title, and accessibility attributes.
 * 
 * @param {string} src - Image source path
 * @param {string} alt - Optional override alt text (defaults to metadata SEO alt)
 * @param {string} className - CSS classes
 * @param {object} style - Inline styles
 * @param {object} ...props - Other img props
 */
const OptimizedImage = ({ src, alt, className = '', style = {}, ...props }) => {
  const metadata = getImageMetadata(src);
  const seoAlt = getSEOAlt(src);
  const seoTitle = getSEOTitle(src);
  
  // Use provided alt or fall back to SEO alt from metadata
  const finalAlt = alt || seoAlt;
  const finalTitle = props.title || seoTitle;
  
  return (
    <img
      src={src}
      alt={finalAlt}
      title={finalTitle}
      className={className}
      style={style}
      loading={props.loading || 'lazy'}
      decoding={props.decoding || 'async'}
      {...props}
    />
  );
};

export default OptimizedImage;
