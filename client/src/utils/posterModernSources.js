/**
 * Derive same-basename AVIF/WebP URLs from a JPEG poster path.
 * JPEG path remains the byte-identical fallback.
 */
export function posterModernSources(jpgPath) {
  if (!jpgPath || typeof jpgPath !== 'string') {
    return { jpg: jpgPath, avif: null, webp: null };
  }
  const avif = jpgPath.replace(/\.jpe?g$/i, '.avif');
  const webp = jpgPath.replace(/\.jpe?g$/i, '.webp');
  if (avif === jpgPath) {
    return { jpg: jpgPath, avif: null, webp: null };
  }
  return { jpg: jpgPath, avif, webp };
}
